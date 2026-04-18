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
const FDOGE  = (process.env.FDOGE_ADDRESS         ?? "").toLowerCase();

const POLL_MS = Number(process.env.COMMUNITY_POLL_MS ?? 12_000);
const RANGE   = BigInt(process.env.COMMUNITY_RANGE   ?? 500); // blocks per poll
const BACKFILL_BLOCKS = BigInt(process.env.COMMUNITY_BACKFILL ?? 50_000);
// Raw commits backfill is larger because the public leaderboard needs
// full testnet history, not just the recent volume-tracking window.
const COMMITS_RAW_BACKFILL = BigInt(process.env.COMMUNITY_COMMITS_BACKFILL ?? 1_500_000);
// Raw commits poll uses Arc's 10k-block getLogs maximum and loops
// inside a single tick until caught up. Without this, a cold 1.5M-block
// backfill at 500 blocks/12s would take ~10 hours.
const COMMITS_RAW_RANGE = BigInt(process.env.COMMUNITY_COMMITS_RANGE ?? 9_999);
const COMMITS_RAW_MAX_ITERS = Number(process.env.COMMUNITY_COMMITS_MAX_ITERS ?? 400); // 400 * 9999 ≈ 4M blocks per tick
// LP-add poller backfill. Larger than the volume default so historical
// LP providers are credited for the new fDOGE/USDC LP tasks. Uses the
// same 9999-block max + in-tick catchup loop as commits-raw.
const LP_ADD_BACKFILL  = BigInt(process.env.COMMUNITY_LP_BACKFILL   ?? 1_500_000);
const LP_ADD_RANGE     = BigInt(process.env.COMMUNITY_LP_RANGE      ?? 9_999);
const LP_ADD_MAX_ITERS = Number(process.env.COMMUNITY_LP_MAX_ITERS  ?? 400);

// ---- ABIs (just the events we read) ----
const SWAP_EVENT      = parseAbiItem("event Swap(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee)");
const COMMITTED_EVENT = parseAbiItem("event Committed(address indexed user, uint256 indexed positionId, uint256 amount, uint8 mode, uint64 unlockAt)");
const LIQUIDITY_ADDED_EVENT = parseAbiItem("event LiquidityAdded(address indexed user, address indexed tokenA, address indexed tokenB, uint256 amountA, uint256 amountB, uint256 liquidity)");

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
function addLpProvide(wallet: string, usdcWei: bigint) {
  if (usdcWei <= 0n) return;
  const w = wallet.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    `SELECT usdc_side_total FROM community_lp_adds WHERE wallet = ?`
  ).get(w) as { usdc_side_total?: string } | undefined;
  if (row) {
    const total = parseWei(row.usdc_side_total) + usdcWei;
    db.prepare(
      `UPDATE community_lp_adds
         SET usdc_side_total = ?, add_count = add_count + 1, updated_at = ?
       WHERE wallet = ?`
    ).run(total.toString(), now, w);
  } else {
    db.prepare(
      `INSERT INTO community_lp_adds (wallet, usdc_side_total, add_count, updated_at)
       VALUES (?, ?, 1, ?)`
    ).run(w, usdcWei.toString(), now);
  }
}
function addFdogeBought(wallet: string, fdogeWei: bigint) {
  if (fdogeWei <= 0n) return;
  const w = wallet.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    `SELECT fdoge_bought_total FROM community_fdoge_buys WHERE wallet = ?`
  ).get(w) as { fdoge_bought_total?: string } | undefined;
  if (row) {
    const total = parseWei(row.fdoge_bought_total) + fdogeWei;
    db.prepare(
      `UPDATE community_fdoge_buys
         SET fdoge_bought_total = ?, buy_count = buy_count + 1, updated_at = ?
       WHERE wallet = ?`
    ).run(total.toString(), now, w);
  } else {
    db.prepare(
      `INSERT INTO community_fdoge_buys (wallet, fdoge_bought_total, buy_count, updated_at)
       VALUES (?, ?, 1, ?)`
    ).run(w, fdogeWei.toString(), now);
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

    // If the swap ended at fDOGE, credit the user's buy total. Works for
    // both direct USDC→fDOGE and multi-hop routes — router emits Swap
    // with the route's endpoints, so tokenOut reflects what the user received.
    if (FDOGE && a.tokenOut.toLowerCase() === FDOGE) {
      addFdogeBought(a.user, a.amountOut ?? 0n);
    }
  }

  setCursor("forge_router_swap", to);
  console.log(`[community] swaps ${from} → ${to} (${logs.length} logs)`);
}

const insertCommit = db.prepare(
  `INSERT OR IGNORE INTO miner_commits (tx, log_index, wallet, amount, block, timestamp)
   VALUES (?, ?, ?, ?, ?, ?)`
);

