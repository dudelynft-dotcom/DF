import { NextRequest, NextResponse } from "next/server";

// Proxy leaderboard. Public, no auth.
export async function GET(req: NextRequest) {
  const url = (process.env.COMMUNITY_BACKEND_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000")
    .replace(/\/$/, "");
  const range = new URL(req.url).searchParams.get("range") ?? "all";
  const limit = new URL(req.url).searchParams.get("limit") ?? "100";
  const u = new URL(`${url}/community/leaderboard`);
  u.searchParams.set("range", range);
  u.searchParams.set("limit", limit);
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ entries: [] });
  return NextResponse.json(await res.json());
}
