"use client";
import { useConnect, type Connector } from "wagmi";
import { useEffect, useRef } from "react";

export function WalletModal({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const { connectors, connect, isPending, error, variables } = useConnect();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // defer click binding so the opening click doesn't immediately close
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Dedup: EIP-6963 discovered entries sometimes collide with the base "injected" one
  const seen = new Set<string>();
  const wallets = connectors.filter((c) => {
    const key = (c.icon ? c.name : c.id).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <>
      {/* Mobile-only backdrop */}
      <div
        aria-hidden
        className="sm:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm animate-[wmFade_0.12s_ease-out]"
      />

      {/* Panel:
          - mobile: fixed, centered
          - desktop: absolute under the trigger (parent is relative) */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Connect wallet"
        className="
          z-50 w-[360px] max-w-[calc(100vw-24px)]
          rounded-2xl border border-line bg-bg-surface shadow-2xl overflow-hidden
          animate-[wmPop_0.16s_cubic-bezier(0.2,0.8,0.2,1)]
          fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          sm:absolute sm:right-0 sm:top-full sm:mt-2
          sm:left-auto sm:translate-x-0 sm:translate-y-0
        "
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
            <span className="text-[11px] uppercase tracking-[0.28em] text-gold-400/90">
              Connect wallet
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7 rounded-md text-ink-faint hover:text-ink hover:bg-white/5 transition-colors flex items-center justify-center"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="p-2 max-h-[62vh] overflow-y-auto scrollbar-thin">
          {wallets.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="flex flex-col">
              {wallets.map((c) => {
                const loading = isPending && variables?.connector === c;
                return (
                  <li key={c.uid}>
                    <button
                      onClick={() => connect({ connector: c })}
                      disabled={isPending}
                      className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-raised transition-colors disabled:opacity-60"
                    >
                      <WalletIcon connector={c} />
                      <div className="flex-1 text-left">
                        <div className="text-[14px] font-medium text-ink leading-tight">
                          {displayName(c)}
                        </div>
                        <div className="text-[11px] text-ink-faint mt-0.5">{subLabel(c)}</div>
                      </div>
                      {loading ? <Spinner /> : (
                        <span className="text-ink-faint text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                          →
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {error && (
            <p className="mx-2 mt-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed">
              {error.message}
            </p>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes wmFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes wmPop  { from { opacity: 0; transform: translateY(-4px) scale(0.98) } to { opacity: 1; transform: none } }
        @media (min-width: 640px) {
          @keyframes wmPop { from { opacity: 0; transform: translateY(-4px) scale(0.98) } to { opacity: 1; transform: none } }
        }
        .scrollbar-thin::-webkit-scrollbar { width: 6px; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(201,163,74,0.25); border-radius: 3px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </>
  );
}

function WalletIcon({ connector }: { connector: Connector }) {
  if (connector.icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={connector.icon} alt="" className="h-9 w-9 rounded-lg bg-white/5 object-cover" />;
  }
  return (
    <div className="h-9 w-9 rounded-lg bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-300 font-display text-base">
      {connector.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin text-gold-300" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function displayName(c: Connector): string {
  if (c.name && c.name !== "Injected") return c.name;
  return "Browser wallet";
}
function subLabel(c: Connector): string {
  if (c.type === "injected") return "Browser extension";
  if (c.type === "walletConnect") return "Scan with a mobile wallet";
  return c.type;
}

function EmptyState() {
  return (
    <div className="py-8 px-4 text-center">
      <div className="mx-auto h-12 w-12 rounded-xl bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-300">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="currentColor" strokeWidth="1.5"/>
          <circle cx="16" cy="12" r="1.25" fill="currentColor"/>
        </svg>
      </div>
      <p className="mt-3 text-sm font-medium text-ink">No wallet detected</p>
      <p className="mt-1 text-xs text-ink-muted max-w-[240px] mx-auto">
        Install an EVM browser wallet, then reload this page.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <a href="https://metamask.io/download" target="_blank" rel="noreferrer"
           className="px-3 py-1.5 text-xs rounded-md bg-gold-400 text-bg-base font-medium hover:bg-gold-300 transition-colors">
          MetaMask
        </a>
        <a href="https://rabby.io/" target="_blank" rel="noreferrer"
           className="px-3 py-1.5 text-xs rounded-md border border-line text-ink hover:border-gold-400/60 transition-colors">
          Rabby
        </a>
      </div>
    </div>
  );
}