// Raw Committed → miner_commits. Separate cursor from the volume poller so
// the raw table can backfill deeper without double-counting mine_volume.
// Loops inside one tick until either caught up to head or MAX_ITERS hit,
// so a cold 1.5M-block backfill completes in minutes instead of hours.
async function pollCommitsRaw(head: bigint) {
  const fallback = head > COMMITS_RAW_BACKFILL ? head - COMMITS_RAW_BACKFILL : 0n;
  let from = getCursor("miner_commits_raw", fallback);
  if (from >= head) return;

  for (let iter = 0; iter < COMMITS_RAW_MAX_ITERS; iter++) {
    if (from >= head) break;
    const to = from + COMMITS_RAW_RANGE > head ? head : from + COMMITS_RAW_RANGE;

    let logs;
    try {
      logs = await client.getLogs({
        address: MINER,
        event: COMMITTED_EVENT,
        fromBlock: from,
        toBlock:   to,
      });
    } catch (e: unknown) {
      console.error(`[community] commits-raw getLogs ${from}-${to} failed:`, (e as Error)?.message);
      break; // give up for this tick; cursor stays, next tick retries
    }

    // Fetch block timestamps lazily, one per unique block in the batch.
    const tsCache = new Map<bigint, number>();
    for (const log of logs) {
      const a = log.args;
      if (!a?.user || a.amount == null || log.blockNumber == null) continue;
      let ts = tsCache.get(log.blockNumber);
      if (ts === undefined) {
        try {
          const b = await client.getBlock({ blockNumber: log.blockNumber });
          ts = Number(b.timestamp);
          tsCache.set(log.blockNumber, ts);
        } catch { continue; }
      }
      insertCommit.run(
        log.transactionHash?.toLowerCase() ?? "",
        Number(log.logIndex ?? 0),
        a.user.toLowerCase(),
        a.amount.toString(),
        Number(log.blockNumber),
        ts
      );
    }

    setCursor("miner_commits_raw", to);
    if (logs.length > 0 || to === head) {
      console.log(`[community] commits-raw ${from} → ${to} (${logs.length} logs)${to === head ? " [caught up]" : ""}`);
    }
    from = to;
  }
}

// Router LiquidityAdded → community_lp_adds. Only fDOGE/USDC pair counts
// for the public "Provide LP" task tiers. Needs FDOGE address; silently
// no-ops if unset (same pattern as fDOGE-buys).
//
// Uses a deeper backfill + 9999-block range + in-tick catchup loop so
// historical LP providers (from before this poller existed) get credited.
// Without this, only wallets that added LP after the indexer restart
// would show up in the new task tier progress.
async function pollLpAdds(head: bigint) {
  if (!FDOGE) return;
  const fallback = head > LP_ADD_BACKFILL ? head - LP_ADD_BACKFILL : 0n;
  let from = getCursor("forge_router_lp_add", fallback);
  if (from >= head) return;

  for (let iter = 0; iter < LP_ADD_MAX_ITERS; iter++) {
    if (from >= head) break;
    const to = from + LP_ADD_RANGE > head ? head : from + LP_ADD_RANGE;

    let logs;
    try {
      logs = await client.getLogs({
        address: ROUTER,
        event: LIQUIDITY_ADDED_EVENT,
        fromBlock: from,
        toBlock:   to,
      });
    } catch (e: unknown) {
      console.error(`[community] lp-adds getLogs ${from}-${to} failed:`, (e as Error)?.message);
      break;
    }

    let credited = 0;
    for (const log of logs) {
      const a = log.args;
      if (!a?.user || !a.tokenA || !a.tokenB) continue;
      const tA = a.tokenA.toLowerCase();
      const tB = a.tokenB.toLowerCase();
      const isFdogeUsdc = (tA === FDOGE && tB === USDC) || (tA === USDC && tB === FDOGE);
      if (!isFdogeUsdc) continue;

      // Idempotent: skip events we've already credited. Makes cursor resets
      // safe — re-walking the same range cannot double-count.
      const tx = log.transactionHash?.toLowerCase() ?? "";
      const li = Number(log.logIndex ?? 0);
      const ins = db.prepare(
        `INSERT OR IGNORE INTO community_lp_adds_seen (tx, log_index) VALUES (?, ?)`
      ).run(tx, li);
      if (ins.changes === 0) continue;

      const usdcAmount = tA === USDC ? (a.amountA ?? 0n) : (a.amountB ?? 0n);
      addLpProvide(a.user, usdcAmount);
      credited++;
    }

    setCursor("forge_router_lp_add", to);
    if (credited > 0 || to === head) {
      console.log(`[community] lp-adds ${from} → ${to} (${logs.length} logs, ${credited} fDOGE/USDC)${to === head ? " [caught up]" : ""}`);
    }
    from = to;
  }
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
    await Promise.all([pollSwaps(head), pollCommits(head), pollCommitsRaw(head), pollLpAdds(head)]);
  } catch (e: unknown) {
    console.error("[community] tick error", (e as Error)?.message);
  }
}

console.log(`[community indexer] router=${ROUTER} miner=${MINER}`);
tick();
setInterval(tick, POLL_MS);
