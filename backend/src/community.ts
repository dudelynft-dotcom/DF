// Community points API. Mounted under /community/* by server.ts.
//
// Authentication model: the caller (the community Next.js app) attaches
// a bearer token derived from a shared secret + the session's X id +
// wallet. This keeps the backend stateless re: X OAuth while still
// preventing anyone from binding a random wallet to someone else's X.
//
// Auth header:  Authorization: Bearer <hmac-sha256(secret, xId|wallet)>
// Request body: every mutation includes { xId, xHandle, wallet } so the
// server can recompute the HMAC and compare.

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { db } from "./db.js";
import { getMineVolumeUsd, getTradeVolumeUsd, isKnownTask, runVerifier } from "./communityVerifiers.js";

export const community = Router();

function sharedSecret(): Buffer {
  const s = process.env.COMMUNITY_SHARED_SECRET;
  if (!s || s.length < 32) {
    throw new Error("COMMUNITY_SHARED_SECRET must be set (32+ chars)");
  }
  return Buffer.from(s, "utf8");
}

function expectedHmac(xId: string, wallet: string): string {
  return crypto
    .createHmac("sha256", sharedSecret())
    .update(`${xId}|${wallet.toLowerCase()}`)
    .digest("hex");
}

// Per-request auth. Middleware-style but inline so each route can read
// the already-parsed body for HMAC re-computation.
function verifyCaller(req: Request, res: Response): boolean {
  const auth = req.headers.authorization ?? "";
  const got  = auth.replace(/^Bearer\s+/i, "");
  const { xId, wallet } = (req.body ?? {}) as { xId?: string; wallet?: string };
  if (!xId || !wallet) {
    res.status(400).json({ error: "missing_xid_or_wallet" });
    return false;
  }
  const want = expectedHmac(xId, wallet);
  if (got.length !== want.length ||
      !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    res.status(401).json({ error: "bad_caller_signature" });
    return false;
  }
  return true;
}

