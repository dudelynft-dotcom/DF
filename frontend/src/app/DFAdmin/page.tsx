"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { minerAbi } from "@/lib/abis";

const MINER = process.env.NEXT_PUBLIC_MINER_ADDRESS as `0x${string}` | undefined;
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;
const ADMIN_ADDRESS = (process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "").toLowerCase();

type TokenRow = {
  address: string;
  symbol: string;
  name: string;
  verified: boolean;
  first_seen: number;
  creator: string;
};

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const pub = usePublicClient();
  const { writeContractAsync, isPending: writing } = useWriteContract();

  const isAdmin = useMemo(() => {
    if (!address) return false;
    if (!ADMIN_ADDRESS) return false;
    return address.toLowerCase() === ADMIN_ADDRESS;
  }, [address]);

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [globalMult, setGlobalMult] = useState<string>("");
  const [flowRate, setFlowRate] = useState<string>("");
  const [walletCap, setWalletCap] = useState<string>("");
  const [pendingLq, setPendingLq] = useState<string>("");
  const [msg, setMsg] = useState<string>("");

  async function loadTokens() {
    if (!BACKEND) return;
    setTokensLoading(true);
    try {
      const r = await fetch(`${BACKEND}/tokens?view=all`, { cache: "no-store" });
      const j = await r.json();
      setTokens(j.tokens ?? []);
    } finally {
      setTokensLoading(false);
    }
  }

  async function loadMinerState() {
    if (!pub || !MINER) return;
    try {
      const [p, gm, fr, cap, plq] = await Promise.all([
        pub.readContract({ address: MINER, abi: minerAbi, functionName: "paused" }).catch(() => null),
        pub.readContract({ address: MINER, abi: minerAbi, functionName: "globalMultiplier" }),
        pub.readContract({ address: MINER, abi: minerAbi, functionName: "flowRateBpsPerDay" }),
        pub.readContract({ address: MINER, abi: minerAbi, functionName: "perWalletCap" }),
        pub.readContract({ address: MINER, abi: minerAbi, functionName: "pendingLiquidity" }),
      ]);
      setPaused(p as boolean | null);
      setGlobalMult(String(gm));
      setFlowRate(String(fr));
      setWalletCap(formatUnits(cap as bigint, 6));
      setPendingLq(formatUnits(plq as bigint, 6));
    } catch (e) {
      console.warn("read miner state", e);
    }
  }

  useEffect(() => {
    if (isAdmin) {
      loadTokens();
      loadMinerState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function toggleVerify(addr: string, next: boolean) {
    setMsg("");
    const r = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr, verified: next }),
    });
    if (!r.ok) {
      setMsg(`verify failed: ${r.status}`);
      return;
    }
    await loadTokens();
  }

  async function toggleHide(addr: string, next: boolean) {
    setMsg("");
    const r = await fetch("/api/admin/hide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr, hidden: next }),
    });
    if (!r.ok) {
      setMsg(`hide failed: ${r.status}`);
      return;
    }
    await loadTokens();
  }

  type AdminFn = "pause" | "unpause" | "flush" | "setGlobalMultiplier" | "setFlowRateBpsPerDay" | "setPerWalletCap";
  async function sendWrite(fn: AdminFn, arg?: bigint): Promise<void> {
    if (!MINER) return;
    setMsg("");
    try {
      const hash = await writeContractAsync({
        address: MINER,
        abi: minerAbi,
        functionName: fn,
        args: (arg !== undefined ? [arg] : []) as never,
        chainId,
      });
      setMsg(`sent: ${hash.slice(0, 10)}…`);
      // give chain a sec, then refresh
      setTimeout(loadMinerState, 4000);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  // ---- render ----

  if (!isConnected) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <h1 className="font-display text-3xl mb-3">Admin</h1>
        <p className="text-ink-muted">Connect your admin wallet to continue.</p>
      </div>
    );
  }

  if (!ADMIN_ADDRESS) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <h1 className="font-display text-3xl mb-3">Admin</h1>
        <p className="text-ink-muted">
          <code className="text-gold-300">NEXT_PUBLIC_ADMIN_ADDRESS</code> is not set in Vercel.
          Add it (your admin EOA) and redeploy.
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <h1 className="font-display text-3xl mb-3">Admin</h1>
        <p className="text-ink-muted">
          This wallet is not authorized. Connect the admin wallet ({ADMIN_ADDRESS.slice(0, 6)}…{ADMIN_ADDRESS.slice(-4)}).
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/80">Console</p>
        <h1 className="font-display text-4xl sm:text-5xl tracking-tightest mt-3">Admin</h1>
        <p className="text-ink-muted mt-3 text-sm">
          Signed in as <span className="tabular text-gold-300">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
          · Chain {chainId}
        </p>
      </div>

      {msg && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-gold-400/40 bg-gold-400/5 text-sm text-gold-200">
          {msg}
        </div>
      )}

      {/* ─── Contract: Miner ─── */}
      <section className="mb-12 rounded-2xl border border-line bg-bg-surface p-6">
        <h2 className="font-display text-xl mb-1">Miner</h2>
        <p className="text-ink-faint text-xs mb-6 break-all">{MINER}</p>

        <div className="grid sm:grid-cols-2 gap-6">
          <Stat label="Paused" value={paused === null ? "n/a" : paused ? "yes" : "no"} />
          <Stat label="Pending liquidity (USDC)" value={pendingLq} />
          <NumberField
            label="globalMultiplier (bps, 10000 = 1×)"
            value={globalMult}
            onChange={setGlobalMult}
            onSave={(v) => sendWrite("setGlobalMultiplier", BigInt(v))}
            disabled={writing}
          />
          <NumberField
            label="flowRateBpsPerDay"
            value={flowRate}
            onChange={setFlowRate}
            onSave={(v) => sendWrite("setFlowRateBpsPerDay", BigInt(v))}
            disabled={writing}
          />
          <NumberField
            label="perWalletCap (whole USDC)"
            value={walletCap}
            onChange={setWalletCap}
            onSave={(v) => sendWrite("setPerWalletCap", parseUnits(v, 6))}
            disabled={writing}
          />
        </div>

        <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-line">
          <AdminButton onClick={() => sendWrite("flush")} disabled={writing}>
            flush()
          </AdminButton>
          {paused ? (
            <AdminButton onClick={() => sendWrite("unpause")} disabled={writing}>
              unpause()
            </AdminButton>
          ) : (
            <AdminButton danger onClick={() => sendWrite("pause")} disabled={writing}>
              pause()
            </AdminButton>
          )}
          <AdminButton onClick={loadMinerState} disabled={writing}>
            refresh
          </AdminButton>
        </div>
      </section>

      {/* ─── Backend: Tokens ─── */}
      <section className="mb-12 rounded-2xl border border-line bg-bg-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-xl">Tokens</h2>
            <p className="text-ink-faint text-xs">
              {BACKEND ? `${tokens.length} in index` : "NEXT_PUBLIC_BACKEND_URL not set"}
            </p>
          </div>
          <AdminButton onClick={loadTokens} disabled={tokensLoading}>
            {tokensLoading ? "…" : "refresh"}
          </AdminButton>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-faint text-[11px] uppercase tracking-[0.18em]">
                <th className="text-left py-2">Symbol</th>
                <th className="text-left py-2">Address</th>
                <th className="text-left py-2">Verified</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.address} className="border-t border-line">
                  <td className="py-2 pr-4 text-ink">{t.symbol}</td>
                  <td className="py-2 pr-4 tabular text-ink-muted">
                    {t.address.slice(0, 8)}…{t.address.slice(-6)}
                  </td>
                  <td className="py-2 pr-4">
                    {t.verified ? (
                      <span className="text-green-300">yes</span>
                    ) : (
                      <span className="text-ink-faint">no</span>
                    )}
                  </td>
                  <td className="py-2 text-right space-x-2">
                    <button
                      onClick={() => toggleVerify(t.address, !t.verified)}
                      className="px-2 py-1 text-xs rounded border border-line hover:border-gold-400/60 hover:text-gold-200"
                    >
                      {t.verified ? "unverify" : "verify"}
                    </button>
                    <button
                      onClick={() => toggleHide(t.address, true)}
                      className="px-2 py-1 text-xs rounded border border-red-500/30 text-red-300 hover:bg-red-500/10"
                    >
                      hide
                    </button>
                  </td>
                </tr>
              ))}
              {!tokensLoading && tokens.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-ink-faint text-sm">
                    No tokens yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">{label}</div>
      <div className="mt-1 tabular text-ink">{value}</div>
    </div>
  );
}

function NumberField({
  label, value, onChange, onSave, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSave: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-ink-faint mb-1">{label}</div>
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 rounded-md bg-bg-base border border-line text-sm tabular text-ink focus:border-gold-400/60 focus:outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <AdminButton onClick={() => onSave(value)} disabled={disabled}>save</AdminButton>
      </div>
    </div>
  );
}

function AdminButton({
  children, onClick, disabled, danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "px-3 py-2 text-xs rounded-md border transition-colors disabled:opacity-50",
        danger
          ? "border-red-500/40 text-red-300 hover:bg-red-500/10"
          : "border-line text-ink hover:border-gold-400/60 hover:text-gold-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
