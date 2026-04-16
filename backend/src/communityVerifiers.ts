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

import { createPublicClient, http, defineChain, getAddress } from "viem";
import { db } from "./db.js";
import { isChatMember } from "./telegram.js";

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
  if (fn) return fn(user, task, body);
  // Fallback: if the task payload carries `trustBased: true`, award
  // on click without any verification. Lets admins create new social
  // tasks from the UI without code changes.
  const payload = safeJson(task.payload) as { trustBased?: boolean };
  if (payload.trustBased === true) {
    return { ok: true, points: task.points, proof: { type: "trust_based", slug } };
  }
  return { ok: false, reason: "unknown_task" };
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
register("join-telegram",  socialSelfAttest); // legacy, deactivated in migration

// Telegram membership — real verification via bot getChatMember.
// Requires the user to have linked their Telegram first (stored in
// community_users.tg_user_id). If not linked, return a structured
// error the UI converts into a "Link Telegram first" prompt.
async function tgMembershipVerifier(user: User, task: Task): Promise<VerifyResult> {
  const row = db.prepare(
    `SELECT tg_user_id FROM community_users WHERE id = ?`
  ).get(user.id) as { tg_user_id: string | null } | undefined;
  if (!row?.tg_user_id) {
    return { ok: false, reason: "telegram_not_linked" };
  }
  const chat = (safeJson(task.payload) as { chat?: string }).chat;
  if (!chat) return { ok: false, reason: "chat_not_configured" };
  try {
    const joined = await isChatMember(chat, row.tg_user_id);
    if (!joined) return { ok: false, reason: "not_in_chat", meta: { chat } };
    return { ok: true, points: task.points, proof: { chat, tgUserId: row.tg_user_id } };
  } catch (e: unknown) {
    return { ok: false, reason: "telegram_api_error", meta: { msg: (e as Error)?.message } };
  }
}
register("join-tg-channel", tgMembershipVerifier);
register("join-tg-group",   tgMembershipVerifier);

