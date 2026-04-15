import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { claimTask } from "@/lib/backend";

// Claim a task. The browser POSTs { slug } here and we attach the
// session's xId+wallet server-side, then forward HMAC-signed to the
// backend. Keeps the shared secret out of any browser-served bundle.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || !s.wallet) return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { slug?: string; extra?: Record<string, unknown> };
  if (!body?.slug) return NextResponse.json({ ok: false, reason: "missing_slug" }, { status: 400 });

  const result = await claimTask({
    xId:    s.xId,
    wallet: s.wallet,
    slug:   body.slug,
    extra:  body.extra,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
