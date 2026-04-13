"use client";
import { useAccount, useDisconnect, useConfig, useReadContract } from "wagmi";
import { useEffect, useRef, useState } from "react";
import { WalletModal } from "./WalletModal";
import { tempo, addresses } from "@/config/chain";
import { namesAbi } from "@/lib/namesAbi";
import { useToast } from "./Toaster";
import { ensureTempoChain, prettifyError } from "@/lib/tx";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const config = useConfig();
  const toast = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const attemptedRef = useRef<number | undefined>(undefined);

  async function runSwitch(manual: boolean) {
    setSwitching(true);
    try {
      await ensureTempoChain(config);
    } catch (e) {
      if (manual) {
        toast.push({ kind: "error", title: "Switch failed", body: prettifyError(e), ttl: 8000 });
      }
    } finally {
      setSwitching(false);
    }
  }

  // Auto-switch when connected on any chain other than Tempo testnet. Remember
  // the last chain we tried for so we don't spam the user after a rejection.
  useEffect(() => {
    if (!isConnected) {
      attemptedRef.current = undefined;
      return;
    }
    if (chainId === tempo.id) return;
    if (attemptedRef.current === chainId) return;
    attemptedRef.current = chainId;
    runSwitch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, chainId]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!isConnected) {
    return (
      <div className="relative">
        <button
          onClick={() => setModalOpen((v) => !v)}
          className="px-4 py-2 rounded-md bg-gold-400 text-bg-base text-sm font-medium hover:bg-gold-300 transition-colors"
        >
          Connect wallet
        </button>
        <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </div>
    );
  }

  const wrongNetwork = chainId !== tempo.id;
  if (wrongNetwork) {
    return (
      <button
        onClick={() => { attemptedRef.current = undefined; runSwitch(true); }}
        disabled={switching}
        className="flex items-center gap-2 px-4 py-2 rounded-md border border-red-500/50 text-red-300 text-sm hover:bg-red-500/10 transition-colors disabled:opacity-40"
      >
        <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse" />
        {switching ? "Switching…" : "Switch to Tempo"}
      </button>
    );
  }

  const short = `${address!.slice(0, 6)}…${address!.slice(-4)}`;
  return (
    <div className="flex items-center gap-2">
      <ChainBadge />
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-md border border-line text-sm text-ink hover:border-gold-400/60 transition-colors"
        >
          <span className="h-2 w-2 rounded-full bg-gold-400 shadow-[0_0_8px_rgba(201,163,74,0.9)]" />
          <PrimaryName address={address!} fallback={short} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-2 w-52 rounded-xl border border-line bg-bg-raised shadow-2xl overflow-hidden z-40">
            <MenuItem onClick={() => { navigator.clipboard.writeText(address!); setMenuOpen(false); }}>
              Copy address
            </MenuItem>
            <a
              href={`${tempo.blockExplorers!.default.url}/address/${address}`}
              target="_blank" rel="noreferrer"
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2.5 text-sm text-ink-muted hover:text-ink hover:bg-bg-surface transition-colors"
            >
              View on explorer ↗
            </a>
            <div className="h-px bg-line mx-2" />
            <MenuItem onClick={() => { disconnect(); setMenuOpen(false); }}>
              Disconnect
            </MenuItem>
          </div>
        )}
      </div>
    </div>
  );
}

function PrimaryName({ address, fallback }: { address: `0x${string}`; fallback: string }) {
  const { data } = useReadContract({
    address: addresses.names,
    abi: namesAbi,
    functionName: "displayNameOf",
    args: [address],
    chainId: tempo.id,
    query: { refetchInterval: 30_000 },
  });
  const name = data as string | undefined;
  if (name && name.length > 0) {
    return <span className="font-display text-gold-300">{name}</span>;
  }
  return <span className="tabular">{fallback}</span>;
}

function ChainBadge() {
  return (
    <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gold-400/10 border border-gold-400/30 text-[11px] uppercase tracking-[0.2em] text-gold-300">
      <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
      Tempo · {tempo.id}
    </span>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="block w-full text-left px-4 py-2.5 text-sm text-ink-muted hover:text-ink hover:bg-bg-surface transition-colors"
    >
      {children}
    </button>
  );
}
