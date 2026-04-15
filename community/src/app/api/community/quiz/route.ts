import { NextResponse } from "next/server";

// Proxy: fetches the quiz catalog from the backend. Stripped of the
// answer key — the verifier server-side holds those.
export async function GET() {
  const url = (process.env.COMMUNITY_BACKEND_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000")
    .replace(/\/$/, "");
  const res = await fetch(`${url}/community/quiz`, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ questions: [] });
  return NextResponse.json(await res.json());
}
