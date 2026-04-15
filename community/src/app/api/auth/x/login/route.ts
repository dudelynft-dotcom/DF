import { NextResponse } from "next/server";
import { buildAuthzUrl, makePkce } from "@/lib/twitter";

// Force dynamic rendering — Vercel otherwise static-optimises this
// route and serves a cached PKCE verifier to every caller, making
// the callback's state check fail with `bad_state`.
export const dynamic = "force-dynamic";

// Start the X OAuth 2.0 flow.
//   1. Mint PKCE verifier + challenge + state
//   2. Stash verifier+state in short-lived cookies
//   3. 302 the browser to X
//
// State is verified on return; verifier is shipped back to X as the
// PKCE proof of possession.
export async function GET() {
  const { verifier, challenge, state } = makePkce();

  const res = NextResponse.redirect(buildAuthzUrl(challenge, state));
  // Short-lived. They only need to survive the round trip to X.
  const cookieOpts = {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path:     "/",
    maxAge:   60 * 10, // 10 min
  };
  res.cookies.set("x_oauth_verifier", verifier, cookieOpts);
  res.cookies.set("x_oauth_state",    state,    cookieOpts);
  return res;
}
