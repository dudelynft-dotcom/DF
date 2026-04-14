"use client";
import { useEffect } from "react";
import { SwapForm, type SwapToken } from "./SwapForm";
import { CURATED_TOKENS } from "@/config/tokens";

export type TradeToken = SwapToken;

/// Legacy modal wrapper kept for the Grid / List views. Pro view embeds the
/// SwapForm inline instead. All real logic lives in SwapForm.
export function TradeModal({
  open, onClose, token,
}: {
  open: boolean;
  onClose: () => void;
  token: TradeToken | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || !token) return null;
  const quote = CURATED_TOKENS.find((t) => t.kind === "native-stable") ?? CURATED_TOKENS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-[tmFade_0.14s_ease-out]"
      onClick={onClose}
    >
      <div
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-line bg-bg-surface shadow-2xl overflow-hidden animate-[tmPop_0.18s_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-line">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-gold-400/90">Trade</p>
            <h2 className="mt-1 font-display text-2xl tracking-tight">
              {token.symbol} <span className="text-ink-faint text-base">/ {quote.symbol}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-md text-ink-faint hover:text-ink hover:bg-white/5 transition-colors flex items-center justify-center"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <SwapForm token={token} enabled={open} className="p-6" />
      </div>

      <style jsx global>{`
        @keyframes tmFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes tmPop  { from { opacity: 0; transform: translateY(8px) scale(0.98) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  );
}