// ------------------------------------------------------------------
// POST /community/bind-wallet
// Idempotent-ish: if the (xId, wallet) already exists we return the
// stored row; duplicates on one side raise 409.
// ------------------------------------------------------------------
community.post("/bind-wallet", (req, res) => {
  if (!verifyCaller(req, res)) return;
  const { xId, xHandle, xAvatar, xCreated, wallet, referrerCode } = req.body as {
    xId: string; xHandle: string; xAvatar?: string; xCreated?: string;
    wallet: string; referrerCode?: string;
  };
  const w = wallet.toLowerCase();

  const existing = db.prepare(
    `SELECT id, x_id, x_handle, wallet FROM community_users WHERE x_id = ? OR wallet = ?`
  ).all(xId, w) as Array<{ id: number; x_id: string; x_handle: string; wallet: string }>;

  if (existing.length > 0) {
    // Exact same pair already bound — no-op success.
    const match = existing.find((r) => r.x_id === xId && r.wallet === w);
    if (match) return res.json({ ok: true, userId: match.id, reused: true });
    // Otherwise one side collides with a different counterparty.
    if (existing.some((r) => r.x_id === xId))  return res.status(409).json({ error: "x_already_bound" });
    if (existing.some((r) => r.wallet === w))  return res.status(409).json({ error: "wallet_already_bound" });
  }

  // Referrer resolution — slug format "@handle" or raw x id. Invalid
  // codes silently fail to a null referrer so a bad share link doesn't
  // break signup.
  let referrerId: number | null = null;
  if (referrerCode) {
    const lookup = referrerCode.startsWith("@")
      ? db.prepare(`SELECT id FROM community_users WHERE x_handle = ? COLLATE NOCASE`).get(referrerCode.slice(1))
      : db.prepare(`SELECT id FROM community_users WHERE x_id = ?`).get(referrerCode);
    if (lookup && (lookup as any).id) referrerId = (lookup as any).id;
  }

  const now = Math.floor(Date.now() / 1000);
  const info = db.prepare(
    `INSERT INTO community_users (x_id, x_handle, x_avatar, x_created, wallet, referrer_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(xId, xHandle, xAvatar ?? null, xCreated ?? null, w, referrerId, now);
  const userId = Number(info.lastInsertRowid);

  if (referrerId) {
    db.prepare(
      `INSERT OR IGNORE INTO community_referrals (referrer_id, referee_id, locked_in_at)
       VALUES (?, ?, ?)`
    ).run(referrerId, userId, now);
  }

  res.json({ ok: true, userId, reused: false });
});

// ------------------------------------------------------------------
// GET /community/me?xId=...&wallet=...
// Read-only. Returns current user state including point total + tier.
// ------------------------------------------------------------------
community.get("/me", (req, res) => {
  const xId    = String(req.query.xId ?? "");
  const wallet = String(req.query.wallet ?? "").toLowerCase();
  if (!xId || !wallet) return res.status(400).json({ error: "missing_params" });

  const user = db.prepare(
    `SELECT id, x_id, x_handle, x_avatar, wallet, tier, created_at, referrer_id
     FROM community_users WHERE x_id = ? AND wallet = ?`
  ).get(xId, wallet) as {
    id: number; x_id: string; x_handle: string; x_avatar: string | null;
    wallet: string; tier: string; created_at: number; referrer_id: number | null;
  } | undefined;
  if (!user) return res.json(null);

  const pts = db.prepare(
    `SELECT COALESCE(SUM(delta), 0) AS total FROM community_points_ledger WHERE user_id = ?`
  ).get(user.id) as { total: number };

  const completions = db.prepare(
    `SELECT task_id, COUNT(*) AS n, MAX(completed_at) AS last_at
     FROM community_completions WHERE user_id = ?
     GROUP BY task_id`
  ).all(user.id) as Array<{ task_id: number; n: number; last_at: number }>;

  const refCount = db.prepare(
    `SELECT COUNT(*) AS n FROM community_referrals WHERE referrer_id = ?`
  ).get(user.id) as { n: number };

  res.json({
    userId: user.id,
    xId: user.x_id,
    xHandle: user.x_handle,
    xAvatar: user.x_avatar,
    wallet: user.wallet,
    tier: user.tier,
    points: pts.total,
    completions: Object.fromEntries(completions.map((c) => [c.task_id, { n: c.n, lastAt: c.last_at }])),
    referrals: refCount.n,
    createdAt: user.created_at,
    volume: {
      tradeUsd: getTradeVolumeUsd(user.wallet),
      mineUsd:  getMineVolumeUsd(user.wallet),
    },
  });
});

// ------------------------------------------------------------------
// GET /community/tasks?xId=...&wallet=...
// Returns the active task catalog joined with the caller's completion
// state. Anonymous callers get the catalog without completion info.
// ------------------------------------------------------------------
community.get("/tasks", (req, res) => {
  const xId    = String(req.query.xId ?? "");
  const wallet = String(req.query.wallet ?? "").toLowerCase();

  const tasks = db.prepare(
    `SELECT id, slug, kind, title, description, points, max_completions, payload, sort_order
     FROM community_task_defs WHERE active = 1 ORDER BY sort_order ASC`
  ).all() as Array<{
    id: number; slug: string; kind: string; title: string; description: string;
    points: number; max_completions: number; payload: string; sort_order: number;
  }>;

  let completions: Record<number, { n: number; lastAt: number }> = {};
  if (xId && wallet) {
    const user = db.prepare(
      `SELECT id FROM community_users WHERE x_id = ? AND wallet = ?`
    ).get(xId, wallet) as { id: number } | undefined;
    if (user) {
      const rows = db.prepare(
        `SELECT task_id, COUNT(*) AS n, MAX(completed_at) AS last_at
         FROM community_completions WHERE user_id = ? GROUP BY task_id`
      ).all(user.id) as Array<{ task_id: number; n: number; last_at: number }>;
      completions = Object.fromEntries(rows.map((r) => [r.task_id, { n: r.n, lastAt: r.last_at }]));
    }
  }

  res.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      slug: t.slug,
      kind: t.kind,
      title: t.title,
      description: t.description,
      points: t.points,
      maxCompletions: t.max_completions,
      payload: safeJson(t.payload),
      completion: completions[t.id] ?? null,
    })),
  });
});

// ------------------------------------------------------------------
// GET /community/leaderboard?range=24h|7d|all&limit=100
// ------------------------------------------------------------------
community.get("/leaderboard", (req, res) => {
  const range = String(req.query.range ?? "all");
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));

  const windowSec: Record<string, number | null> = {
    "24h": 24 * 3600,
    "7d":  7 * 86400,
    "all": null,
  };
  if (!(range in windowSec)) return res.status(400).json({ error: "bad_range" });
  const since = windowSec[range] != null ? Math.floor(Date.now() / 1000) - windowSec[range]! : null;

  const rows = since
    ? db.prepare(
        `SELECT u.id, u.x_handle, u.x_avatar, u.tier, u.wallet,
                COALESCE(SUM(l.delta), 0) AS pts
         FROM community_users u
         LEFT JOIN community_points_ledger l
           ON l.user_id = u.id AND l.created_at >= ?
         GROUP BY u.id
         ORDER BY pts DESC, u.created_at ASC
         LIMIT ?`
      ).all(since, limit)
    : db.prepare(
        `SELECT u.id, u.x_handle, u.x_avatar, u.tier, u.wallet,
                COALESCE(SUM(l.delta), 0) AS pts
         FROM community_users u
         LEFT JOIN community_points_ledger l ON l.user_id = u.id
         GROUP BY u.id
         ORDER BY pts DESC, u.created_at ASC
         LIMIT ?`
      ).all(limit);

  res.json({
    range,
    entries: (rows as Array<{ id: number; x_handle: string; x_avatar: string | null; tier: string; wallet: string; pts: number }>)
      .map((r, i) => ({
        rank: i + 1,
        userId: r.id,
        xHandle: r.x_handle,
        xAvatar: r.x_avatar,
        tier: r.tier,
        wallet: maskWallet(r.wallet),
        points: r.pts,
      })),
  });
});

// ------------------------------------------------------------------
// POST /community/claim
// Body: { xId, wallet, slug, ...verifier-specific fields }
// HMAC over xId|wallet, same as bind-wallet.
//
// Pipeline:
//   1. verify caller HMAC
//   2. resolve user + task
//   3. enforce max_completions
//   4. dispatch verifier (verifiers/*.ts)
//   5. on success: insert completion + ledger atomically; return new total
// ------------------------------------------------------------------
community.post("/claim", async (req, res) => {
  if (!verifyCaller(req, res)) return;
  const { xId, wallet, slug } = req.body as { xId: string; wallet: string; slug: string };
  if (!slug) return res.status(400).json({ error: "missing_slug" });
  if (!isKnownTask(slug)) return res.status(404).json({ error: "unknown_slug" });

  const user = db.prepare(
    `SELECT id, x_id, x_handle, wallet FROM community_users WHERE x_id = ? AND wallet = ?`
  ).get(xId, wallet.toLowerCase()) as
    { id: number; x_id: string; x_handle: string; wallet: string } | undefined;
  if (!user) return res.status(404).json({ error: "user_not_bound" });

  const task = db.prepare(
    `SELECT id, slug, kind, points, max_completions, payload
     FROM community_task_defs WHERE slug = ? AND active = 1`
  ).get(slug) as
    { id: number; slug: string; kind: string; points: number; max_completions: number; payload: string } | undefined;
  if (!task) return res.status(404).json({ error: "task_not_found" });

  // max_completions = -1 means unlimited (e.g. daily-checkin).
  if (task.max_completions !== -1) {
    const existing = db.prepare(
      `SELECT COUNT(*) AS n FROM community_completions WHERE user_id = ? AND task_id = ?`
    ).get(user.id, task.id) as { n: number };
    if (existing.n >= task.max_completions) {
      return res.status(409).json({ error: "max_completions_reached" });
    }
  }

  const result = await runVerifier(slug, user, task, req.body ?? {});
  if (!result.ok) return res.status(400).json({ error: result.reason, meta: result.meta });

  // Atomic award: completion + ledger in one tx so totals never drift.
  const now = Math.floor(Date.now() / 1000);
  const proof = JSON.stringify(result.proof ?? {});
  const tx = db.transaction((payload: { points: number; proof: string }) => {
    const completion = db.prepare(
      `INSERT INTO community_completions (user_id, task_id, completed_at, proof, points_awarded)
       VALUES (?, ?, ?, ?, ?)`
    ).run(user.id, task.id, now, payload.proof, payload.points);
    db.prepare(
      `INSERT INTO community_points_ledger (user_id, delta, reason, ref_id, created_at)
       VALUES (?, ?, 'task', ?, ?)`
    ).run(user.id, payload.points, completion.lastInsertRowid, now);
    return completion.lastInsertRowid;
  });
  tx({ points: result.points, proof });

  // Referral 10%: if this user has a referrer, credit them.
  const ref = db.prepare(
    `SELECT referrer_id FROM community_users WHERE id = ?`
  ).get(user.id) as { referrer_id: number | null };
  if (ref?.referrer_id) {
    const refPts = Math.floor(result.points * 0.10);
    if (refPts > 0) {
      db.prepare(
        `INSERT INTO community_points_ledger (user_id, delta, reason, ref_id, created_at)
         VALUES (?, ?, 'referral', ?, ?)`
      ).run(ref.referrer_id, refPts, user.id, now);
    }
  }

  const total = db.prepare(
    `SELECT COALESCE(SUM(delta), 0) AS total FROM community_points_ledger WHERE user_id = ?`
  ).get(user.id) as { total: number };

  res.json({ ok: true, awarded: result.points, total: total.total, proof: result.proof ?? {} });
});

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
function maskWallet(w: string): string {
  return w.length < 10 ? w : `${w.slice(0, 6)}…${w.slice(-4)}`;
}
