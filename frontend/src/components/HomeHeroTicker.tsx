"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { addresses, tempo, DOGE_DECIMALS, USDC_DECIMALS } from "@/config/chain";
import { erc20Abi } from "@/lib/abis";
import { pairAbi } from "@/lib/dexAbis";

const INITIAL_CAP = 210_000_000;

/// Live fDOGE ticker rendered under the hero — price, supply progress, and
/// a link into the Trade page. Pulls reserves + totalSupply in one batch.
export function HomeHeroTicker() {
  const pair = { address: addresses.pair, abi: pairAbi, chainId: tempo.id } as const;
  const doge = { address: addresses.doge, abi: erc20Abi, chainId: tempo.id } as const;

  const { data } = useReadContracts({
    contracts: [
      { ...pair, functionName: "getReserves" },
      { ...pair, functionName: "token0" },
      { ...doge, functionName: "totalSupply" },
    ],
    allowFailure: true,
    query: { refetchInterval: 10_000 },
  });

  const reserves = data?.[0]?.result as readonly [bigint, bigint, number] | undefined;
  const token0   = data?.[1]?.result as `0x${string}` | undefined;
  const supply   = data?.[2]?.result as bigint | undefined;

  const price = useMemo(() => {
    if (!reserves || !token0) return null;
    const isT0Doge = token0.toLowerCase() === addresses.doge.toLowerCase();
    const rDoge = isT0Doge ? reserves[0] : reserves[1];
    const rUsd  = isT0Doge ? reserves[1] : reserves[0];
    if (rDoge === 0n || rUsd === 0n) return null;
    const usdH  = Number(formatUnits(rUsd,  USDC_DECIMALS));
    const dogeH = Number(formatUnits(rDoge, DOGE_DECIMALS));
    return dogeH > 0 ? usdH / dogeH : null;
  }, [reserves, token0]);

  const supplyHuman = supply !== undefined
    ? Number(formatUnits(supply, DOGE_DECIMALS))
    : null;

  const supplyPct = supplyHuman !== null ? (supplyHuman / INITIAL_CAP) * 100 : null;

  return (
    <Link
      href="/trade"
      className="group block rounded-2xl border border-line bg-bg-surface hover:border-gold-400/40 transition-colors overflow-hidden max-w-2xl"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-line">
        <Cell
          label="fDOGE price"
          primary={price !== null ? fmtUsd(price) : "—"}
          secondary="USDC per fDOGE"
          emphasis
        />
        <Cell
          label="Circulating"
          primary={supplyHuman !== null ? fmtSupply(supplyHuman) : "—"}
          secondary={supplyPct !== null ? `${supplyPct.toFixed(4)}% of 210M` : "—"}
        />
        <Cell
          label="Live pair"
          primary="fDOGE / USDC"
          secondary="Open Trade →"
          ctaClass="text-gold-300 group-hover:text-gold-200"
          hideOnMobile
        />
      </div>
      {supplyPct !== null && (
        <div className="h-[3px] bg-bg-base">
          <div
            className="h-full bg-gradient-to-r from-gold-400 to-gold-300 transition-[width] duration-500"
            style={{ width: `${Math.min(100, supplyPct)}%` }}
          />
        </div>
      )}
    </Link>
  );
}

function Cell({
  label, primary, secondary, emphasis, ctaClass, hideOnMobile,
}: {
  label: string;
  primary: string;
  secondary: string;
  emphasis?: boolean;
  ctaClass?: string;
  hideOnMobile?: boolean;
}) {
  return (
    <div className={`p-5 ${hideOnMobile ? "hidden sm:block" : ""}`}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">{label}</div>
      <div className={`mt-2 font-display tracking-tight tabular ${emphasis ? "text-2xl text-gold-300" : "text-xl text-ink"}`}>
        {primary}
      </div>
      <div className={`mt-0.5 text-[11px] ${ctaClass ?? "text-ink-faint"}`}>{secondary}</div>
    </div>
  );
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n >= 1)    return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  // Keep ~3 significant figures for sub-cent amounts.
  const mag = Math.floor(Math.log10(Math.abs(n)));
  const dec = Math.min(10, Math.max(2, 2 - mag));
  return `$${n.toFixed(dec)}`;
}

function fmtSupply(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
