import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = process.env.ADMIN_TOKEN;
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!token || !backend) {
    return NextResponse.json({ error: "admin not configured" }, { status: 500 });
  }
  const body = await req.json();
  const r = await fetch(`${backend}/admin/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
}
