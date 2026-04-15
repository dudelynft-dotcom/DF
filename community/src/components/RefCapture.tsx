"use client";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Client-side referral capture. When a visitor lands with `?ref=@handle`
// (or numeric x id), we drop a 30-day cookie. The bind-wallet route
// reads that cookie and credits the referrer the moment the new user
// completes signup.
//
// Cookie is plain (not HttpOnly) — referrer codes are not secrets and
// the worst-case spoof is "I credited the wrong @handle for inviting
// me," which the user explicitly attempted via the URL anyway.
export function RefCapture() {
  const sp = useSearchParams();
  useEffect(() => {
    const ref = sp.get("ref");
    if (!ref) return;
    // 30 days, lax, root path. SameSite=Lax keeps it on top-level navs.
    const exp = new Date(Date.now() + 30 * 86400_000).toUTCString();
    document.cookie = `df_ref=${encodeURIComponent(ref)}; expires=${exp}; path=/; SameSite=Lax`;
  }, [sp]);
  return null;
}
