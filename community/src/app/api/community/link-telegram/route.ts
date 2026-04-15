import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSession } from "@/lib/session";

// Proxy: forwards the Telegram Login Widget payload to the backend,
// signed with our HMAC-over-(xId|wallet) caller auth. The backend
// re-verifies the Telegram signature; we never trust the client
// payload directly.

function backendUrl(): string {
  return (process.env.COMMUNITY_BACKEND_URL
    ?? process.env.NEXT_PUBLIC_BACKEND_URL
    ?? "http://localhost:4000").replace(/\/$/, "");
}
function hmac(xId: string, wallet: string): string {
  const secret = process.env.COMMUNITY_SHARED_SECRET ?? "";
  if (secret.length < 32) throw new Error("COMMUNITY_SHARED_SECRET unset");
  return crypto.createHmac("sha256", secret).update(`${xId}|${wallet.toLowerCase()}`).digest("hex");
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || !s.wallet) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null) as { tg?: unknown } | null;
  const tg = body?.tg;
  if (!tg) return NextResponse.json({ error: "missing_tg" }, { status: 400 });

  const res = await fetch(`${backendUrl()}/community/link-telegram`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${hmac(s.xId, s.wallet)}`,
    },
    body: JSON.stringify({ xId: s.xId, wallet: s.wallet, tg }),
  });
  const j = await res.json().catch(() => ({}));
  return NextResponse.json(j, { status: res.status });
}
