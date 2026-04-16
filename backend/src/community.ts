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
import { getMineVolumeUsd, getTradeVolumeUsd, runVerifier, QUIZ_QUESTIONS } from "./communityVerifiers.js";
import { verifyTgLogin, type TgLoginPayload } from "./telegram.js";

// Simple in-memory rate limiter. Sliding window, per (xId OR IP) key.
// Memory grows in proportion to active callers — fine at testnet scale.
// For prod with a multi-process deploy, swap for a shared Redis ZSET.
const RL_WINDOW_MS = 60_000;       // 1 minute
const RL_MAX       = 10;           // max claims per minute per key
const rlLog = new Map<string, number[]>();
function rateLimit(key: string): boolean {
  const now = Date.now();
  const arr = rlLog.get(key) ?? [];
  const kept = arr.filter((t) => t > now - RL_WINDOW_MS);
  if (kept.length >= RL_MAX) return false;
  kept.push(now);
  rlLog.set(key, kept);
  return true;
}

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

  // Referrer resolution — accepts "handle", "@handle", or raw x_id.
  // Silent fallback to null on miss so a bad share link never blocks
  // signup.
  let referrerId: number | null = null;
  if (referrerCode) {
    const raw = referrerCode.replace(/^@/, "");
    const byHandle = db.prepare(
      `SELECT id FROM community_users WHERE x_handle = ? COLLATE NOCASE LIMIT 1`
    ).get(raw) as { id: number } | undefined;
    if (byHandle?.id) {
      referrerId = byHandle.id;
    } else if (/^\d+$/.test(raw)) {
      const byId = db.prepare(
        `SELECT id FROM community_users WHERE x_id = ?`
      ).get(raw) as { id: number } | undefined;
      if (byId?.id) referrerId = byId.id;
    }
    // Self-referral prevention: user's own X id.
    if (referrerId != null) {
      const self = db.prepare(
        `SELECT x_id FROM community_users WHERE id = ?`
      ).get(referrerId) as { x_id: string } | undefined;
      if (self?.x_id === xId) referrerId = null;
    }
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
    `SELECT id, x_id, x_handle, x_avatar, wallet, tier, created_at, referrer_id,
            tg_user_id, tg_username
     FROM community_users WHERE x_id = ? AND wallet = ?`
  ).get(xId, wallet) as {
    id: number; x_id: string; x_handle: string; x_avatar: string | null;
    wallet: string; tier: string; created_at: number; referrer_id: number | null;
    tg_user_id: string | null; tg_username: string | null;
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
    telegram: user.tg_user_id
      ? { id: user.tg_user_id, username: user.tg_username }
      : null,
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
// POST /community/link-telegram
// Body: { xId, wallet, tg: { id, first_name, username, auth_date, hash, ... } }
// HMAC over xId|wallet as usual. The inner `tg` object comes straight
// from the Telegram Login Widget callback — we re-verify its signature
// server-side so a malicious client can't fake a Telegram ID.
// ------------------------------------------------------------------
community.post("/link-telegram", (req, res) => {
  if (!verifyCaller(req, res)) return;
  const { xId, wallet, tg } = req.body as { xId: string; wallet: string; tg: TgLoginPayload };
  if (!tg?.hash) return res.status(400).json({ error: "missing_tg_payload" });

  const verified = verifyTgLogin(tg);
  if (!verified) return res.status(400).json({ error: "bad_tg_signature" });

  const user = db.prepare(
    `SELECT id FROM community_users WHERE x_id = ? AND wallet = ?`
  ).get(xId, wallet.toLowerCase()) as { id: number } | undefined;
  if (!user) return res.status(404).json({ error: "user_not_bound" });

  // One-tg-per-user enforcement: reject if this tg_user_id already
  // belongs to a different community user.
  const dup = db.prepare(
    `SELECT id FROM community_users WHERE tg_user_id = ? AND id != ?`
  ).get(verified.id, user.id) as { id: number } | undefined;
  if (dup) return res.status(409).json({ error: "telegram_already_linked" });

  db.prepare(
    `UPDATE community_users SET tg_user_id = ?, tg_username = ? WHERE id = ?`
  ).run(verified.id, verified.username ?? null, user.id);

  res.json({ ok: true, tgUserId: verified.id, tgUsername: verified.username ?? null });
});

// ------------------------------------------------------------------
// GET /community/quiz
// Returns the question + options for the whitepaper quiz, with the
// `correct` field stripped. The verifier holds the answer key.
// ------------------------------------------------------------------
community.get("/quiz", (_req, res) => {
  res.json({
    questions: QUIZ_QUESTIONS.map((q) => ({ q: q.q, options: q.options })),
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
  // No isKnownTask check here — runVerifier falls back to the
  // trust-based path for admin-created tasks. Genuine unknown
  // slugs bounce later with reason "unknown_task".

  // Rate limit by xId (primary) with a fallback on remote IP for
  // defence-in-depth. 10 claims / minute / key. Prevents script farmers.
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  if (!rateLimit(`x:${xId}`) || !rateLimit(`ip:${ip}`)) {
    return res.status(429).json({ error: "rate_limited" });
  }

  const user = db.prepare(
    `SELECT id, x_id, x_handle, wallet, banned FROM community_users WHERE x_id = ? AND wallet = ?`
  ).get(xId, wallet.toLowerCase()) as
    { id: number; x_id: string; x_handle: string; wallet: string; banned: number } | undefined;
  if (!user) return res.status(404).json({ error: "user_not_bound" });
  if (user.banned) return res.status(403).json({ error: "banned" });

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

  // Tier auto-promotion. Thresholds chosen so most engaged Season 1
  // accounts can reach Gold without the whale tasks; Diamond requires
  // hitting the trade/mine $5k tier or the $25k whale.
  const newTier =
    total.total >= 25_000 ? "diamond" :
    total.total >= 5_000  ? "gold" :
    total.total >= 1_000  ? "silver" :
    "bronze";
  db.prepare(`UPDATE community_users SET tier = ? WHERE id = ? AND tier != ?`)
    .run(newTier, user.id, newTier);

  res.json({ ok: true, awarded: result.points, total: total.total, tier: newTier, proof: result.proof ?? {} });
});

// ------------------------------------------------------------------
//                          ADMIN
// ------------------------------------------------------------------
// Auth: Bearer <ADMIN_TOKEN>. Shared with the rest of /admin/* routes
// in server.ts so there's only one admin credential to rotate.
function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  const expected = process.env.ADMIN_TOKEN ?? "";
  if (!expected) { res.status(503).json({ error: "admin_disabled" }); return false; }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

/// GET /community/admin/users — full user list with points + tier + volume.
community.get("/admin/users", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = db.prepare(
    `SELECT u.id, u.x_id, u.x_handle, u.x_avatar, u.wallet, u.tier, u.created_at, u.referrer_id,
            COALESCE(p.total, 0) AS points
     FROM community_users u
     LEFT JOIN (
       SELECT user_id, SUM(delta) AS total FROM community_points_ledger GROUP BY user_id
     ) p ON p.user_id = u.id
     ORDER BY points DESC, u.created_at ASC`
  ).all() as Array<{
    id: number; x_id: string; x_handle: string; x_avatar: string | null;
    wallet: string; tier: string; created_at: number; referrer_id: number | null; points: number;
  }>;
  res.json({
    users: rows.map((r) => ({
      id: r.id, xId: r.x_id, xHandle: r.x_handle, xAvatar: r.x_avatar,
      wallet: r.wallet, tier: r.tier, createdAt: r.created_at,
      referrerId: r.referrer_id, points: r.points,
      volume: { tradeUsd: getTradeVolumeUsd(r.wallet), mineUsd: getMineVolumeUsd(r.wallet) },
    })),
  });
});

/// POST /community/admin/adjust { userId, delta, reason }
/// Append a manual points adjustment. Ledger is append-only — never
/// update-in-place; reversing a bad award means a new negative-delta row.
community.post("/admin/adjust", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId, delta, reason } = req.body as { userId: number; delta: number; reason: string };
  if (!Number.isInteger(userId) || userId <= 0)       return res.status(400).json({ error: "bad_user_id" });
  if (!Number.isInteger(delta) || delta === 0)        return res.status(400).json({ error: "bad_delta" });
  if (typeof reason !== "string" || reason.length < 1) return res.status(400).json({ error: "missing_reason" });

  const user = db.prepare(`SELECT id FROM community_users WHERE id = ?`).get(userId) as { id: number } | undefined;
  if (!user) return res.status(404).json({ error: "user_not_found" });

  db.prepare(
    `INSERT INTO community_points_ledger (user_id, delta, reason, ref_id, created_at)
     VALUES (?, ?, ?, NULL, ?)`
  ).run(userId, delta, `admin:${reason}`.slice(0, 200), Math.floor(Date.now() / 1000));

  const total = db.prepare(
    `SELECT COALESCE(SUM(delta), 0) AS total FROM community_points_ledger WHERE user_id = ?`
  ).get(userId) as { total: number };
  res.json({ ok: true, total: total.total });
});

