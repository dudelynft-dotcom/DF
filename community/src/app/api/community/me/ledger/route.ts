import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

// Proxy user-scoped ledger. Reads the session server-side so the
// browser never crafts the xId/wallet query — identity stays honest.
export async function GET() {
  const s = await getSession();
  if (!s || !s.wallet) return NextResponse.json({ entries: [] });

  const base = (process.env.COMMUNITY_BACKEND_URL
    ?? process.env.NEXT_PUBLIC_BACKEND_URL
    ?? "http://localhost:4000").replace(/\/$/, "");
  const u = new URL(`${base}/community/me/ledger`);
  u.searchParams.set("xId",    s.xId);
  u.searchParams.set("wallet", s.wallet);
  u.searchParams.set("limit",  "50");
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ entries: [] });
  return NextResponse.json(await res.json());
}
