import Database from "better-sqlite3";
import "dotenv/config";

export const db = new Database(process.env.DB_PATH ?? "./forge.db");
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
`);
