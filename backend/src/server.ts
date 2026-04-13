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
