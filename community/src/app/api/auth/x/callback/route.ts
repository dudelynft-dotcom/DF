import { NextRequest, NextResponse } from "next/server";
import { accountTooYoung, exchangeCode, fetchMe } from "@/lib/twitter";
import { encodeSession, sessionCookieName, sessionMaxAge } from "@/lib/session";

// X redirects here after the user approves. We must:
//   1. Reject mismatched `state` (CSRF protection)
//   2. Exchange the `code` for an access token (PKCE)
//   3. Fetch the user profile
//   4. Enforce minimum account age
//   5. Set the long-lived session cookie
//   6. Redirect to /connect where the wallet-bind step waits
//
// Any failure path lands back on /connect with an `?err=` query arg the
// page renders as a friendly banner.

function redirectWithErr(req: NextRequest, err: string): NextResponse {
  const url = new URL("/connect", req.url);
  url.searchParams.set("err", err);
  const res = NextResponse.redirect(url);
  // Always clear the one-shot oauth cookies, even on failure.
  res.cookies.delete("x_oauth_verifier");
  res.cookies.delete("x_oauth_state");
  return res;
}

export async function GET(req: NextRequest) {
  const url   = new URL(req.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error")) {
    return redirectWithErr(req, "denied");
  }
  if (!code || !state) return redirectWithErr(req, "missing_code");

  const cookieState    = req.cookies.get("x_oauth_state")?.value;
  const cookieVerifier = req.cookies.get("x_oauth_verifier")?.value;
  if (!cookieState || !cookieVerifier || cookieState !== state) {
    return redirectWithErr(req, "bad_state");
  }

  let token: { access_token: string };
  let me;
  try {
    token = await exchangeCode(code, cookieVerifier);
    me    = await fetchMe(token.access_token);
  } catch (e: unknown) {
    console.error("[x-callback]", e);
    return redirectWithErr(req, "x_api_error");
  }

  if (accountTooYoung(me.created_at)) {
    return redirectWithErr(req, "account_too_young");
  }

  const session = encodeSession({
    xId:     me.id,
    xHandle: me.username,
    xName:   me.name,
    xAvatar: me.profile_image_url,
    exp:     Math.floor(Date.now() / 1000) + sessionMaxAge(),
  });

  const res = NextResponse.redirect(new URL("/connect", req.url));
  res.cookies.set(sessionCookieName(), session, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   sessionMaxAge(),
  });
  res.cookies.delete("x_oauth_verifier");
  res.cookies.delete("x_oauth_state");
  return res;
}
