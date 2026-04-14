import "dotenv/config";
import { createPublicClient, http, parseAbi, parseAbiItem, decodeEventLog } from "viem";
import { db } from "./db.js";

/**
 * Swap-event indexer for price history.
 *
 * Watches Swap(address,uint256,uint256,uint256,uint256,address) events on a
 * configurable list of Uniswap-V2-style pair contracts:
 *
 *   1. `PAIR_ADDRESS`             — our own TdogePair (fDOGE/USDC).
 *   2. Auto-resolved UnitFlow pairs for each `TRACKED_TOKEN_*` env entry,
 *      paired against USDC via `UnitFlowFactory.getPair(token, USDC)`.
 *
 * Every Swap's execution price is decimal-adjusted using the pair's own
 * token0/token1 decimals (read once at startup per pair) so candles express
 * "token1 human units per 1 token0 human unit" — e.g. USDC/fDOGE.
 *
 * The API aggregates raw swaps into OHLC candles on read.
 */

const RPC     = process.env.TEMPO_RPC_URL ?? "https://rpc.testnet.arc.network";
const POLL_MS = Number(process.env.PRICE_INDEXER_POLL_MS ?? 15_000);
const RANGE   = BigInt(process.env.PRICE_INDEXER_RANGE ?? "500");
const START   = BigInt(process.env.PRICE_INDEXER_START_BLOCK ?? "0");

const OUR_PAIR = (process.env.PAIR_ADDRESS ?? "").toLowerCase();

// UnitFlow V2.5 on Arc (override via env).
const UNITFLOW_FACTORY = (process.env.UNITFLOW_FACTORY_ADDRESS
  ?? "0xd67F63A4F26a497b364d1C82e6747Aec8B5743a5").toLowerCase();
const USDC = (process.env.USDC_ADDRESS
  ?? "0x3600000000000000000000000000000000000000").toLowerCase();

/// Tokens we want UnitFlow charts for. Paired against USDC via factory.
/// Comma-separated addresses. Default = Arc predeployed stables + UnitFlow WUSDC.
const TRACKED_TOKENS = (process.env.TRACKED_TOKENS ??
  [
    "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", // EURC
    "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C", // USYC
    "0x911b4000D3422F482F4062a913885f7b035382Df", // WUSDC
  ].join(",")
).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)"
);
const factoryAbi = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address)",
]);
const pairAbi    = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const erc20Abi   = parseAbi([
  "function decimals() view returns (uint8)",
]);

const client = createPublicClient({ transport: http(RPC) });

type TrackedPair = {
  address: string;        // lowercased pair address
  label:   string;        // human label for logs
  dec0:    number;
  dec1:    number;
};

const tracked: TrackedPair[] = [];
const trackedByAddr: Record<string, TrackedPair> = {};

function getCursor(pair: string): bigint {
  const row = db.prepare("SELECT last_block FROM price_cursor WHERE pair = ?").get(pair) as { last_block?: number } | undefined;
  return row?.last_block !== undefined ? BigInt(row.last_block) : START;
}
function setCursor(pair: string, n: bigint) {
  db.prepare(
    `INSERT INTO price_cursor (pair, last_block) VALUES (?, ?)
     ON CONFLICT(pair) DO UPDATE SET last_block = excluded.last_block`,
  ).run(pair, Number(n));
}

