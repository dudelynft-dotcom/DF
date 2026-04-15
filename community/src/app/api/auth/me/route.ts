import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

// Return the current session, if any. UI components poll this on mount
// to decide whether to show the connect flow or the bound state.
//
// Note: we return null for unauth'd instead of 401 so the fetch doesn't
// pollute dev tools with red errors during normal navigation.
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json(null);
  return NextResponse.json({
    xId:     s.xId,
    xHandle: s.xHandle,
    xName:   s.xName,
    xAvatar: s.xAvatar,
    wallet:  s.wallet ?? null,
  });
}
