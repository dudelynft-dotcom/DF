import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { getSession } from "@/lib/session";
import { bindMessage } from "@/lib/bindMessage";
import { bindingByWallet, bindingByX, saveBinding } from "@/lib/bindings";
import { encodeSession, sessionCookieName, sessionMaxAge } from "@/lib/session";

// Accept a signed bind message and persist the wallet ↔ X mapping.
// Request:
//   { wallet: "0x...", signature: "0x..." }
// The server reconstructs the expected message from session + nonce
// cookie and verifies the signature with viem's EIP-191 verifier.

type Body = { wallet?: string; signature?: string };

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null) as Body | null;
  const wallet = (body?.wallet ?? "").toLowerCase();
  const sig    = body?.signature ?? "";
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return NextResponse.json({ error: "bad_wallet" },    { status: 400 });
  if (!/^0x[a-f0-9]+$/.test(sig))        return NextResponse.json({ error: "bad_signature" }, { status: 400 });

  const nonce    = req.cookies.get("wallet_bind_nonce")?.value;
  const issuedAt = req.cookies.get("wallet_bind_issued")?.value;
  if (!nonce || !issuedAt) return NextResponse.json({ error: "nonce_expired" }, { status: 400 });

  const message = bindMessage({ xHandle: s.xHandle, xId: s.xId, nonce, issuedAt });

  // viem returns true/false. Defensive try/catch to also cover malformed
  // signature strings that throw before returning a boolean.
  let ok = false;
  try {
    ok = await verifyMessage({
      address:   wallet as `0x${string}`,
      message,
      signature: sig as `0x${string}`,
    });
  } catch {
    ok = false;
  }
  if (!ok) return NextResponse.json({ error: "bad_signature" }, { status: 400 });

  // Uniqueness: one X per wallet and one wallet per X.
  if (await bindingByX(s.xId))
    return NextResponse.json({ error: "x_already_bound" }, { status: 409 });
  if (await bindingByWallet(wallet as `0x${string}`))
    return NextResponse.json({ error: "wallet_already_bound" }, { status: 409 });

  await saveBinding({
    xId:     s.xId,
    xHandle: s.xHandle,
    wallet:  wallet as `0x${string}`,
    at:      Math.floor(Date.now() / 1000),
  });

  // Re-issue the session cookie with the wallet bound so the UI can
  // reflect it immediately without another round-trip.
  const newSession = encodeSession({ ...s, wallet: wallet as `0x${string}` });
  const res = NextResponse.json({ ok: true, wallet });
  res.cookies.set(sessionCookieName(), newSession, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   sessionMaxAge(),
  });
  res.cookies.delete("wallet_bind_nonce");
  res.cookies.delete("wallet_bind_issued");
  return res;
}
