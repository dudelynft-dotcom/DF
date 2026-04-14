import "dotenv/config";
import express from "express";
import cors from "cors";
import { db } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN = process.env.ADMIN_TOKEN ?? "";

app.get("/health", (_req, res) => res.json({ ok: true }));

/// GET /tokens?view=all|verified|unverified
/// Returns discovered tokens. `hidden` tokens are always excluded.
app.get("/tokens", (req, res) => {
  const view = String(req.query.view ?? "all");
  let where = "hidden = 0";
  if (view === "verified")   where += " AND verified = 1";
  if (view === "unverified") where += " AND verified = 0";
  const rows = db.prepare(
    `SELECT address, symbol, name, decimals, verified, first_seen, creator, last_block
     FROM tokens
     WHERE ${where}
     ORDER BY verified DESC, first_seen DESC
     LIMIT 500`
  ).all() as any[];
  res.json({
    tokens: rows.map((r) => ({
      address: r.address,
      symbol: r.symbol,
      name: r.name,
      decimals: r.decimals,
      verified: !!r.verified,
      first_seen: r.first_seen,
      creator: r.creator,
      last_block: r.last_block,
    })),
  });
});

/// GET /tokens/:address — single token detail
app.get("/tokens/:address", (req, res) => {
  const addr = String(req.params.address).toLowerCase();
  const row = db.prepare(`SELECT * FROM tokens WHERE address = ?`).get(addr);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (req.headers.authorization !== `Bearer ${ADMIN}`) {
    res.status(401).end();
    return false;
  }
  return true;
}

/// GET /prices/:pair?interval=1h&limit=100
/// Returns OHLC candles aggregated from `swaps` for the given pair.
/// interval: 1m | 5m | 15m | 1h | 4h | 1d   (default 1h)
/// limit:    max candles (default 100, capped at 500)
app.get("/prices/:pair", (req, res) => {
  const pair = String(req.params.pair).toLowerCase();
  const interval = String(req.query.interval ?? "1h");
  const limit    = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));

  const bucketSec: Record<string, number> = {
    "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400,
  };
  const step = bucketSec[interval];
  if (!step) return res.status(400).json({ error: "bad interval" });

  // Group swaps into time buckets. SQLite lacks window functions in older
  // builds — this is the portable form.
  const rows = db.prepare(
    `SELECT
       (timestamp / ?) * ?             AS ts,
       MIN(price_num)                  AS low,
       MAX(price_num)                  AS high,
       (SELECT price_num FROM swaps s2
         WHERE s2.pair = s.pair
           AND (s2.timestamp / ?) * ? = (s.timestamp / ?) * ?
         ORDER BY s2.timestamp ASC, s2.log_index ASC LIMIT 1) AS open,
       (SELECT price_num FROM swaps s2
         WHERE s2.pair = s.pair
           AND (s2.timestamp / ?) * ? = (s.timestamp / ?) * ?
         ORDER BY s2.timestamp DESC, s2.log_index DESC LIMIT 1) AS close,
       COUNT(*)                        AS trades
     FROM swaps s
     WHERE pair = ?
     GROUP BY ts
     ORDER BY ts DESC
     LIMIT ?`,
  ).all(step, step, step, step, step, step, step, step, step, step, pair, limit) as Array<{
    ts: number; low: number; high: number; open: number; close: number; trades: number;
  }>;

  // Reverse so oldest-first for chart libs.
  res.json({
    pair,
    interval,
    candles: rows.reverse().map((r) => ({
      time:   r.ts,
      open:   r.open,
      high:   r.high,
      low:    r.low,
      close:  r.close,
      trades: r.trades,
    })),
  });
});

/// POST /admin/verify  { address, verified }
app.post("/admin/verify", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { address, verified } = req.body as { address: string; verified: boolean };
  db.prepare(`UPDATE tokens SET verified = ? WHERE address = ?`)
    .run(verified ? 1 : 0, String(address).toLowerCase());
  res.json({ ok: true });
});

/// POST /admin/hide  { address, hidden }
app.post("/admin/hide", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { address, hidden } = req.body as { address: string; hidden: boolean };
  db.prepare(`UPDATE tokens SET hidden = ? WHERE address = ?`)
    .run(hidden ? 1 : 0, String(address).toLowerCase());
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`backend on :${port}`));
