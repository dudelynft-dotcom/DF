"use client";
import { useAccount, useConfig, useReadContract, useReadContracts } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { formatUnits } from "viem";
import Link from "next/link";
import { useMemo, useState } from "react";
import { addresses, PATHUSD_DECIMALS, DOGE_DECIMALS, tempo } from "@/config/chain";
import { erc20Abi, minerAbi } from "@/lib/abis";
import { pairAbi } from "@/lib/dexAbis";
import { sendTx, prettifyError } from "@/lib/tx";
import { useToast } from "@/components/Toaster";
import { useIdentity } from "@/lib/useIdentity";

type Position = {
  remaining: bigint;
  totalDeposited: bigint;
  lastUpdate: bigint;
  unlockAt: bigint;
  mode: number;
  open: boolean;
  pendingDoge: bigint;
};

const MODES = ["Instant", "Monthly", "Long-Term"] as const;

export default function PortfolioPage() {
  const { address } = useAccount();
  const config = useConfig();
  const toast = useToast();
  const identity = useIdentity(address);
  const [claiming, setClaiming] = useState(false);

  const { data, refetch } = useReadContracts({
    contracts: [
      { address: addresses.doge,    abi: erc20Abi, functionName: "balanceOf",   args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "balanceOf",   args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.miner,   abi: minerAbi, functionName: "pendingAll",  args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.miner,   abi: minerAbi, functionName: "minerScore",  args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.pair,    abi: pairAbi,  functionName: "getReserves",                                         chainId: tempo.id },
      { address: addresses.pair,    abi: pairAbi,  functionName: "token0",                                              chainId: tempo.id },
    ],
    allowFailure: true,
    query: { refetchInterval: 5000 },
  });

  const doge    = data?.[0]?.result as bigint | undefined;
  const usd     = data?.[1]?.result as bigint | undefined;
  const pendAll = data?.[2]?.result as readonly [bigint, bigint, bigint] | undefined;
  const score   = data?.[3]?.result as bigint | undefined;
  const reserves = data?.[4]?.result as readonly [bigint, bigint, number] | undefined;
  const token0   = data?.[5]?.result as `0x${string}` | undefined;

  // Positions array + live-earning preview
  const { data: posArr, refetch: refetchPositions } = useReadContract({
    address: addresses.miner, abi: minerAbi, functionName: "getPositions",
    args: address ? [address] : undefined,
    chainId: tempo.id,
    query: { enabled: !!address, refetchInterval: 5000 },
  });
  const positions = (posArr as Position[] | undefined) ?? [];
  const openPositions = useMemo(
    () => positions.map((p, idx) => ({ ...p, id: idx })).filter((p) => p.open),
    [positions],
  );

  const { data: pendingPerPos } = useReadContracts({
    contracts: openPositions.map((p) => ({
      address: addresses.miner, abi: minerAbi, functionName: "pending" as const,
      args: [address!, BigInt(p.id)] as const,
      chainId: tempo.id,
    })),
    allowFailure: true,
    query: { enabled: !!address && openPositions.length > 0, refetchInterval: 4000 },
  });
  const liveById = new Map<number, bigint>();
  openPositions.forEach((p, i) => {
    const r = pendingPerPos?.[i]?.result as readonly [bigint, bigint, bigint] | undefined;
    if (r) liveById.set(p.id, r[1]);
  });

  // fDOGE price from pair reserves → used for USD valuation.
  const fdogePrice = useMemo(() => {
    if (!reserves || !token0) return null;
    const isT0Doge = token0.toLowerCase() === addresses.doge.toLowerCase();
    const rDoge = isT0Doge ? reserves[0] : reserves[1];
    const rUsd  = isT0Doge ? reserves[1] : reserves[0];
    if (rDoge === 0n || rUsd === 0n) return null;
    const usdH  = Number(formatUnits(rUsd,  PATHUSD_DECIMALS));
    const dogeH = Number(formatUnits(rDoge, DOGE_DECIMALS));
    return dogeH > 0 ? usdH / dogeH : null;
  }, [reserves, token0]);

  if (!address) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center max-w-sm">
          <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80">Portfolio</p>
          <h1 className="font-display text-3xl tracking-tight mt-3">Connect a wallet</h1>
          <p className="text-ink-muted mt-3 text-sm">
            Your balances, mining positions, and miner score will appear here.
          </p>
        </div>
      </div>
    );
  }

  const openCount    = pendAll ? Number(pendAll[0]) : 0;
  const totalCommit  = pendAll ? pendAll[1] : 0n;
  const totalPending = pendAll ? pendAll[2] : 0n;

  // USD valuations
  const dogeUsd    = doge !== undefined && fdogePrice !== null
    ? Number(formatUnits(doge, DOGE_DECIMALS)) * fdogePrice
    : null;
  const usdcUsd    = usd !== undefined
    ? Number(formatUnits(usd, PATHUSD_DECIMALS))
    : null;
  const commitUsd  = Number(formatUnits(totalCommit, PATHUSD_DECIMALS));
  const pendingUsd = fdogePrice !== null
    ? Number(formatUnits(totalPending, DOGE_DECIMALS)) * fdogePrice
    : null;
  const totalUsd   = (dogeUsd ?? 0) + (usdcUsd ?? 0) + commitUsd + (pendingUsd ?? 0);

  // Any position unlocked AND with pending rewards → harvestAll is worth calling.
  const nowSec = Math.floor(Date.now() / 1000);
  const anyClaimable = openPositions.some((p) => {
    const live = liveById.get(p.id) ?? p.pendingDoge;
    return Number(p.unlockAt) <= nowSec && live > 0n;
  });

  async function onClaimAll() {
    if (!anyClaimable) return;
    const id = toast.push({ kind: "pending", title: "Claiming all unlocked", ttl: 0 });
    setClaiming(true);
    try {
      const hash = await sendTx(config, {
        address: addresses.miner, abi: minerAbi, functionName: "harvestAll",
      });
      toast.update(id, { body: "Submitted. Waiting for confirmation.", hash });
      const r = await waitForTransactionReceipt(config, { hash, chainId: tempo.id });
      if (r.status === "success") {
        toast.update(id, { kind: "success", title: "Claimed", body: undefined, ttl: 6000 });
        refetch(); refetchPositions();
      } else {
        toast.update(id, { kind: "error", title: "Transaction reverted", body: undefined, ttl: 8000 });
      }
    } catch (e) {
      toast.update(id, { kind: "error", title: "Claim failed", body: prettifyError(e), ttl: 8000 });
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="space-y-12">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80">Portfolio</p>
        <h1 className="font-display text-4xl sm:text-5xl tracking-tightest mt-3 break-all">
          {identity ? <>{identity}</> : "Your holdings"}
        </h1>
        {!identity && (
          <p className="mt-3 text-sm text-ink-muted">
            Claim a <Link href="/id" className="text-gold-300 hover:text-gold-200">.fdoge identity</Link> to display it across the app.
          </p>
        )}
      </div>

      {/* Total portfolio value — hero */}
      <section className="rounded-2xl border border-gold-400/40 bg-gradient-to-br from-gold-400/10 via-bg-surface to-bg-surface p-6 md:p-8">
        <p className="text-[11px] uppercase tracking-[0.28em] text-gold-400/90">Total portfolio value</p>
        <div className="mt-3 font-display text-5xl md:text-6xl tracking-tightest text-gold-200 tabular">
          {fdogePrice !== null ? fmtUsd(totalUsd) : "—"}
        </div>
        <div className="mt-2 text-xs text-ink-muted">
          Wallet balances + committed USDC + pending fDOGE at current pool price.
        </div>
        {anyClaimable && (
          <button
            onClick={onClaimAll}
            disabled={claiming}
            className="mt-5 px-5 py-2.5 rounded-md bg-gold-400 text-bg-base text-sm font-semibold hover:bg-gold-300 transition-colors disabled:opacity-40"
          >
            {claiming ? "Claiming…" : "Claim all unlocked"}
          </button>
        )}
      </section>

      {/* Balances */}
      <section className="grid sm:grid-cols-2 gap-px bg-line rounded-xl overflow-hidden">
        <Card
          label="fDOGE Balance"
          value={doge !== undefined ? fmt(doge, DOGE_DECIMALS) : "-"}
          unit="fDOGE"
          secondary={dogeUsd !== null ? `≈ ${fmtUsd(dogeUsd)}` : undefined}
          emphasis
        />
        <Card
          label="USDC Balance"
          value={usd !== undefined ? fmt(usd, PATHUSD_DECIMALS) : "-"}
          unit="USDC"
          secondary={usdcUsd !== null ? `≈ ${fmtUsd(usdcUsd)}` : undefined}
        />
      </section>

      {/* Mining summary */}
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
          <Card label="Open Positions" value={String(openCount)} unit={openCount === 1 ? "position" : "positions"} />
          <Card
            label="Committed"
            value={fmt(totalCommit, PATHUSD_DECIMALS)}
            unit="USDC active"
            secondary={commitUsd > 0 ? `≈ ${fmtUsd(commitUsd)}` : undefined}
          />
          <Card
            label="Pending fDOGE"
            value={fmt(totalPending, DOGE_DECIMALS)}
            unit="accrued + projected"
            secondary={pendingUsd !== null && pendingUsd > 0 ? `≈ ${fmtUsd(pendingUsd)}` : undefined}
            emphasis
          />
          <Card label="Miner Score" value={score !== undefined ? fmt(score, PATHUSD_DECIMALS) : "-"} unit="points" />
        </div>
      </section>

      {/* Per-position mini cards (read-only; Mine page has the action UI) */}
      {openPositions.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg-surface p-8 text-center text-sm text-ink-muted">
          No mining positions yet.{" "}
          <Link href="/mine" className="text-gold-300 hover:text-gold-200">Open your first position →</Link>
        </div>
      ) : (
        <section>
          <p className="text-xs uppercase tracking-[0.24em] text-ink-faint mb-4">Active positions</p>
          <div className="space-y-2">
            {openPositions.map((p) => (
              <PositionRow
                key={p.id}
                p={p}
                nowSec={nowSec}
                live={liveById.get(p.id) ?? p.pendingDoge}
                priceUsd={fdogePrice}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PositionRow({
  p, nowSec, live, priceUsd,
}: {
  p: Position & { id: number };
  nowSec: number;
  live: bigint;
  priceUsd: number | null;
}) {
  const unlockAt = Number(p.unlockAt);
  const unlocked = unlockAt <= nowSec;
  const mode = MODES[p.mode] ?? "Instant";
  const flowed = p.totalDeposited - p.remaining;
  const pct = p.totalDeposited > 0n
    ? Number((flowed * 10_000n) / p.totalDeposited) / 100
    : 0;
  const liveUsd = priceUsd !== null
    ? Number(formatUnits(live, DOGE_DECIMALS)) * priceUsd
    : null;

  return (
    <div className="rounded-lg border border-line bg-bg-surface p-4 grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-3 md:gap-5 items-center">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">#{p.id}</span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${
          p.mode === 0 ? "bg-white/5 text-ink-muted"
          : p.mode === 1 ? "bg-gold-400/15 text-gold-300"
          : "bg-gold-400/25 text-gold-200"
        }`}>{mode}</span>
        {unlocked ? (
          <span className="text-[10px] text-emerald-300">Unlocked</span>
        ) : (
          <span className="text-[10px] text-ink-faint">locks {new Date(unlockAt * 1000).toLocaleDateString()}</span>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between text-[11px] text-ink-faint tabular">
          <span>{fmt(flowed, PATHUSD_DECIMALS)} / {fmt(p.totalDeposited, PATHUSD_DECIMALS)} USDC converted</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-bg-base overflow-hidden">
          <div className="h-full bg-gold-400 transition-[width] duration-500" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="font-display tabular text-gold-300 text-base">
          {fmt(live, DOGE_DECIMALS)} <span className="text-[10px] text-ink-faint">fDOGE</span>
        </div>
        {liveUsd !== null && liveUsd > 0 && (
          <div className="text-[10px] text-ink-faint tabular">≈ {fmtUsd(liveUsd)}</div>
        )}
      </div>
    </div>
  );
}

function Card({
  label, value, unit, emphasis, secondary,
}: { label: string; value: string; unit: string; emphasis?: boolean; secondary?: string }) {
  return (
    <div className="p-6 bg-bg-surface">
      <div className="text-[11px] uppercase tracking-[0.22em] text-ink-faint">{label}</div>
      <div className={`mt-3 font-display tabular tracking-tight ${emphasis ? "text-3xl text-gold-300" : "text-2xl text-ink"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-ink-faint">{unit}</div>
      {secondary && <div className="mt-1 text-[11px] text-ink-muted tabular">{secondary}</div>}
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

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0.00";
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000)     return `$${(n / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000)         return `$${(n / 1_000).toFixed(2)}K`;
  if (a >= 1)             return `$${n.toFixed(2)}`;
  if (a >= 0.01)          return `$${n.toFixed(4)}`;
  const mag = Math.floor(Math.log10(a));
  const dec = Math.min(10, Math.max(2, 2 - mag));
  return `$${n.toFixed(dec)}`;
}