const insertSwap = db.prepare(
  `INSERT OR IGNORE INTO swaps
   (pair, block, tx, log_index, timestamp, amount0_in, amount1_in, amount0_out, amount1_out, price_num)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

function computePrice(p: TrackedPair, a0in: bigint, a1in: bigint, a0out: bigint, a1out: bigint): number {
  const s0 = Math.pow(10, p.dec0);
  const s1 = Math.pow(10, p.dec1);
  if (a0in > 0n && a1out > 0n) return (Number(a1out) / s1) / (Number(a0in) / s0);
  if (a1in > 0n && a0out > 0n) return (Number(a1in) / s1) / (Number(a0out) / s0);
  return 0;
}

async function loadPairMetadata(addr: string, label: string): Promise<TrackedPair | null> {
  try {
    const [t0, t1] = await Promise.all([
      client.readContract({ address: addr as `0x${string}`, abi: pairAbi, functionName: "token0" }),
      client.readContract({ address: addr as `0x${string}`, abi: pairAbi, functionName: "token1" }),
    ]);
    const [d0, d1] = await Promise.all([
      client.readContract({ address: t0, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: t1, abi: erc20Abi, functionName: "decimals" }),
    ]);
    const p: TrackedPair = { address: addr.toLowerCase(), label, dec0: Number(d0), dec1: Number(d1) };
    console.log(`[price] + ${label}  pair=${addr}  token0=${t0} (${p.dec0}d)  token1=${t1} (${p.dec1}d)`);
    return p;
  } catch (e) {
    console.warn(`[price] skip ${label} @ ${addr}: ${(e as Error).message}`);
    return null;
  }
}

async function resolveUnitflowPair(token: string): Promise<string | null> {
  try {
    const p = await client.readContract({
      address: UNITFLOW_FACTORY as `0x${string}`,
      abi: factoryAbi,
      functionName: "getPair",
      args: [token as `0x${string}`, USDC as `0x${string}`],
    });
    if ((p as string).toLowerCase() === "0x0000000000000000000000000000000000000000") return null;
    return (p as string).toLowerCase();
  } catch {
    return null;
  }
}

async function bootstrapPairs() {
  // Our own TdogePair first.
  if (OUR_PAIR) {
    const p = await loadPairMetadata(OUR_PAIR, "DOGE FORGE fDOGE/USDC");
    if (p) { tracked.push(p); trackedByAddr[p.address] = p; }
  }
  // UnitFlow pairs for each tracked token vs USDC.
  for (const token of TRACKED_TOKENS) {
    const pairAddr = await resolveUnitflowPair(token);
    if (!pairAddr) {
      console.log(`[price] no UnitFlow pair for ${token} / USDC (skip)`);
      continue;
    }
    const p = await loadPairMetadata(pairAddr, `UnitFlow ${token}/USDC`);
    if (p) { tracked.push(p); trackedByAddr[p.address] = p; }
  }
  if (tracked.length === 0) {
    console.error("[price] no pairs to track; exiting.");
    process.exit(0);
  }
}

async function tickPair(p: TrackedPair, head: bigint) {
  const cursor = getCursor(p.address);
  const from = cursor === 0n ? head - 10_000n : cursor;
  const to   = from + RANGE > head ? head : from + RANGE;
  if (to <= from) return;

  const logs = await client.getLogs({
    address: p.address as `0x${string}`,
    event: swapEvent,
    fromBlock: from,
    toBlock: to,
  });

  for (const log of logs) {
    const { args } = decodeEventLog({ abi: [swapEvent], data: log.data, topics: log.topics });
    const { amount0In, amount1In, amount0Out, amount1Out } = args as unknown as {
      amount0In: bigint; amount1In: bigint; amount0Out: bigint; amount1Out: bigint;
    };
    const block = await client.getBlock({ blockNumber: log.blockNumber! });
    const price = computePrice(p, amount0In, amount1In, amount0Out, amount1Out);
    insertSwap.run(
      p.address,
      Number(log.blockNumber!),
      log.transactionHash!,
      log.logIndex!,
      Number(block.timestamp),
      amount0In.toString(),
      amount1In.toString(),
      amount0Out.toString(),
      amount1Out.toString(),
      price,
    );
  }

  setCursor(p.address, to);
  if (logs.length > 0) {
    console.log(`[price] ${p.label}: ${from}->${to} (head ${head}) +${logs.length} swaps`);
  }
}

async function tick() {
  const head = await client.getBlockNumber();
  for (const p of tracked) {
    try { await tickPair(p, head); }
    catch (e) { console.warn(`[price] ${p.label} tick error: ${(e as Error).message}`); }
  }
}

async function main() {
  console.log(`[price] RPC=${RPC} poll=${POLL_MS}ms range=${RANGE} factory=${UNITFLOW_FACTORY}`);
  await bootstrapPairs();
  console.log(`[price] tracking ${tracked.length} pair(s)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await tick(); }
    catch (e) { console.error("[price] tick error:", (e as Error).message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