// ============================================================
//                      IDENTITY — on-chain
// ============================================================
// Reads TdogeNames.nameOf(wallet); empty string = no name claimed.
register("claim-fdoge-name", async (user, task) => {
  const raw = process.env.TDOGE_NAMES_ADDRESS;
  if (!raw) return { ok: false, reason: "names_address_unset" };
  // viem rejects addresses whose mixed-case doesn't match the EIP-55
  // checksum. Normalise to avoid "address invalid" throws from a
  // lower/upper-case env entry.
  let namesAddr: `0x${string}`;
  let wallet:    `0x${string}`;
  try {
    namesAddr = getAddress(raw);
    wallet    = getAddress(user.wallet);
  } catch {
    return { ok: false, reason: "bad_address" };
  }
  try {
    const name = await client().readContract({
      address: namesAddr,
      abi: NAMES_ABI,
      functionName: "nameOf",
      args: [wallet],
    });
    if (!name || String(name).length === 0) {
      return { ok: false, reason: "no_name_yet", meta: { hint: "Claim your .fdoge identity at dogeforge.fun/id" } };
    }
    return { ok: true, points: task.points, proof: { name } };
  } catch (e: unknown) {
    const msg = (e as { shortMessage?: string; message?: string }).shortMessage
      ?? (e as Error)?.message ?? "";
    console.error("[identity] rpc error:", msg);
    return { ok: false, reason: "rpc_error", meta: { msg } };
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
//                      DAILY TWEET — oEmbed + snowflake
// ============================================================
// Verification without a paid X API tier:
//   - Tweet id parsed from URL.
//   - Age derived from the id itself: X snowflake IDs encode the
//     creation ms (epoch 1288834974657).
//   - Author handle + text pulled from publish.twitter.com/oembed
//     (public, unauthenticated, no rate limit).
//
// Successful submissions write to community_daily_tweets; the UNIQUE
// (user_id, day) constraint blocks multiple per day at the DB layer.

const X_SNOWFLAKE_EPOCH = 1288834974657;

function tweetIdFromUrl(url: string): string | null {
  const m = url.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d{5,})/i);
  return m?.[1] ?? null;
}
function tweetTimestampMs(id: string): number | null {
  try {
    const n = BigInt(id);
    // The top 22 bits of the id are the ms-since-Twitter-epoch timestamp.
    return Number((n >> 22n)) + X_SNOWFLAKE_EPOCH;
  } catch { return null; }
}
function handleFromAuthorUrl(u: string): string | null {
  const m = u.match(/(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})/i);
  return m?.[1] ?? null;
}
function textFromOembedHtml(html: string): string {
  // oEmbed returns: <blockquote ...><p lang="..." dir="...">TWEET TEXT</p>...
  // Strip tags; decode HTML entities in the remaining text.
  const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  const raw = pMatch?.[1] ?? html;
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

register("daily-tweet", async (user, task, body) => {
  const url = String((body as { tweetUrl?: string })?.tweetUrl ?? "").trim();
  if (!url) return { ok: false, reason: "missing_tweet_url" };
  const id = tweetIdFromUrl(url);
  if (!id) return { ok: false, reason: "bad_tweet_url" };

  // 1-per-UTC-day cap.
  const today = new Date().toISOString().slice(0, 10);
  if (db.prepare(`SELECT id FROM community_daily_tweets WHERE user_id = ? AND day = ?`).get(user.id, today)) {
    return { ok: false, reason: "already_today" };
  }
  // Tweet ids are globally unique — no double-claim across users.
  if (db.prepare(`SELECT id FROM community_daily_tweets WHERE tweet_id = ?`).get(id)) {
    return { ok: false, reason: "tweet_already_claimed" };
  }

  // Age gate via snowflake — no API call needed.
  const tsMs = tweetTimestampMs(id);
  if (tsMs == null) return { ok: false, reason: "bad_tweet_url" };
  const ageMs = Date.now() - tsMs;
  if (ageMs < 0)                 return { ok: false, reason: "tweet_in_future" };
  if (ageMs > 24 * 3600 * 1000) return { ok: false, reason: "tweet_too_old" };

  // Fetch oEmbed. Public, unauthenticated, caches at X's edge.
  let oe: { author_name?: string; author_url?: string; html?: string };
  try {
    const res = await fetch(
      `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`,
      { headers: { "User-Agent": "DogeForgeCommunity/1.0" } },
    );
    if (res.status === 404) return { ok: false, reason: "tweet_not_found" };
    if (!res.ok) return { ok: false, reason: "oembed_error", meta: { status: res.status } };
    oe = await res.json();
  } catch (e: unknown) {
    return { ok: false, reason: "oembed_unreachable", meta: { msg: (e as Error)?.message } };
  }

  // Author handle comparison (case-insensitive).
  const handle = oe.author_url ? handleFromAuthorUrl(oe.author_url) : null;
  if (!handle || handle.toLowerCase() !== user.x_handle.toLowerCase()) {
    return { ok: false, reason: "wrong_author", meta: { expected: user.x_handle, got: handle } };
  }

  // Required tokens.
  const required = (safeJson(task.payload) as { requireTokens?: string[] }).requireTokens ?? [];
  const text = textFromOembedHtml(oe.html ?? "").toLowerCase();
  const missing = required.filter((tok) => !text.includes(tok.toLowerCase()));
  if (missing.length > 0) {
    return { ok: false, reason: "missing_tokens", meta: { missing, required } };
  }

  db.prepare(
    `INSERT INTO community_daily_tweets (user_id, tweet_id, url, day, status, checked_at)
     VALUES (?, ?, ?, ?, 'verified', ?)`
  ).run(user.id, id, url, today, Math.floor(Date.now() / 1000));

  return { ok: true, points: task.points, proof: { tweetId: id } };
});

// ============================================================
//                      QUIZ — whitepaper recall, 5 questions
// ============================================================
// Body shape: { answers: number[] } — index per question.
// All-or-nothing: any wrong answer rejects the submission with the
// indices that were wrong (so the UI can highlight them).
//
// Single-attempt cap is enforced by community_completions.max=1 on the
// task def; once awarded, the row exists and re-claims are blocked
// upstream. Wrong submissions don't insert anything, so users can
// retry — that's intentional: this is engagement, not a barrier.
//
// Question text is server-authoritative. A separate GET endpoint
// exposes question + options (without correct indices) for the UI.

export const QUIZ_QUESTIONS = [
  {
    q: "What is the initial hard cap on fDOGE supply?",
    options: ["21,000,000", "100,000,000", "210,000,000", "Unlimited"],
    correct: 2,
  },
  {
    q: "How is gas paid on Arc?",
    options: ["ETH", "A native ARC token", "USDC", "Transactions are free"],
    correct: 2,
  },
  {
    q: "What happens to the 0.10% platform fee charged on every swap?",
    options: [
      "It's burned",
      "It goes to a treasury EOA",
      "It flows to the LiquidityManager, deepening fDOGE liquidity",
      "It's distributed to fDOGE holders pro-rata",
    ],
    correct: 2,
  },
  {
    q: "How do miners earn fDOGE?",
    options: [
      "By staking fDOGE tokens",
      "By committing USDC which converts continuously into fDOGE rewards",
      "By running a validator node on Arc",
      "By holding an NFT that mints fDOGE each block",
    ],
    correct: 1,
  },
  {
    q: "Which of these is enforced in the DOGE FORGE code?",
    options: [
      "Admin can mint unlimited fDOGE for airdrops",
      "removeLiquidity is blocked whenever the router is paused",
      "Only whitelisted minters (Miner and LiquidityManager) may mint fDOGE",
      "Users need approval before every transfer",
    ],
    correct: 2,
  },
  {
    q: "What is required to claim a .fdoge identity?",
    options: [
      "Hold 10,000 fDOGE in your wallet",
      "Be early (first 1,000 wallets)",
      "Pay a USDC fee AND have at least one position in the Miner",
      "Mint a free NFT from the Names contract",
    ],
    correct: 2,
  },
  {
    q: "After the 210M initial cap is reached, supply inflation is…",
    options: [
      "Fixed forever — no more minting is possible",
      "Unlimited, set by whoever holds governance",
      "Bounded by a hard ceiling (max 5%/year), admin-adjustable, pausable",
      "Doubled every four years",
    ],
    correct: 2,
  },
];

register("quiz-whitepaper", async (_user, task, body) => {
  const submitted = (body as { answers?: unknown }).answers;
  if (!Array.isArray(submitted) || submitted.length !== QUIZ_QUESTIONS.length) {
    return { ok: false, reason: "bad_answers" };
  }
  const wrong: number[] = [];
  for (let i = 0; i < QUIZ_QUESTIONS.length; i++) {
    if (Number(submitted[i]) !== QUIZ_QUESTIONS[i].correct) wrong.push(i);
  }
  if (wrong.length > 0) {
    return { ok: false, reason: "wrong_answers", meta: { wrongIndices: wrong, total: QUIZ_QUESTIONS.length } };
  }
  return { ok: true, points: task.points, proof: { passed: true } };
});

// ============================================================
//                      TRADE & MINE — on-chain volume
// ============================================================
// Reads running totals maintained by communityIndexer.ts. The
// threshold is read from each task's payload JSON (in USD, converted
// to USDC wei: 6 decimals). If the indexer hasn't seen the wallet
// yet, the row is missing — treated as zero, returns "below_threshold".

function parseWei(s: unknown): bigint {
  if (s == null) return 0n;
  const str = String(s).split(".")[0] || "0";
  try { return BigInt(str); } catch { return 0n; }
}
function tradeVolumeUsdcWei(wallet: string): bigint {
  const row = db.prepare(
    `SELECT usdc_in_total FROM community_trade_volume WHERE wallet = ?`
  ).get(wallet.toLowerCase()) as { usdc_in_total: string } | undefined;
  return parseWei(row?.usdc_in_total);
}
function mineVolumeUsdcWei(wallet: string): bigint {
  const row = db.prepare(
    `SELECT usdc_committed_total FROM community_mine_volume WHERE wallet = ?`
  ).get(wallet.toLowerCase()) as { usdc_committed_total: string } | undefined;
  return parseWei(row?.usdc_committed_total);
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