/// GET /community/admin/tasks — task catalog with per-task claim counts.
community.get("/admin/tasks", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = db.prepare(
    `SELECT t.id, t.slug, t.kind, t.title, t.points, t.max_completions, t.active, t.sort_order,
            COALESCE(c.n, 0) AS claim_count
     FROM community_task_defs t
     LEFT JOIN (
       SELECT task_id, COUNT(*) AS n FROM community_completions GROUP BY task_id
     ) c ON c.task_id = t.id
     ORDER BY t.sort_order ASC`
  ).all();
  res.json({ tasks: rows });
});

/// POST /community/admin/task-active { taskId, active }
community.post("/admin/task-active", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { taskId, active } = req.body as { taskId: number; active: boolean };
  if (!Number.isInteger(taskId)) return res.status(400).json({ error: "bad_task_id" });
  db.prepare(`UPDATE community_task_defs SET active = ? WHERE id = ?`).run(active ? 1 : 0, taskId);
  res.json({ ok: true });
});

/// POST /community/admin/task-create
/// Body: { slug, kind, title, description, points, maxCompletions, payload?, sortOrder? }
/// Creates a new task def. If payload.trustBased=true the task self-
/// attests on claim — no verifier code change needed. Otherwise the
/// slug must match a registered verifier or claims will fail.
community.post("/admin/task-create", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const {
    slug, kind, title, description, points, maxCompletions,
    payload, sortOrder,
  } = req.body as {
    slug: string; kind: string; title: string; description: string;
    points: number; maxCompletions: number;
    payload?: Record<string, unknown>; sortOrder?: number;
  };

  if (typeof slug  !== "string" || !/^[a-z0-9-]+$/.test(slug))
    return res.status(400).json({ error: "bad_slug", hint: "lowercase letters, digits, hyphens" });
  if (!["social","trade","mine","identity","daily","quiz","other"].includes(kind))
    return res.status(400).json({ error: "bad_kind" });
  if (typeof title !== "string" || !title)       return res.status(400).json({ error: "missing_title" });
  if (typeof description !== "string")            return res.status(400).json({ error: "missing_description" });
  if (!Number.isInteger(points) || points <= 0)   return res.status(400).json({ error: "bad_points" });
  if (!Number.isInteger(maxCompletions))          return res.status(400).json({ error: "bad_max" });

  const dup = db.prepare(`SELECT id FROM community_task_defs WHERE slug = ?`).get(slug);
  if (dup) return res.status(409).json({ error: "slug_exists" });

  const payloadStr = JSON.stringify(payload ?? {});
  const sort = Number.isInteger(sortOrder) ? Number(sortOrder) : 100;
  const info = db.prepare(
    `INSERT INTO community_task_defs
       (slug, kind, title, description, points, max_completions, payload, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(slug, kind, title, description, points, maxCompletions, payloadStr, sort);

  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

/// POST /community/admin/task-update
/// Body: { id, title?, description?, points?, maxCompletions?, payload?, sortOrder? }
/// Partial update. Slug + kind are immutable (would invalidate
/// existing completions' FK meaning).
community.post("/admin/task-update", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const body = req.body as {
    id: number;
    title?: string; description?: string;
    points?: number; maxCompletions?: number;
    payload?: Record<string, unknown>; sortOrder?: number;
  };
  if (!Number.isInteger(body.id)) return res.status(400).json({ error: "bad_id" });

  const task = db.prepare(`SELECT id FROM community_task_defs WHERE id = ?`).get(body.id);
  if (!task) return res.status(404).json({ error: "task_not_found" });

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.title === "string" && body.title)       { sets.push("title = ?");           vals.push(body.title); }
  if (typeof body.description === "string")               { sets.push("description = ?");     vals.push(body.description); }
  if (Number.isInteger(body.points) && (body.points as number) > 0) {
                                                            sets.push("points = ?");          vals.push(body.points); }
  if (Number.isInteger(body.maxCompletions))              { sets.push("max_completions = ?"); vals.push(body.maxCompletions); }
  if (body.payload && typeof body.payload === "object")   { sets.push("payload = ?");         vals.push(JSON.stringify(body.payload)); }
  if (Number.isInteger(body.sortOrder))                   { sets.push("sort_order = ?");      vals.push(body.sortOrder); }
  if (sets.length === 0) return res.status(400).json({ error: "nothing_to_update" });

  vals.push(body.id);
  db.prepare(`UPDATE community_task_defs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

// ============================================================
//                      MODERATION ENDPOINTS
// ============================================================

/// GET /community/admin/user/:id/ledger
/// Full point-history for one user. Newest first.
community.get("/admin/user/:id/ledger", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: "bad_id" });

  const user = db.prepare(
    `SELECT id, x_handle, wallet, banned, banned_at, banned_reason
     FROM community_users WHERE id = ?`
  ).get(userId) as { id: number; x_handle: string; wallet: string; banned: number; banned_at: number | null; banned_reason: string | null } | undefined;
  if (!user) return res.status(404).json({ error: "user_not_found" });

  const entries = db.prepare(
    `SELECT l.id, l.delta, l.reason, l.ref_id, l.created_at,
            t.slug AS task_slug, t.title AS task_title
     FROM community_points_ledger l
     LEFT JOIN community_completions c ON c.id = l.ref_id AND l.reason = 'task'
     LEFT JOIN community_task_defs t    ON t.id = c.task_id
     WHERE l.user_id = ?
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT 500`
  ).all(userId);

  const total = db.prepare(
    `SELECT COALESCE(SUM(delta), 0) AS total FROM community_points_ledger WHERE user_id = ?`
  ).get(userId) as { total: number };

  res.json({ user, total: total.total, entries });
});

