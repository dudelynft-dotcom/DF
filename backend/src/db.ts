import Database from "better-sqlite3";
import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.env.DB_PATH ?? "./forge.db";
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS tokens (
  address     TEXT PRIMARY KEY,   -- lowercased hex
  symbol      TEXT,
  name        TEXT,
  decimals    INTEGER,
  verified    INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  first_seen  INTEGER NOT NULL,
  creator     TEXT,
  last_block  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS indexer_cursor (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  last_block  INTEGER NOT NULL
);

-- Raw Uniswap-V2 style Swap events for tracked pairs.
-- One row per emitted Swap log. Price-per-token0 (in token1 units) is
-- computed on insert using the reserves AT the time of the swap (so we
-- capture execution price, not a stale reserve read).
CREATE TABLE IF NOT EXISTS swaps (
  pair        TEXT NOT NULL,       -- lowercased pair address
  block       INTEGER NOT NULL,
  tx          TEXT NOT NULL,
  log_index   INTEGER NOT NULL,
  timestamp   INTEGER NOT NULL,    -- unix seconds
  amount0_in  TEXT NOT NULL,       -- bigint strings
  amount1_in  TEXT NOT NULL,
  amount0_out TEXT NOT NULL,
  amount1_out TEXT NOT NULL,
  price_num   REAL NOT NULL,       -- price of token0 in token1 (float, for chart speed)
  PRIMARY KEY (pair, tx, log_index)
);
CREATE INDEX IF NOT EXISTS idx_swaps_pair_ts ON swaps(pair, timestamp DESC);

CREATE TABLE IF NOT EXISTS price_cursor (
  pair        TEXT PRIMARY KEY,
  last_block  INTEGER NOT NULL
);

-- ============================================================
-- Community points system (Season 1)
-- ============================================================
-- One row per verified X↔wallet binding. This is the canonical identity
-- for the community app; every other table here FKs back to it.
CREATE TABLE IF NOT EXISTS community_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  x_id        TEXT NOT NULL UNIQUE,       -- Twitter user id (numeric string)
  x_handle    TEXT NOT NULL,
  x_avatar    TEXT,
  x_created   TEXT,                       -- ISO timestamp, for age checks
  wallet      TEXT NOT NULL UNIQUE,       -- lowercased 0x address
  referrer_id INTEGER REFERENCES community_users(id),
  tier        TEXT NOT NULL DEFAULT 'bronze',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_users_wallet ON community_users(wallet);

-- Task catalog. Admin-defined. 'kind' categorises for the dashboard UI.
-- 'payload' is free-form JSON for task-specific data (required handle,
-- threshold amount, etc.)
CREATE TABLE IF NOT EXISTS community_task_defs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL,         -- social | trade | mine | identity | daily | quiz
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  points           INTEGER NOT NULL,
  max_completions  INTEGER NOT NULL DEFAULT 1, -- -1 = unlimited (e.g. daily)
  payload          TEXT NOT NULL DEFAULT '{}', -- JSON string
  active           INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

-- One row per (user, task, nth-completion) completion. Proof is the
-- verification evidence (tweet id, tx hash, etc.) so we can audit.
CREATE TABLE IF NOT EXISTS community_completions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES community_users(id),
  task_id        INTEGER NOT NULL REFERENCES community_task_defs(id),
  completed_at   INTEGER NOT NULL,
  proof          TEXT NOT NULL DEFAULT '{}',
  points_awarded INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_completions_user ON community_completions(user_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_completions_task ON community_completions(task_id, completed_at DESC);

-- Append-only points ledger. Users' point totals are sum(delta). Every
-- mutation is traceable by ref_id — for completions it's completion.id,
-- for referrals it's referee user_id, etc.
CREATE TABLE IF NOT EXISTS community_points_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES community_users(id),
  delta      INTEGER NOT NULL,         -- can be negative for corrections
  reason     TEXT NOT NULL,            -- task | referral | streak | admin_adjustment
  ref_id     INTEGER,                  -- fk interpretation depends on reason
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON community_points_ledger(user_id, created_at DESC);

-- Daily tweet submissions. Tweet ids are globally unique on X; we index
-- on (user, day) to enforce 1/day cadence at the DB layer.
CREATE TABLE IF NOT EXISTS community_daily_tweets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES community_users(id),
  tweet_id   TEXT NOT NULL UNIQUE,
  url        TEXT NOT NULL,
  day        TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  status     TEXT NOT NULL,            -- pending | verified | rejected
  reason     TEXT,                     -- rejection detail if status=rejected
  checked_at INTEGER,
  UNIQUE (user_id, day)
);

-- Referral edges. referrer gets N% of referee's lifetime points.
CREATE TABLE IF NOT EXISTS community_referrals (
  referrer_id   INTEGER NOT NULL REFERENCES community_users(id),
  referee_id    INTEGER NOT NULL REFERENCES community_users(id),
  locked_in_at  INTEGER NOT NULL,
  PRIMARY KEY (referrer_id, referee_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON community_referrals(referee_id);

-- Per-wallet running totals derived from on-chain events. Updated by
-- communityIndexer.ts as it walks ForgeRouter.Swap and Miner.Committed.
-- USDC values stored as bigint strings (6-decimal wei). One row per
-- wallet for fast threshold checks.
CREATE TABLE IF NOT EXISTS community_trade_volume (
  wallet         TEXT PRIMARY KEY,        -- lowercased 0x address
  usdc_in_total  TEXT NOT NULL DEFAULT '0',
  swap_count     INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS community_mine_volume (
  wallet               TEXT PRIMARY KEY,
  usdc_committed_total TEXT NOT NULL DEFAULT '0',
  position_count       INTEGER NOT NULL DEFAULT 0,
  updated_at           INTEGER NOT NULL
);

-- Event cursors per (source, address). Independent from the existing
-- indexer_cursor so the community indexer can run alongside.
CREATE TABLE IF NOT EXISTS community_event_cursor (
  source     TEXT PRIMARY KEY,        -- 'forge_router_swap' | 'miner_committed'
  last_block INTEGER NOT NULL
);
`);

// ------------------------------------------------------------------
// Seed the task catalog on first boot. Re-runnable: uses INSERT OR IGNORE
// on the slug UNIQUE constraint. Editing a seeded row by hand in the DB
// is fine; this never overwrites.
// ------------------------------------------------------------------
const seedTask = db.prepare(`
  INSERT OR IGNORE INTO community_task_defs
    (slug, kind, title, description, points, max_completions, payload, sort_order)
  VALUES (@slug, @kind, @title, @description, @points, @max, json(@payload), @sort)
`);
const SEED = [
  // --- Social (one-time) ---
  { slug: "follow-x",        kind: "social", title: "Follow @DogeForgefun on X", description: "Follow the official DOGE FORGE account.", points: 100, max: 1, payload: '{"handle":"DogeForgefun"}', sort: 10 },
  { slug: "retweet-launch",  kind: "social", title: "Retweet the launch post",     description: "Retweet our pinned launch announcement.", points: 75,  max: 1, payload: '{}',                        sort: 12 },
  { slug: "join-tg-channel", kind: "social", title: "Join the official Telegram channel", description: "Announcements channel. Link your Telegram first; we verify membership on-chain via bot.", points: 100, max: 1, payload: '{"chat":"@DogeForgeAnn","url":"https://t.me/DogeForgeAnn"}', sort: 13 },
  { slug: "join-tg-group",   kind: "social", title: "Join the Telegram community",        description: "Community chat. Link Telegram first; verified via bot, no self-attest.",                points: 75,  max: 1, payload: '{"chat":"@dogeforge","url":"https://t.me/dogeforge"}',    sort: 14 },

  // --- Trade volume tiers ---
  { slug: "trade-100",   kind: "trade", title: "Trade $100 volume",   description: "Route $100 through the DOGE FORGE DEX on Arc testnet. Uses testnet USDC (free from faucet).",   points: 150,  max: 1, payload: '{"thresholdUsd":100}',   sort: 20 },
  { slug: "trade-1000",  kind: "trade", title: "Trade $1,000 volume", description: "Route $1,000 through the DOGE FORGE DEX on Arc testnet. Uses testnet USDC.", points: 500,  max: 1, payload: '{"thresholdUsd":1000}',  sort: 21 },
  { slug: "trade-5000",  kind: "trade", title: "Trade $5,000 volume", description: "Route $5,000 on Arc testnet. Get testnet USDC free at faucet.circle.com.", points: 1500, max: 1, payload: '{"thresholdUsd":5000}',  sort: 22 },
  { slug: "trade-25000", kind: "trade", title: "Trade $25,000 volume",description: "Whale tier: $25,000 total volume on Arc testnet.",         points: 5000, max: 1, payload: '{"thresholdUsd":25000}', sort: 23 },

  // --- Mine commitment tiers ---
  { slug: "mine-100",   kind: "mine", title: "Mine with $100",   description: "Commit $100 testnet USDC to the miner. Free from faucet.circle.com.",   points: 150,  max: 1, payload: '{"thresholdUsd":100}',   sort: 30 },
  { slug: "mine-500",   kind: "mine", title: "Mine with $500",   description: "Commit $500 testnet USDC to the miner.",   points: 400,  max: 1, payload: '{"thresholdUsd":500}',   sort: 31 },
  { slug: "mine-1000",  kind: "mine", title: "Mine with $1,000", description: "Commit $1,000 testnet USDC to the miner.", points: 800,  max: 1, payload: '{"thresholdUsd":1000}',  sort: 32 },
  { slug: "mine-5000",  kind: "mine", title: "Mine with $5,000", description: "Commit $5,000 testnet USDC to the miner.", points: 3000, max: 1, payload: '{"thresholdUsd":5000}',  sort: 33 },

  // --- Identity ---
  { slug: "claim-fdoge-name", kind: "identity", title: "Claim your .fdoge identity", description: "Register your on-chain name at TdogeNames.", points: 300, max: 1, payload: '{}', sort: 40 },

  // --- Daily + streak ---
  { slug: "daily-tweet",   kind: "daily", title: "Daily tweet",    description: "Tweet about DOGE FORGE daily with $FDOGE and @DogeForgefun. 1 per day.", points: 100, max: -1, payload: '{"requireTokens":["$FDOGE","@DogeForgefun"]}', sort: 50 },
  { slug: "daily-checkin", kind: "daily", title: "Daily check-in", description: "Open the app daily. 7-day streak = +50 bonus, 30-day = +500.",            points: 5,  max: -1, payload: '{}',                                           sort: 51 },

  // --- Quiz (Step 9) ---
  { slug: "quiz-whitepaper", kind: "quiz", title: "Whitepaper quiz", description: "Read the paper, answer 5 questions. Unlocks once.", points: 200, max: 1, payload: '{}', sort: 60 },
];

for (const t of SEED) seedTask.run(t);

// One-off migrations for previously-seeded rows. Safe to re-run.
db.prepare(`UPDATE community_task_defs SET active = 0 WHERE slug = 'follow-arc'`).run();
db.prepare(`UPDATE community_task_defs SET active = 0 WHERE slug = 'join-telegram'`).run();
db.prepare(`UPDATE community_task_defs SET points = 100 WHERE slug = 'daily-tweet'`).run();

// Clarify testnet USDC in trade/mine descriptions (users confused about mainnet).
db.prepare(`UPDATE community_task_defs SET description = 'Route $100 through the DOGE FORGE DEX on Arc testnet. Uses testnet USDC (free from faucet).' WHERE slug = 'trade-100'`).run();
db.prepare(`UPDATE community_task_defs SET description = 'Route $1,000 through the DOGE FORGE DEX on Arc testnet. Uses testnet USDC.' WHERE slug = 'trade-1000'`).run();
db.prepare(`UPDATE community_task_defs SET description = 'Route $5,000 on Arc testnet. Get testnet USDC free at faucet.circle.com.' WHERE slug = 'trade-5000'`).run();
db.prepare(`UPDATE community_task_defs SET description = 'Whale tier: $25,000 total volume on Arc testnet.' WHERE slug = 'trade-25000'`).run();
db.prepare(`UPDATE community_task_defs SET description = 'Commit $100 testnet USDC to the miner. Free from faucet.circle.com.' WHERE slug = 'mine-100'`).run();
db.prepare(`UPDATE community_task_defs SET description = 'Commit $500 testnet USDC to the miner.' WHERE slug = 'mine-500'`).run();
db.prepare(`UPDATE community_task_defs SET description = 'Commit $1,000 testnet USDC to the miner.' WHERE slug = 'mine-1000'`).run();
db.prepare(`UPDATE community_task_defs SET description = 'Commit $5,000 testnet USDC to the miner.' WHERE slug = 'mine-5000'`).run();

// Add tg_user_id / tg_username columns. SQLite has no
// ALTER IF NOT EXISTS — introspect PRAGMA first.
const cols = db.prepare(`PRAGMA table_info(community_users)`).all() as Array<{ name: string }>;
if (!cols.some((c) => c.name === "tg_user_id")) {
  db.exec(`ALTER TABLE community_users ADD COLUMN tg_user_id TEXT`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_community_users_tg ON community_users(tg_user_id) WHERE tg_user_id IS NOT NULL`);
}
if (!cols.some((c) => c.name === "tg_username")) {
  db.exec(`ALTER TABLE community_users ADD COLUMN tg_username TEXT`);
}
// Banned users: `banned` (0/1) + reason + timestamp. Ban is soft —
// we don't DELETE rows because ledger entries FK back to them; we
// negate their point total via a ledger entry + set banned=1 so
// the UI greys them out and /claim bounces with "banned".
if (!cols.some((c) => c.name === "banned")) {
  db.exec(`ALTER TABLE community_users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE community_users ADD COLUMN banned_at INTEGER`);
  db.exec(`ALTER TABLE community_users ADD COLUMN banned_reason TEXT`);
}
