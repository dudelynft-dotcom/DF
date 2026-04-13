import "dotenv/config";
import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { db } from "./db.js";

/**
 * Token discovery indexer.
 *
 * Strategy: for each new block range, fetch block receipts and detect any
 * transactions that produced a contract (`contractAddress` set). For each
 * deployed contract, probe it as ERC20/TIP-20 via `symbol()`, `name()`,
 * `decimals()`. If it responds cleanly, insert as "unverified". An admin
 * can later flip the `verified` flag via the REST API.
 *
 * No factory events or PairCreated — those are AMM concepts and Tempo's
 * enshrined DEX is an orderbook. This approach works for any deployed
 * token regardless of whether it's listed on the DEX.
 */

const RPC   = process.env.TEMPO_RPC_URL ?? "https://rpc.testnet.tempo.xyz";
const START = BigInt(process.env.INDEXER_START_BLOCK ?? "0");
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 10_000);
const RANGE = BigInt(process.env.INDEXER_RANGE ?? "200"); // blocks per tick

const client = createPublicClient({ transport: http(RPC) });

const erc20Meta = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

function getCursor(): bigint {
  const row = db.prepare("SELECT last_block FROM indexer_cursor WHERE id = 1").get() as { last_block?: number } | undefined;
  return row?.last_block !== undefined ? BigInt(row.last_block) : START;
}
function setCursor(n: bigint) {
  db.prepare(
    `INSERT INTO indexer_cursor (id, last_block) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET last_block = excluded.last_block`
  ).run(Number(n));
}

const insertToken = db.prepare(
  `INSERT OR IGNORE INTO tokens (address, symbol, name, decimals, verified, hidden, first_seen, creator, last_block)
   VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`
);

async function probeErc20(addr: `0x${string}`) {
  try {
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({ address: addr, abi: erc20Meta, functionName: "symbol" }),
      client.readContract({ address: addr, abi: erc20Meta, functionName: "name" }),
      client.readContract({ address: addr, abi: erc20Meta, functionName: "decimals" }),
    ]);
    if (typeof symbol !== "string" || typeof name !== "string") return null;
    if (symbol.length === 0 || symbol.length > 40) return null;
    if (decimals > 30) return null;
    return { symbol, name, decimals: Number(decimals) };
  } catch {
    return null;
  }
}

async function processBlock(blockNumber: bigint) {
  const block = await client.getBlock({ blockNumber, includeTransactions: true });
  for (const tx of block.transactions) {
    if (typeof tx === "string") continue;
    if (tx.to !== null) continue; // to == null is a contract-creation
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: tx.hash }); }
    catch { continue; }
    if (!receipt.contractAddress) continue;
    const addr = getAddress(receipt.contractAddress);
    const meta = await probeErc20(addr);
    if (!meta) continue;
    insertToken.run(
      addr.toLowerCase(),
      meta.symbol,
      meta.name,
      meta.decimals,
      Math.floor(Date.now() / 1000),
      tx.from.toLowerCase(),
      Number(blockNumber)
    );
    console.log(`[discovery] +${meta.symbol} (${meta.name}) @ ${addr} block ${blockNumber}`);
  }
}

async function tick() {
  const head = await client.getBlockNumber();
  let from = getCursor();
  if (from === 0n) from = head > RANGE ? head - RANGE : 0n; // first run: scan recent window
  if (from >= head) return;
  const to = from + RANGE > head ? head : from + RANGE;

  for (let b = from + 1n; b <= to; b++) {
    try { await processBlock(b); }
    catch (e) { console.error(`[discovery] block ${b} error`, e); }
  }
  setCursor(to);
  console.log(`[discovery] cursor ${from} → ${to} (head ${head})`);
}

async function loop() {
  console.log(`[discovery] starting on ${RPC}, poll ${POLL_MS}ms, range ${RANGE} blocks`);
  while (true) {
    try { await tick(); } catch (e) { console.error("[discovery] tick error", e); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
loop();