/// POST /community/admin/ban   { userId, reason }
/// POST /community/admin/unban { userId }
/// Ban is soft: sets banned=1 and appends a negative ledger entry
/// zero'ing the point total. Wallet and X remain bound so the user
/// can't simply re-register the same pair. Unban reverses both.
community.post("/admin/ban", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId, reason } = req.body as { userId: number; reason: string };
  if (!Number.isInteger(userId))               return res.status(400).json({ error: "bad_id" });
  if (typeof reason !== "string" || !reason)   return res.status(400).json({ error: "missing_reason" });

  const user = db.prepare(
    `SELECT id, banned FROM community_users WHERE id = ?`
  ).get(userId) as { id: number; banned: number } | undefined;
  if (!user) return res.status(404).json({ error: "user_not_found" });
  if (user.banned) return res.status(409).json({ error: "already_banned" });

  const total = db.prepare(
    `SELECT COALESCE(SUM(delta), 0) AS total FROM community_points_ledger WHERE user_id = ?`
  ).get(userId) as { total: number };

  const now = Math.floor(Date.now() / 1000);
  db.transaction(() => {
    if (total.total > 0) {
      db.prepare(
        `INSERT INTO community_points_ledger (user_id, delta, reason, ref_id, created_at)
         VALUES (?, ?, ?, NULL, ?)`
      ).run(userId, -total.total, `admin:ban:${reason}`.slice(0, 200), now);
    }
    db.prepare(
      `UPDATE community_users SET banned = 1, banned_at = ?, banned_reason = ? WHERE id = ?`
    ).run(now, reason, userId);
  })();

  res.json({ ok: true, pointsRemoved: total.total });
});

