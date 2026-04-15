// X (Twitter) OAuth 2.0 with PKCE, confidential-client flow.
//
// We use confidential client (Basic auth on /2/oauth2/token) because our
// callback runs server-side and the client secret never touches the
// browser. PKCE is still required by X.
//
// Scopes: tweet.read + users.read is enough to resolve the signed-in
// user and later verify their own tweets by lookup.

import crypto from "node:crypto";

export const X_AUTHZ_URL = "https://twitter.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
export const X_ME_URL    = "https://api.twitter.com/2/users/me?user.fields=created_at,profile_image_url,name,username";

export const OAUTH_SCOPES = ["tweet.read", "users.read"];

export type XUser = {
  id: string;
  username: string;
  name?: string;
  profile_image_url?: string;
  created_at?: string;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makePkce(): { verifier: string; challenge: string; state: string } {
  const verifier  = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state     = b64url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

export function callbackUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) throw new Error("NEXT_PUBLIC_SITE_URL not set");
  return `${site.replace(/\/$/, "")}/api/auth/x/callback`;
}

export function buildAuthzUrl(challenge: string, state: string): string {
  const id = process.env.AUTH_TWITTER_ID;
  if (!id) throw new Error("AUTH_TWITTER_ID not set");
  const u = new URL(X_AUTHZ_URL);
  u.searchParams.set("response_type",        "code");
  u.searchParams.set("client_id",            id);
  u.searchParams.set("redirect_uri",         callbackUrl());
  u.searchParams.set("scope",                OAUTH_SCOPES.join(" "));
  u.searchParams.set("state",                state);
  u.searchParams.set("code_challenge",       challenge);
  u.searchParams.set("code_challenge_method","S256");
  return u.toString();
}

export async function exchangeCode(code: string, verifier: string): Promise<{ access_token: string }> {
  const id = process.env.AUTH_TWITTER_ID;
  const sec = process.env.AUTH_TWITTER_SECRET;
  if (!id || !sec) throw new Error("X OAuth creds not set");

  const body = new URLSearchParams({
    code,
    grant_type:    "authorization_code",
    client_id:     id,
    redirect_uri:  callbackUrl(),
    code_verifier: verifier,
  });

  const basic = Buffer.from(`${id}:${sec}`).toString("base64");

  const res = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`X token exchange failed: ${res.status} ${t.slice(0, 300)}`);
  }
  return res.json() as Promise<{ access_token: string }>;
}

export async function fetchMe(accessToken: string): Promise<XUser> {
  const res = await fetch(X_ME_URL, {
    headers: { "Authorization": `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`X /users/me failed: ${res.status} ${t.slice(0, 300)}`);
  }
  const j = await res.json() as { data: XUser };
  return j.data;
}

// Minimum X account age to qualify. Matches landing-page copy.
const MIN_AGE_DAYS = 30;
export function accountTooYoung(createdAt?: string): boolean {
  if (!createdAt) return false; // tolerate absence; X sometimes omits
  const ts = Date.parse(createdAt);
  if (isNaN(ts)) return false;
  const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return ageDays < MIN_AGE_DAYS;
}
