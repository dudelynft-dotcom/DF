// Per-wallet event indexer for community task verification.
//
// Polls two event sources on Arc and aggregates running totals into
// community_trade_volume and community_mine_volume:
//
//   1. ForgeRouter.Swap(user, tokenIn, tokenOut, amountIn, amountOut, fee)
//      → adds USDC-side amount to community_trade_volume.usdc_in_total
//   2. Miner.Committed(user, positionId, amount, mode, unlockAt)
//      → adds amount to community_mine_volume.usdc_committed_total
//
// USDC sits on every pair we care about (fDOGE/USDC, EURC/USDC, etc.),
// so trade volume defaults to the USDC side. Multi-hop legs whose
// endpoints are both non-USDC are skipped — Step 6 can refine.
//
// Run as its own process: `npm run community-indexer`.

import "dotenv/config";
import { createPublicClient, http, parseAbiItem, defineChain } from "viem";
import { db } from "./db.js";

// ---- chain ----
const arc = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network"] } },
});
const client = createPublicClient({ chain: arc, transport: http() });

// ---- config ----
const ROUTER = (process.env.FORGE_ROUTER_ADDRESS ?? "0xffBD254859EbF9fC4808410f95f8C4E7998846fB").toLowerCase() as `0x${string}`;
const MINER  = (process.env.MINER_ADDRESS         ?? "0x1574EEA1DA5e204CC035968D480aE51BF6505834").toLowerCase() as `0x${string}`;
const USDC   = (process.env.USDC_ADDRESS          ?? "0x3600000000000000000000000000000000000000").toLowerCase() as `0x${string}`;

const POLL_MS = Number(process.env.COMMUNITY_POLL_MS ?? 12_000);
const RANGE   = BigInt(process.env.COMMUNITY_RANGE   ?? 500); // blocks per poll
const BACKFILL_BLOCKS = BigInt(process.env.COMMUNITY_BACKFILL ?? 50_000);

// ---- ABIs (just the events we read) ----
const SWAP_EVENT      = parseAbiItem("event Swap(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee)");
const COMMITTED_EVENT = parseAbiItem("event Committed(address indexed user, uint256 indexed positionId, uint256 amount, uint8 mode, uint64 unlockAt)");

// ---- cursor helpers ----
function getCursor(source: string, fallback: bigint): bigint {
  const row = db.prepare(`SELECT last_block FROM community_event_cursor WHERE source = ?`).get(source) as { last_block?: number } | undefined;
  return row?.last_block ? BigInt(row.last_block) : fallback;
}
function setCursor(source: string, n: bigint) {
  db.prepare(
    `INSERT INTO community_event_cursor (source, last_block) VALUES (?, ?)
     ON CONFLICT(source) DO UPDATE SET last_block = excluded.last_block`
  ).run(source, Number(n));
}

// ---- volume upserts ----
// Do the bigint math in JS. SQLite CAST would coerce to REAL for large
// numbers, leaving "27709524.0" literals the reader then rejects.

function parseWei(s: unknown): bigint {
  // Tolerant: accepts "123", "123.0", or missing.
  if (s == null) return 0n;
  const str = String(s).split(".")[0] || "0";
  try { return BigInt(str); } catch { return 0n; }
}

function addTradeVolume(wallet: string, usdcWei: bigint) {
  if (usdcWei <= 0n) return;
  const w = wallet.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    `SELECT usdc_in_total FROM community_trade_volume WHERE wallet = ?`
  ).get(w) as { usdc_in_total?: string } | undefined;
  if (row) {
    const total = parseWei(row.usdc_in_total) + usdcWei;
    db.prepare(
      `UPDATE community_trade_volume
         SET usdc_in_total = ?, swap_count = swap_count + 1, updated_at = ?
       WHERE wallet = ?`
    ).run(total.toString(), now, w);
  } else {
    db.prepare(
      `INSERT INTO community_trade_volume (wallet, usdc_in_total, swap_count, updated_at)
       VALUES (?, ?, 1, ?)`
    ).run(w, usdcWei.toString(), now);
  }
}
function addMineVolume(wallet: string, usdcWei: bigint) {
  if (usdcWei <= 0n) return;
  const w = wallet.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    `SELECT usdc_committed_total FROM community_mine_volume WHERE wallet = ?`
  ).get(w) as { usdc_committed_total?: string } | undefined;
  if (row) {
    const total = parseWei(row.usdc_committed_total) + usdcWei;
    db.prepare(
      `UPDATE community_mine_volume
         SET usdc_committed_total = ?, position_count = position_count + 1, updated_at = ?
       WHERE wallet = ?`
    ).run(total.toString(), now, w);
  } else {
    db.prepare(
      `INSERT INTO community_mine_volume (wallet, usdc_committed_total, position_count, updated_at)
       VALUES (?, ?, 1, ?)`
    ).run(w, usdcWei.toString(), now);
  }
}

// ---- per-source pollers ----
async function pollSwaps(head: bigint) {
  const fallback = head > BACKFILL_BLOCKS ? head - BACKFILL_BLOCKS : 0n;
  const from = getCursor("forge_router_swap", fallback);
  if (from >= head) return;
  const to = from + RANGE > head ? head : from + RANGE;

  const logs = await client.getLogs({
    address: ROUTER,
    event: SWAP_EVENT,
    fromBlock: from,
    toBlock:   to,
  });

  for (const log of logs) {
    const a = log.args;
    if (!a?.user || !a.tokenIn || !a.tokenOut) continue;
    let usdc = 0n;
    if (a.tokenIn.toLowerCase() === USDC)       usdc = a.amountIn  ?? 0n;
    else if (a.tokenOut.toLowerCase() === USDC) usdc = a.amountOut ?? 0n;
    // Multi-hop without a USDC endpoint is skipped (rare on our pairs).
    addTradeVolume(a.user, usdc);
  }

  setCursor("forge_router_swap", to);
  console.log(`[community] swaps ${from} → ${to} (${logs.length} logs)`);
}

async function pollCommits(head: bigint) {
  const fallback = head > BACKFILL_BLOCKS ? head - BACKFILL_BLOCKS : 0n;
  const from = getCursor("miner_committed", fallback);
  if (from >= head) return;
  const to = from + RANGE > head ? head : from + RANGE;

  const logs = await client.getLogs({
    address: MINER,
    event: COMMITTED_EVENT,
    fromBlock: from,
    toBlock:   to,
  });

  for (const log of logs) {
    const a = log.args;
    if (!a?.user || a.amount == null) continue;
    addMineVolume(a.user, a.amount);
  }

  setCursor("miner_committed", to);
  console.log(`[community] commits ${from} → ${to} (${logs.length} logs)`);
}

// ---- main loop ----
async function tick() {
  try {
    const head = await client.getBlockNumber();
    await Promise.all([pollSwaps(head), pollCommits(head)]);
  } catch (e: unknown) {
    console.error("[community] tick error", (e as Error)?.message);
  }
}

console.log(`[community indexer] router=${ROUTER} miner=${MINER}`);
tick();
setInterval(tick, POLL_MS);
