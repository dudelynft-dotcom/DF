import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchMe } from "@/lib/backend";

// Returns the canonical (DB-backed) user record. Differs from
// /api/auth/me which only reads the session cookie. Used by /tasks
// and /profile when they need live point totals.
export async function GET() {
  const s = await getSession();
  if (!s || !s.wallet) return NextResponse.json(null);
  const me = await fetchMe(s.xId, s.wallet);
  return NextResponse.json(me);
}
