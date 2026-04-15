// Verifier dispatcher for community task claims.
//
// Each task slug maps to a verifier function. The verifier returns
// either { ok: true, points } to award the task, or { ok: false, reason }
// to reject. Awarding inserts a completion + ledger row in the same
// transaction.
//
// Verifier categories:
//   - on-chain (identity, trade, mine): read state from the indexer or
//     RPC.
//   - off-chain attest (social): trust-based, mark complete on click.
//     Future tightening with full X follower-graph API ($).
//   - cadence (daily-checkin, daily-tweet): timestamp gates.

import { createPublicClient, http, getContract } from "viem";
import { defineChain } from "viem";
import { db } from "./db.js";

// ---------- arc client (lazy) ----------
const arc = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network"] } },
});
let _client: ReturnType<typeof createPublicClient> | null = null;
function client() {
  if (!_client) _client = createPublicClient({ chain: arc, transport: http() });
  return _client;
}

const NAMES_ABI = [
  { type: "function", name: "nameOf", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "string" }] },
] as const;

// ---------- shared types ----------
export type User = {
  id: number;
  x_id: string;
  x_handle: string;
  wallet: string;
};
export type Task = {
  id: number;
  slug: string;
  kind: string;
  points: number;
  max_completions: number;
  payload: string; // JSON
};
export type VerifyResult =
  | { ok: true;  points: number; proof?: Record<string, unknown> }
  | { ok: false; reason: string; meta?: Record<string, unknown> };

// ---------- verifier registry ----------
type Verifier = (user: User, task: Task, body: Record<string, unknown>) => Promise<VerifyResult>;
const verifiers: Record<string, Verifier> = {};

function register(slug: string, fn: Verifier) { verifiers[slug] = fn; }
export function isKnownTask(slug: string): boolean { return slug in verifiers; }
export async function runVerifier(
  slug: string, user: User, task: Task, body: Record<string, unknown>,
): Promise<VerifyResult> {
  const fn = verifiers[slug];
  if (!fn) return { ok: false, reason: "unknown_task" };
  return fn(user, task, body);
}

// ============================================================
//                      SOCIAL — self-attest
// ============================================================
// Without paid X API write-perms we cannot programmatically verify
// follows or retweets. We mark these complete on click and trust the
// user — Step 7 layer adds spot-check against the X public follower
// API, and bad actors can be reversed via admin_adjustment ledger entry.
async function socialSelfAttest(_u: User, t: Task, _b: Record<string, unknown>): Promise<VerifyResult> {
  return { ok: true, points: t.points, proof: { type: "self_attest" } };
}
register("follow-x",       socialSelfAttest);
register("follow-arc",     socialSelfAttest);
register("retweet-launch", socialSelfAttest);
register("join-telegram",  socialSelfAttest);

// ============================================================
//                      IDENTITY — on-chain
// ============================================================
// Reads TdogeNames.nameOf(wallet); empty string = no name claimed.
register("claim-fdoge-name", async (user, task) => {
  const namesAddr = process.env.TDOGE_NAMES_ADDRESS as `0x${string}` | undefined;
  if (!namesAddr) return { ok: false, reason: "names_address_unset" };
  try {
    const c = getContract({ address: namesAddr, abi: NAMES_ABI, client: client() });
    const name = await c.read.nameOf([user.wallet as `0x${string}`]);
    if (!name || (name as string).length === 0) {
      return { ok: false, reason: "no_name_yet", meta: { hint: "Claim your .fdoge identity at dogeforge.fun/id" } };
    }
    return { ok: true, points: task.points, proof: { name } };
  } catch (e: unknown) {
    return { ok: false, reason: "rpc_error", meta: { msg: (e as Error)?.message } };
  }
});

// ============================================================
//                      DAILY CHECK-IN
// ============================================================
// 1 per UTC day. 7-day streak = +50 bonus, 30-day = +500 bonus.
// Streak resets if the user misses a day.
register("daily-checkin", async (user, task) => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

  const last = db.prepare(
    `SELECT proof, completed_at FROM community_completions
     WHERE user_id = ? AND task_id = ? ORDER BY completed_at DESC LIMIT 1`
  ).get(user.id, task.id) as { proof: string; completed_at: number } | undefined;

  if (last) {
    const lastProof = safeJson(last.proof) as { day?: string; streak?: number };
    if (lastProof.day === today) {
      return { ok: false, reason: "already_today" };
    }
    const newStreak = lastProof.day === yesterday ? (lastProof.streak ?? 1) + 1 : 1;
    let bonus = 0;
    if (newStreak === 7)  bonus = 50;
    if (newStreak === 30) bonus = 500;
    return { ok: true, points: task.points + bonus, proof: { day: today, streak: newStreak, bonus } };
  }
  return { ok: true, points: task.points, proof: { day: today, streak: 1, bonus: 0 } };
});

