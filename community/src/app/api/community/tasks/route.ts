import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchTasks } from "@/lib/backend";

// Task catalog joined with the caller's completion state. Anonymous
// callers still get the catalog (lets the dashboard render before
// /api/auth/me resolves).
export async function GET() {
  const s = await getSession();
  const tasks = await fetchTasks(s?.xId, s?.wallet);
  return NextResponse.json({ tasks });
}
