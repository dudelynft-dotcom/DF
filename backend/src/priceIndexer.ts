import "dotenv/config";
import { createPublicClient, http, parseAbiItem, decodeEventLog } from "viem";
import { db } from "./db.js";

/**
 * Swap-event indexer for price history.
 *
 * Watches Swap(address,uint256,uint256,uint256,uint256,address) events emitted
 * by our TdogePair (fDOGE/USDC). For each Swap we store amounts in and out,
 * compute the execution price of token0 in token1 units, and persist to
 * `swaps`. The API aggregates these into OHLC candles on read.
 *
 * The pair contract is configured via env: PAIR_ADDRESS.
 * Extend LATER for UnitFlow pairs by duplicating this watcher with a list of
 * pair addresses to track.
 */

const RPC     = process.env.TEMPO_RPC_URL ?? "https://rpc.testnet.arc.network";
const POLL_MS = Number(process.env.PRICE_INDEXER_POLL_MS ?? 15_000);
const RANGE   = BigInt(process.env.PRICE_INDEXER_RANGE ?? "500");
const START   = BigInt(process.env.PRICE_INDEXER_START_BLOCK ?? "0");

const PAIR_ADDR = (process.env.PAIR_ADDRESS ?? "").toLowerCase();
if (!PAIR_ADDR) {
  console.warn("[price] PAIR_ADDRESS not set — price indexer idle.");
  process.exit(0);
}

const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)"
);

const client = createPublicClient({ transport: http(RPC) });

function getCursor(): bigint {
  const row = db.prepare("SELECT last_block FROM price_cursor WHERE pair = ?").get(PAIR_ADDR) as { last_block?: number } | undefined;
  return row?.last_block !== undefined ? BigInt(row.last_block) : START;
}
function setCursor(n: bigint) {
  db.prepare(
    `INSERT INTO price_cursor (pair, last_block) VALUES (?, ?)
     ON CONFLICT(pair) DO UPDATE SET last_block = excluded.last_block`
  ).run(PAIR_ADDR, Number(n));
}

const insertSwap = db.prepare(
  `INSERT OR IGNORE INTO swaps
   (pair, block, tx, log_index, timestamp, amount0_in, amount1_in, amount0_out, amount1_out, price_num)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

function computePrice(a0in: bigint, a1in: bigint, a0out: bigint, a1out: bigint): number {
  // token0 -> token1 swap: paid a0in token0, received a1out token1. Price = a1out / a0in.
  // token1 -> token0 swap: paid a1in token1, received a0out token0. Price = a1in / a0out.
  if (a0in > 0n && a1out > 0n) {
    return Number(a1out) / Number(a0in);
  }
  if (a1in > 0n && a0out > 0n) {
    return Number(a1in) / Number(a0out);
  }
  return 0;
}

async function tick() {
  const head = await client.getBlockNumber();
  const cursor = getCursor();
  const from = cursor === 0n ? head - 10_000n : cursor;
  const to   = from + RANGE > head ? head : from + RANGE;
  if (to <= from) return;

  const logs = await client.getLogs({
    address: PAIR_ADDR as `0x${string}`,
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
    const price = computePrice(amount0In, amount1In, amount0Out, amount1Out);
    insertSwap.run(
      PAIR_ADDR,
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
    console.log(`[price] swap @ ${log.blockNumber} price=${price.toExponential(3)}`);
  }

  setCursor(to);
  console.log(`[price] cursor ${from} -> ${to} (head ${head}) +${logs.length} swaps`);
}

async function main() {
  console.log(`[price] watching pair ${PAIR_ADDR} on ${RPC}, poll ${POLL_MS}ms, range ${RANGE} blocks`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await tick(); }
    catch (e) { console.error("[price] tick error:", (e as Error).message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