// ============================================================
//                      DAILY TWEET — stub (Step 6 wires X API)
// ============================================================
register("daily-tweet", async (_u, _t, body) => {
  // Body should carry { tweetUrl } from Step 6's submission UI. For now
  // refuse so users can't farm without Step 6 in place.
  void body;
  return { ok: false, reason: "tweet_verification_not_live", meta: { eta: "step 6" } };
});

// ============================================================
//                      QUIZ — stub (Step 9 wires answer check)
// ============================================================
register("quiz-whitepaper", async () => {
  return { ok: false, reason: "quiz_not_live", meta: { eta: "step 9" } };
});

// ============================================================
//                      TRADE & MINE — on-chain volume
// ============================================================
// Reads running totals maintained by communityIndexer.ts. The
// threshold is read from each task's payload JSON (in USD, converted
// to USDC wei: 6 decimals). If the indexer hasn't seen the wallet
// yet, the row is missing — treated as zero, returns "below_threshold".

function tradeVolumeUsdcWei(wallet: string): bigint {
  const row = db.prepare(
    `SELECT usdc_in_total FROM community_trade_volume WHERE wallet = ?`
  ).get(wallet.toLowerCase()) as { usdc_in_total: string } | undefined;
  return row ? BigInt(row.usdc_in_total) : 0n;
}
function mineVolumeUsdcWei(wallet: string): bigint {
  const row = db.prepare(
    `SELECT usdc_committed_total FROM community_mine_volume WHERE wallet = ?`
  ).get(wallet.toLowerCase()) as { usdc_committed_total: string } | undefined;
  return row ? BigInt(row.usdc_committed_total) : 0n;
}

function tradeVerifier(user: User, task: Task): VerifyResult {
  const payload = safeJson(task.payload) as { thresholdUsd?: number };
  const usd = Number(payload.thresholdUsd ?? 0);
  if (!usd) return { ok: false, reason: "bad_threshold" };
  const need  = BigInt(usd) * 1_000_000n; // USDC = 6 decimals
  const have  = tradeVolumeUsdcWei(user.wallet);
  if (have < need) {
    return { ok: false, reason: "below_threshold", meta: {
      progressUsd: Number(have / 1_000_000n),
      thresholdUsd: usd,
    } };
  }
  return { ok: true, points: task.points, proof: { volumeUsd: Number(have / 1_000_000n) } };
}
function mineVerifier(user: User, task: Task): VerifyResult {
  const payload = safeJson(task.payload) as { thresholdUsd?: number };
  const usd = Number(payload.thresholdUsd ?? 0);
  if (!usd) return { ok: false, reason: "bad_threshold" };
  const need = BigInt(usd) * 1_000_000n;
  const have = mineVolumeUsdcWei(user.wallet);
  if (have < need) {
    return { ok: false, reason: "below_threshold", meta: {
      progressUsd: Number(have / 1_000_000n),
      thresholdUsd: usd,
    } };
  }
  return { ok: true, points: task.points, proof: { committedUsd: Number(have / 1_000_000n) } };
}

register("trade-100",   async (u, t) => tradeVerifier(u, t));
register("trade-1000",  async (u, t) => tradeVerifier(u, t));
register("trade-5000",  async (u, t) => tradeVerifier(u, t));
register("trade-25000", async (u, t) => tradeVerifier(u, t));
register("mine-100",   async (u, t) => mineVerifier(u, t));
register("mine-500",   async (u, t) => mineVerifier(u, t));
register("mine-1000",  async (u, t) => mineVerifier(u, t));
register("mine-5000",  async (u, t) => mineVerifier(u, t));

// Public helpers so /community/me can show progress bars without a
// separate verification endpoint round-trip.
export function getTradeVolumeUsd(wallet: string): number {
  return Number(tradeVolumeUsdcWei(wallet) / 1_000_000n);
}
export function getMineVolumeUsd(wallet: string): number {
  return Number(mineVolumeUsdcWei(wallet) / 1_000_000n);
}

// ---------- helpers ----------
function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
