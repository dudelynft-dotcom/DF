"use client";
import { useState } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { bindMessage } from "@/lib/bindMessage";

// Wallet bind flow — three states:
//   1. No wallet connected → RainbowKit ConnectButton (polished modal)
//   2. Wallet connected, not bound → "Sign to bind"
//   3. Bound → bound address + checkmark
//
// All server interaction goes through /api/wallet/nonce + /api/wallet/bind.
export function BindWallet({
  xHandle, xId, initialBoundWallet, onBound,
}: {
  xHandle: string;
  xId:     string;
  initialBoundWallet: `0x${string}` | null;
  onBound:  (wallet: `0x${string}`) => void;
}) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync, isPending: signing } = useSignMessage();

  const [bound, setBound] = useState<`0x${string}` | null>(initialBoundWallet);
  const [err,   setErr]   = useState<string | null>(null);
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

      const message   = bindMessage({ xHandle, xId, nonce, issuedAt });
      const signature = await signMessageAsync({ message });

      const bindRes = await fetch("/api/wallet/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, signature }),
      });
      const bindJson = await bindRes.json();
      if (!bindRes.ok) throw new Error(bindJson?.error || "bind_failed");
      setBound(address as `0x${string}`);
      onBound(address as `0x${string}`);
    } catch (e: unknown) {
      setErr(friendly((e as Error)?.message ?? "unknown"));
    } finally {
      setSubmitting(false);
    }
  };

  // Already bound — terminal state.
  if (bound && !mismatch) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-3 text-sm">
        <div className="flex items-center gap-2">
          <Check />
          <span className="text-ink">Wallet bound</span>
        </div>
        <div className="text-xs text-ink-faint mt-1 font-mono">{short(bound)}</div>
      </div>
    );
  }

  // Wallet connected → sign step.
  if (isConnected && address) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-line px-3 py-2.5 text-xs flex items-center justify-between gap-2">
          <span className="text-ink-muted shrink-0">Connected</span>
          <span className="font-mono text-ink truncate">{short(address)}</span>
          <button onClick={() => disconnect()} className="text-ink-faint hover:text-ink text-xs shrink-0">
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

  // No wallet connected → RainbowKit's polished modal.
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-faint">Pick a wallet to connect.</p>
      <ConnectButton
        chainStatus="none"
        showBalance={false}
        accountStatus="address"
        label="Connect wallet"
      />
    </div>
  );
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function friendly(msg: string): string {
  if (msg.includes("x_already_bound"))      return "This X account is already bound to a wallet.";
  if (msg.includes("wallet_already_bound")) return "This wallet is already bound to another X account.";
  if (msg.includes("nonce"))                return "Session timed out. Try again.";
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
