"use client";
import { useAccount, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import Link from "next/link";
import { addresses, PATHUSD_DECIMALS, DOGE_DECIMALS, tempo } from "@/config/chain";
import { erc20Abi, minerAbi } from "@/lib/abis";
import { useIdentity } from "@/lib/useIdentity";

export default function PortfolioPage() {
  const { address } = useAccount();
  const identity = useIdentity(address);

  const { data } = useReadContracts({
    contracts: [
      { address: addresses.doge,    abi: erc20Abi, functionName: "balanceOf",   args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "balanceOf",   args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.miner,   abi: minerAbi, functionName: "pendingAll",  args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.miner,   abi: minerAbi, functionName: "minerScore",  args: address ? [address] : undefined, chainId: tempo.id },
    ],
    allowFailure: true,
    query: { refetchInterval: 5000 },
  });

  const doge    = data?.[0]?.result as bigint | undefined;
  const usd     = data?.[1]?.result as bigint | undefined;
  const pendAll = data?.[2]?.result as readonly [bigint, bigint, bigint] | undefined;
  const score   = data?.[3]?.result as bigint | undefined;

  if (!address) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center max-w-sm">
          <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80">Portfolio</p>
          <h1 className="font-display text-3xl tracking-tight mt-3">Connect a wallet</h1>
          <p className="text-ink-muted mt-3 text-sm">
            Your balances, mining position, and miner score will appear here.
          </p>
        </div>
      </div>
    );
  }

  const openCount     = pendAll ? Number(pendAll[0]) : 0;
  const totalCommit   = pendAll ? pendAll[1] : 0n;
  const totalPending  = pendAll ? pendAll[2] : 0n;

  return (
    <div className="space-y-12">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80">Portfolio</p>
        <h1 className="font-display text-4xl sm:text-5xl tracking-tightest mt-3 break-all">
          {identity ? <>{identity}</> : "Your holdings"}
        </h1>
        {!identity && (
          <p className="mt-3 text-sm text-ink-muted">
            Claim a <a href="/id" className="text-gold-300 hover:text-gold-200">.tdoge identity</a> to display it across the app.
          </p>
        )}
      </div>

      <section className="grid sm:grid-cols-2 gap-px bg-line rounded-xl overflow-hidden">
        <Card label="TDOGE Balance"   value={doge !== undefined ? fmt(doge, DOGE_DECIMALS)    : "-"} unit="TDOGE"   emphasis />
        <Card label="pathUSD Balance" value={usd  !== undefined ? fmt(usd,  PATHUSD_DECIMALS) : "-"} unit="pathUSD" />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-ink-faint">Mining summary</p>
            <h2 className="font-display text-2xl tracking-tight mt-1">Across all positions</h2>
          </div>
          <Link href="/mine" className="text-sm text-gold-300 hover:text-gold-200 transition-colors">
            Manage positions →
          </Link>
        </div>
        <div className="grid sm:grid-cols-4 gap-px bg-line rounded-xl overflow-hidden">
          <Card label="Open Positions"  value={String(openCount)}             unit={openCount === 1 ? "position" : "positions"} />
          <Card label="Committed"       value={fmt(totalCommit, PATHUSD_DECIMALS)} unit="pathUSD active" />
          <Card label="Pending TDOGE"   value={fmt(totalPending, DOGE_DECIMALS)}   unit="accrued plus projected" emphasis />
          <Card label="Miner Score"     value={score !== undefined ? fmt(score, PATHUSD_DECIMALS) : "-"} unit="points" />
        </div>
        {openCount === 0 && (
          <div className="mt-4 rounded-xl border border-line bg-bg-surface p-6 text-center text-sm text-ink-muted">
            No mining positions yet.{" "}
            <Link href="/mine" className="text-gold-300 hover:text-gold-200">Open your first position →</Link>
          </div>
        )}
      </section>
    </div>
  );
}

function Card({
  label, value, unit, emphasis,
}: { label: string; value: string; unit: string; emphasis?: boolean }) {
  return (
    <div className="p-6 bg-bg-surface">
      <div className="text-[11px] uppercase tracking-[0.22em] text-ink-faint">{label}</div>
      <div className={`mt-3 font-display tabular tracking-tight ${emphasis ? "text-3xl text-gold-300" : "text-2xl text-ink"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-ink-faint">{unit}</div>
    </div>
  );
}

function fmt(v: bigint, decimals: number): string {
  const n = Number(formatUnits(v, decimals));
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(2) + "K";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
