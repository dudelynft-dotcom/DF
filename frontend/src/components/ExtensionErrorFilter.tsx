"use client";

/// Browser extensions (wallets, ad-blockers, Pocket Universe, etc.) inject
/// scripts into the page context. When they throw, Next.js's dev error
/// overlay surfaces them as "Unhandled Runtime Error" even though they're
/// not our code. Swallow at the window level using capture-phase listeners
/// installed at module-load (before Next.js's overlay attaches).

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

if (typeof window !== "undefined" && !(window as unknown as { __extFilterInstalled?: boolean }).__extFilterInstalled) {
  (window as unknown as { __extFilterInstalled?: boolean }).__extFilterInstalled = true;

  window.addEventListener(
    "error",
    (e: ErrorEvent) => {
      const err = e.error as { stack?: string; message?: string } | undefined;
      if (looksLikeExtensionNoise([e.filename, e.message, err?.stack, err?.message])) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );

  window.addEventListener(
    "unhandledrejection",
    (e: PromiseRejectionEvent) => {
      const reason = e.reason as { stack?: string; message?: string } | string | undefined;
      const msg = typeof reason === "string" ? reason : reason?.message;
      const stack = typeof reason === "string" ? undefined : reason?.stack;
      if (looksLikeExtensionNoise([msg, stack])) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );

  // Patch console.error too — Next's overlay also reads from there.
  const origConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const flat = args.map((a) => (typeof a === "string" ? a : (a as { stack?: string; message?: string })?.stack ?? (a as { message?: string })?.message ?? ""));
    if (looksLikeExtensionNoise(flat)) return;
    origConsoleError(...args);
  };
}

export function ExtensionErrorFilter() {
  return null;
}
