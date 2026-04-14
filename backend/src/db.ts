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
`);
