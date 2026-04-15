// Thin client for the community endpoints on the shared backend. Every
// mutation computes an HMAC over (xId|wallet) using COMMUNITY_SHARED_SECRET
// so the backend can prove this call originates from our server.
//
// This lib runs exclusively server-side — never import it from a
// Client Component. Client code must go through our own /api/* routes
// which in turn call this.

import crypto from "node:crypto";

function backendUrl(): string {
  const u = process.env.COMMUNITY_BACKEND_URL
    ?? process.env.NEXT_PUBLIC_BACKEND_URL
    ?? "http://localhost:4000";
  return u.replace(/\/$/, "");
}

function sharedSecret(): Buffer {
  const s = process.env.COMMUNITY_SHARED_SECRET;
  if (!s || s.length < 32) {
    throw new Error("COMMUNITY_SHARED_SECRET must be set (32+ chars) and match the backend");
  }
  return Buffer.from(s, "utf8");
}

function hmac(xId: string, wallet: string): string {
  return crypto
    .createHmac("sha256", sharedSecret())
    .update(`${xId}|${wallet.toLowerCase()}`)
    .digest("hex");
}

export type CommunityUser = {
  userId: number;
  xId: string;
  xHandle: string;
  xAvatar: string | null;
  wallet: `0x${string}`;
  tier: "bronze" | "silver" | "gold" | "diamond";
  points: number;
  completions: Record<number, { n: number; lastAt: number }>;
  referrals: number;
  createdAt: number;
};

export async function bindWallet(input: {
  xId: string; xHandle: string; xAvatar?: string; xCreated?: string;
  wallet: `0x${string}`; referrerCode?: string;
}): Promise<{ ok: true; userId: number; reused: boolean }> {
  const res = await fetch(`${backendUrl()}/community/bind-wallet`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${hmac(input.xId, input.wallet)}`,
    },
    body: JSON.stringify(input),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `backend_${res.status}`);
  return j as { ok: true; userId: number; reused: boolean };
}

export async function fetchMe(xId: string, wallet: `0x${string}`): Promise<CommunityUser | null> {
  const u = new URL(`${backendUrl()}/community/me`);
  u.searchParams.set("xId", xId);
  u.searchParams.set("wallet", wallet);
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) return null;
  const j = await res.json();
  return j;
}

export type TaskDef = {
  id: number;
  slug: string;
  kind: "social" | "trade" | "mine" | "identity" | "daily" | "quiz";
  title: string;
  description: string;
  points: number;
  maxCompletions: number;
  payload: Record<string, unknown>;
  completion: { n: number; lastAt: number } | null;
};

export async function fetchTasks(xId?: string, wallet?: string): Promise<TaskDef[]> {
  const u = new URL(`${backendUrl()}/community/tasks`);
  if (xId && wallet) {
    u.searchParams.set("xId", xId);
    u.searchParams.set("wallet", wallet);
  }
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) return [];
  const j = await res.json();
  return (j.tasks ?? []) as TaskDef[];
}

export type LeaderboardEntry = {
  rank: number;
  userId: number;
  xHandle: string;
  xAvatar: string | null;
  tier: string;
  wallet: string;
  points: number;
};

export type ClaimResult =
  | { ok: true;  awarded: number; total: number; proof: Record<string, unknown> }
  | { ok: false; reason: string;  meta?: Record<string, unknown> };

export async function claimTask(input: {
  xId: string; wallet: `0x${string}`; slug: string;
  extra?: Record<string, unknown>;
}): Promise<ClaimResult> {
  const body = { xId: input.xId, wallet: input.wallet, slug: input.slug, ...(input.extra ?? {}) };
  const res = await fetch(`${backendUrl()}/community/claim`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${hmac(input.xId, input.wallet)}`,
    },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: j?.error ?? `backend_${res.status}`, meta: j?.meta };
  return j as ClaimResult;
}

export async function fetchLeaderboard(range: "24h" | "7d" | "all" = "all", limit = 100): Promise<LeaderboardEntry[]> {
  const u = new URL(`${backendUrl()}/community/leaderboard`);
  u.searchParams.set("range", range);
  u.searchParams.set("limit", String(limit));
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) return [];
  const j = await res.json();
  return (j.entries ?? []) as LeaderboardEntry[];
}
