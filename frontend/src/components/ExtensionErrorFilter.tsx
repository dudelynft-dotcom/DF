"use client";
import { useEffect } from "react";

/// Browser extensions (wallets, ad-blockers, etc.) inject scripts into the
/// page context. When they throw, Next.js's dev error overlay surfaces them
/// as "Unhandled Runtime Error" even though they're not our code. Swallow.
///
/// Uses capture phase + installs synchronously on module import so it runs
/// before Next.js's listener.
export function ExtensionErrorFilter() {
  useEffect(() => {
    function looksLikeExtensionNoise(parts: (string | null | undefined)[]): boolean {
      const haystack = parts.filter(Boolean).join(" ");
      return (
        haystack.includes("chrome-extension://") ||
        haystack.includes("moz-extension://") ||
        haystack.includes("safari-extension://") ||
        haystack.includes("webkit-masked-url://") ||
        /has not been authorized/i.test(haystack)
      );
    }

    function onError(e: ErrorEvent) {
      const err = e.error as { stack?: string; message?: string } | undefined;
      if (looksLikeExtensionNoise([e.filename, e.message, err?.stack, err?.message])) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }

    function onRejection(e: PromiseRejectionEvent) {
      const reason = e.reason as { stack?: string; message?: string } | string | undefined;
      const msg = typeof reason === "string" ? reason : reason?.message;
      const stack = typeof reason === "string" ? undefined : reason?.stack;
      if (looksLikeExtensionNoise([msg, stack])) {
        e.preventDefault();
      }
    }

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection, true);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection, true);
    };
  }, []);

  return null;
}
