"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { bindMessage } from "@/lib/bindMessage";

// Wallet bind flow — three possible states:
//   1. No wallet connected → show list of connectors
//   2. Wallet connected, not bound → show "Sign to bind"
//   3. Bound → show bound address + checkmark
//
// The component is entirely client-side. All server interaction goes
// through /api/wallet/nonce and /api/wallet/bind.
export function BindWallet({
  xHandle, xId, initialBoundWallet, onBound,
}: {
  xHandle: string;
  xId:     string;
  initialBoundWallet: `0x${string}` | null;
  onBound:  (wallet: `0x${string}`) => void;
}) {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync, isPending: signing } = useSignMessage();

  const [bound, setBound] = useState<`0x${string}` | null>(initialBoundWallet);
  const [err, setErr]     = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If the user switches wallet after binding, we don't auto-rebind —
  // display the bound one but surface that the connected wallet differs.
  const mismatch = bound && address && bound.toLowerCase() !== address.toLowerCase();

  const onBind = async () => {
    if (!isConnected || !address) return;
    setErr(null);
    setSubmitting(true);
    try {
      const nonceRes = await fetch("/api/wallet/nonce", { method: "GET" });
      if (!nonceRes.ok) throw new Error("nonce");
      const { nonce, issuedAt } = await nonceRes.json() as { nonce: string; issuedAt: string };

      const message = bindMessage({ xHandle, xId, nonce, issuedAt });
      const signature = await signMessageAsync({ message });

      const bindRes = await fetch("/api/wallet/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, signature }),
      });
      const bindJson = await bindRes.json();
      if (!bindRes.ok) {
        throw new Error(bindJson?.error || "bind_failed");
      }
      setBound(address as `0x${string}`);
      onBound(address as `0x${string}`);
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? "unknown";
      setErr(friendly(msg));
    } finally {
      setSubmitting(false);
    }
  };

  // Already bound — terminal state for this session's wallet step.
  if (bound && !mismatch) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-3 text-sm">
        <div className="flex items-center gap-2">
          <Check />
          <span className="text-ink">Wallet bound</span>
        </div>
        <div className="text-xs text-ink-faint mt-1 font-mono">
          {short(bound)}
        </div>
      </div>
    );
  }

  // Wallet connected → sign & bind step.
  if (isConnected && address) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-line px-3 py-2.5 text-xs flex items-center justify-between">
          <span className="text-ink-muted">Connected</span>
          <span className="font-mono text-ink">{short(address)}</span>
          <button onClick={() => disconnect()} className="text-ink-faint hover:text-ink text-xs">
            Switch
          </button>
        </div>
        {mismatch && bound && (
          <div className="text-xs text-amber-300/90">
            This wallet differs from your bound address ({short(bound)}).
            Switch wallets or stay bound to the original.
          </div>
        )}
        <button
          onClick={onBind}
          disabled={submitting || signing}
          className="
            w-full px-4 py-2.5 rounded-md text-sm font-medium transition-colors
            bg-gold-400 text-bg-base hover:bg-gold-300
            disabled:opacity-60 disabled:cursor-not-allowed
          "
        >
          {submitting || signing ? "Waiting for signature…" : "Sign to bind wallet"}
        </button>
        {err && <p className="text-xs text-red-300">{err}</p>}
      </div>
    );
  }

  // No wallet connected → show connector list.
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-faint">Pick a wallet to connect.</p>
      <ul className="space-y-2">
        {connectors.map((c) => (
          <li key={c.uid}>
            <button
              onClick={() => connect({ connector: c })}
              disabled={connecting}
              className="
                w-full flex items-center gap-3 px-3 py-2.5 rounded-md
                border border-line text-sm text-ink
                hover:border-gold-400/60 hover:bg-white/5 transition-colors
                disabled:opacity-60
              "
            >
              {c.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.icon} alt="" className="h-5 w-5 rounded" />
              ) : (
                <div className="h-5 w-5 rounded bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-300 text-[10px]">
                  {c.name.slice(0,1).toUpperCase()}
                </div>
              )}
              <span className="flex-1 text-left">{c.name === "Injected" ? "Browser wallet" : c.name}</span>
              <span className="text-ink-faint">→</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function friendly(msg: string): string {
  if (msg.includes("x_already_bound")) return "This X account is already bound to a wallet.";
  if (msg.includes("wallet_already_bound")) return "This wallet is already bound to another X account.";
  if (msg.includes("nonce")) return "Session timed out. Try again.";
  if (msg.toLowerCase().includes("user rejected")) return "You rejected the signature.";
  return "Something went wrong. Try again.";
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-emerald-400">
      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