community.post("/admin/unban", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.body as { userId: number };
  if (!Number.isInteger(userId)) return res.status(400).json({ error: "bad_id" });
  db.prepare(
    `UPDATE community_users SET banned = 0, banned_at = NULL, banned_reason = NULL WHERE id = ?`
  ).run(userId);
  res.json({ ok: true });
});

/// GET /community/admin/tweets?status=verified|rejected|all&limit=200
/// Daily tweet submissions for audit.
community.get("/admin/tweets", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const status = String(req.query.status ?? "all");
  const limit  = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));

  const where = status === "all" ? "1=1" : "t.status = ?";
  const params: unknown[] = status === "all" ? [] : [status];

  const rows = db.prepare(
    `SELECT t.id, t.user_id, t.tweet_id, t.url, t.day, t.status, t.reason, t.checked_at,
            u.x_handle, u.wallet, u.banned
     FROM community_daily_tweets t
     JOIN community_users u ON u.id = t.user_id
     WHERE ${where}
     ORDER BY t.checked_at DESC, t.id DESC
     LIMIT ?`
  ).all(...params, limit);
  res.json({ tweets: rows });
});

/// POST /community/admin/tweet-reject { tweetId, reason }
/// Mark a submitted tweet as rejected AND revoke the points that
/// were awarded for it (look up the paired completion + ledger entry).
community.post("/admin/tweet-reject", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { tweetId, reason } = req.body as { tweetId: number; reason: string };
  if (!Number.isInteger(tweetId))              return res.status(400).json({ error: "bad_id" });
  if (typeof reason !== "string" || !reason)   return res.status(400).json({ error: "missing_reason" });

  const tw = db.prepare(
    `SELECT id, user_id, tweet_id, status FROM community_daily_tweets WHERE id = ?`
  ).get(tweetId) as { id: number; user_id: number; tweet_id: string; status: string } | undefined;
  if (!tw) return res.status(404).json({ error: "tweet_not_found" });
  if (tw.status === "rejected") return res.status(409).json({ error: "already_rejected" });

  const now = Math.floor(Date.now() / 1000);
  // Find the completion row for daily-tweet keyed to this tweet id.
  // Proof is JSON { tweetId: "..." } set by the verifier.
  const completion = db.prepare(
    `SELECT id, points_awarded FROM community_completions
     WHERE user_id = ? AND json_extract(proof, '$.tweetId') = ?
     ORDER BY completed_at DESC LIMIT 1`
  ).get(tw.user_id, tw.tweet_id) as { id: number; points_awarded: number } | undefined;

  db.transaction(() => {
    db.prepare(
      `UPDATE community_daily_tweets SET status = 'rejected', reason = ?, checked_at = ? WHERE id = ?`
    ).run(reason, now, tweetId);
    if (completion) {
      // Reverse the award. Keep completion row for audit trail.
      db.prepare(
        `INSERT INTO community_points_ledger (user_id, delta, reason, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(tw.user_id, -completion.points_awarded, `admin:tweet-reject:${reason}`.slice(0, 200), completion.id, now);
    }
  })();

  res.json({ ok: true, reversed: completion?.points_awarded ?? 0 });
});

/// POST /community/admin/bulk-award
/// Body: { wallets: ["0x...", ...], delta: number, reason: string }
/// Appends +delta to every matching user. Missing wallets are skipped.
community.post("/admin/bulk-award", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { wallets, delta, reason } = req.body as { wallets: string[]; delta: number; reason: string };
  if (!Array.isArray(wallets) || wallets.length === 0)  return res.status(400).json({ error: "bad_wallets" });
  if (wallets.length > 2000)                             return res.status(400).json({ error: "too_many" });
  if (!Number.isInteger(delta) || delta === 0)           return res.status(400).json({ error: "bad_delta" });
  if (typeof reason !== "string" || !reason)             return res.status(400).json({ error: "missing_reason" });

  const now = Math.floor(Date.now() / 1000);
  const find = db.prepare(`SELECT id FROM community_users WHERE wallet = ?`);
  const insert = db.prepare(
    `INSERT INTO community_points_ledger (user_id, delta, reason, ref_id, created_at)
     VALUES (?, ?, ?, NULL, ?)`
  );
  let matched = 0, skipped = 0;
  db.transaction(() => {
    for (const w of wallets) {
      const row = find.get(String(w).toLowerCase()) as { id: number } | undefined;
      if (!row) { skipped++; continue; }
      insert.run(row.id, delta, `admin:bulk:${reason}`.slice(0, 200), now);
      matched++;
    }
  })();
  res.json({ ok: true, matched, skipped });
});

/// GET /community/admin/referrals
/// Aggregates: per referrer, count of referees + total points earned
/// by those referees. Lets the admin spot sybil clusters at a glance.
community.get("/admin/referrals", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = db.prepare(
    `SELECT r.referrer_id,
            u.x_handle AS referrer_handle,
            COUNT(r.referee_id) AS referee_count,
            COALESCE(SUM(rl.total), 0) AS referee_total_points
     FROM community_referrals r
     JOIN community_users u ON u.id = r.referrer_id
     LEFT JOIN (
       SELECT user_id, SUM(delta) AS total
       FROM community_points_ledger GROUP BY user_id
     ) rl ON rl.user_id = r.referee_id
     GROUP BY r.referrer_id
     ORDER BY referee_count DESC, referee_total_points DESC
     LIMIT 500`
  ).all();
  res.json({ referrers: rows });
});

/// GET /community/admin/export.csv
/// Streams the full user + points snapshot as CSV. Columns:
/// id, x_id, x_handle, wallet, tier, points, trade_usd, mine_usd,
/// referrer_id, tg_username, banned, created_at
community.get("/admin/export.csv", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = db.prepare(
    `SELECT u.id, u.x_id, u.x_handle, u.wallet, u.tier, u.referrer_id,
            u.tg_username, u.banned, u.created_at,
            COALESCE(p.total, 0) AS points
     FROM community_users u
     LEFT JOIN (
       SELECT user_id, SUM(delta) AS total FROM community_points_ledger GROUP BY user_id
     ) p ON p.user_id = u.id
     ORDER BY points DESC, u.created_at ASC`
  ).all() as Array<{
    id: number; x_id: string; x_handle: string; wallet: string; tier: string;
    referrer_id: number | null; tg_username: string | null; banned: number;
    created_at: number; points: number;
  }>;

  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "id,x_id,x_handle,wallet,tier,points,trade_usd,mine_usd,referrer_id,tg_username,banned,created_at";
  const lines = users.map((u) => [
    u.id, u.x_id, u.x_handle, u.wallet, u.tier, u.points,
    getTradeVolumeUsd(u.wallet), getMineVolumeUsd(u.wallet),
    u.referrer_id ?? "", u.tg_username ?? "", u.banned, u.created_at,
  ].map(esc).join(","));
  const csv = [header, ...lines].join("\n") + "\n";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=community-snapshot-${new Date().toISOString().slice(0,10)}.csv`);
  res.send(csv);
});

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
function maskWallet(w: string): string {
  return w.length < 10 ? w : `${w.slice(0, 6)}…${w.slice(-4)}`;
}
