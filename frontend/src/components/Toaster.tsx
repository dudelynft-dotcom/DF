"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { tempo } from "@/config/chain";

export type Toast = {
  id: string;
  kind: "pending" | "success" | "error" | "info";
  title: string;
  body?: string;
  hash?: `0x${string}`;
  ttl?: number; // ms, 0 = sticky
};

type Ctx = {
  push: (t: Omit<Toast, "id">) => string;
  update: (id: string, patch: Partial<Toast>) => void;
  dismiss: (id: string) => void;
};
const ToastCtx = createContext<Ctx | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast outside Toaster");
  return ctx;
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push: Ctx["push"] = useCallback((t) => {
    const id = crypto.randomUUID();
    setToasts((cur) => [...cur, { id, ttl: t.kind === "error" ? 8000 : 5000, ...t }]);
    return id;
  }, []);

  const update: Ctx["update"] = useCallback((id, patch) => {
    setToasts((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  const dismiss: Ctx["dismiss"] = useCallback((id) => {
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  // auto-dismiss on ttl
  useEffect(() => {
    const timers = toasts
      .filter((t) => t.ttl && t.ttl > 0 && t.kind !== "pending")
      .map((t) => setTimeout(() => dismiss(t.id), t.ttl));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  return (
    <ToastCtx.Provider value={{ push, update, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[92vw] max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({ t, onClose }: { t: Toast; onClose: () => void }) {
  const accent =
    t.kind === "error"   ? "border-red-500/40"
    : t.kind === "success" ? "border-emerald-500/40"
    : t.kind === "pending" ? "border-gold-400/40"
    :                         "border-line";

  const dot =
    t.kind === "error"   ? "bg-red-400"
    : t.kind === "success" ? "bg-emerald-400"
    : t.kind === "pending" ? "bg-gold-400 animate-pulse"
    :                         "bg-ink-muted";

  return (
    <div className={`pointer-events-auto rounded-xl border ${accent} bg-bg-surface shadow-2xl px-4 py-3 animate-[toastIn_0.18s_ease-out]`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${dot}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink font-medium truncate">{t.title}</div>
          {t.body && (
            <div className="mt-0.5 text-xs text-ink-muted break-words">{t.body}</div>
          )}
          {t.hash && (
            <a
              href={`${tempo.blockExplorers!.default.url}/tx/${t.hash}`}
              target="_blank" rel="noreferrer"
              className="mt-1 inline-block text-xs text-gold-300 hover:text-gold-200 tabular"
            >
              View tx ↗
            </a>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="text-ink-faint hover:text-ink transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <style jsx>{`
        @keyframes toastIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  );
}
