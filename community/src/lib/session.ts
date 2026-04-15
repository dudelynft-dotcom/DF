// Signed-cookie session. No external auth library.
//
// Format: base64url(JSON payload) + "." + base64url(hmac)
// HMAC-SHA256 over the payload using AUTH_SECRET. If the secret ever
// changes, every existing session silently invalidates — which is the
// right outcome.
//
// Session payload:
//   xId      - X user id (string, numeric)
//   xHandle  - @-less screen name
//   xName    - display name
//   xAvatar  - profile image URL
//   wallet   - 0x-address once bound (empty until bind)
//   exp      - unix seconds, 30 days from issue

import { cookies } from "next/headers";
import crypto from "node:crypto";

export type Session = {
  xId: string;
  xHandle: string;
  xName?: string;
  xAvatar?: string;
  wallet?: `0x${string}`;
  exp: number;
};

const COOKIE_NAME = "df_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET must be set and at least 32 chars");
  }
  return Buffer.from(s, "utf8");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  const padLen = (4 - (s.length % 4)) % 4;
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen), "base64");
}

function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(payload).digest());
}

export function encodeSession(sess: Session): string {
  const body = b64url(Buffer.from(JSON.stringify(sess)));
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare to avoid timing oracle on the signature.
  if (expected.length !== sig.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return null;
  }
  try {
    const json = JSON.parse(fromB64url(body).toString("utf8")) as Session;
    if (!json.xId || !json.exp || json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  return decodeSession(cookies().get(COOKIE_NAME)?.value);
}

export function sessionCookieName(): string { return COOKIE_NAME; }
export function sessionMaxAge(): number     { return MAX_AGE; }
