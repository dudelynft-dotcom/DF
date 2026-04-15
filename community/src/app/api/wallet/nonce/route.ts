import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import crypto from "node:crypto";

// Mint a short-lived bind nonce for the current session. The nonce is
// embedded in the signable message and expires in 5 minutes. Stored in
// an HttpOnly cookie (client never reads it; signer doesn't need to).
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const nonce = crypto.randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();

  const res = NextResponse.json({ nonce, issuedAt, xHandle: s.xHandle, xId: s.xId });
  res.cookies.set("wallet_bind_nonce", nonce, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   60 * 5,
  });
  res.cookies.set("wallet_bind_issued", issuedAt, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   60 * 5,
  });
  return res;
}
