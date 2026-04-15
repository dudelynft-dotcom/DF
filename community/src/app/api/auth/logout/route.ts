import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/session";

// Logout = clear the signed session cookie and redirect home.
// Also accepts POST so clients can call it from a form/fetch without
// dealing with CSRF on the redirect.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(sessionCookieName());
  return res;
}

export async function GET() {
  const res = NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"));
  res.cookies.delete(sessionCookieName());
  return res;
}
