"use client";
import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { addresses, tempo } from "@/config/chain";
import { erc20Abi } from "@/lib/abis";
import { pairAbi } from "@/lib/dexAbis";

/// Token metrics shown in the trade grid. All USD values assume pathUSD is $1.
export type TokenMetrics = {
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
};

const TDOGE_INITIAL_CAP = 210_000_000;

/// Hook — returns metrics for every supplied token address in one pass.
export function useTokenMetrics(tokens: { address: `0x${string}`; decimals: number; symbol: string }[]) {
  // 1 read per token: totalSupply
  // 1 global: pair reserves for TDOGE price
  const supplyContracts = tokens.map((t) => ({
    address: t.address,
    abi: erc20Abi,
    functionName: "totalSupply" as const,
    chainId: tempo.id,
  }));
  const { data: supplies } = useReadContracts({
    contracts: supplyContracts,
    allowFailure: true,
    query: { refetchInterval: 15_000 },
  });

  const { data: pairData } = useReadContracts({
    contracts: [
      { address: addresses.pair, abi: pairAbi, functionName: "getReserves", chainId: tempo.id },
      { address: addresses.pair, abi: pairAbi, functionName: "token0",      chainId: tempo.id },
    ],
    allowFailure: true,
    query: { refetchInterval: 10_000 },
  });

  return useMemo(() => {
    const reserves = pairData?.[0]?.result as readonly [bigint, bigint, number] | undefined;
    const token0   = pairData?.[1]?.result as `0x${string}` | undefined;

    let tdogePriceUsd: number | null = null;
    let pathUSDReserveUsd: number | null = null;

    if (reserves && token0) {
      const pathIsT0 = token0.toLowerCase() === addresses.pathUSD.toLowerCase();
      const rPath = pathIsT0 ? reserves[0] : reserves[1];
      const rDoge = pathIsT0 ? reserves[1] : reserves[0];
      if (rPath > 0n && rDoge > 0n) {
        // pathUSD is 6-dec, TDOGE is 18-dec.
        const pathHuman = Number(formatUnits(rPath, 6));
        const dogeHuman = Number(formatUnits(rDoge, 18));
        if (dogeHuman > 0) {
          tdogePriceUsd = pathHuman / dogeHuman;
          pathUSDReserveUsd = pathHuman; // 1 pathUSD = $1
        }
      }
    }

    const out: Record<string, TokenMetrics> = {};
    tokens.forEach((t, i) => {
      const total = supplies?.[i]?.result as bigint | undefined;
      const totalHuman = total !== undefined ? Number(formatUnits(total, t.decimals)) : null;

      const isTdoge = t.address.toLowerCase() === addresses.doge.toLowerCase();
      const isStable = /USD$/i.test(t.symbol) || t.address.toLowerCase() === addresses.pathUSD.toLowerCase();

      let price: number | null = null;
      if (isTdoge) price = tdogePriceUsd;
      else if (isStable) price = 1;

      const mc  = price !== null && totalHuman !== null ? price * totalHuman : null;
      const fdv = isTdoge ? (price !== null ? price * TDOGE_INITIAL_CAP : null) : mc;
      const liquidity = isTdoge && pathUSDReserveUsd !== null
        ? pathUSDReserveUsd * 2 // both sides of the pool in USD
        : null;

      out[t.address.toLowerCase()] = {
        priceUsd: price,
        marketCapUsd: mc,
        fdvUsd: fdv,
        liquidityUsd: liquidity,
        circulatingSupply: totalHuman, // no burn tracking yet
        totalSupply: totalHuman,
        volume24hUsd: null,      // backend indexer pending
        priceChange24hPct: null, // backend indexer pending
      };
    });
    return out;
  }, [supplies, pairData, tokens]);
}

export function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  const a = Math.abs(n);
  if (a === 0) return "$0";
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000)     return `$${(n / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000)         return `$${(n / 1_000).toFixed(2)}K`;
  if (a >= 1)             return `$${n.toFixed(2)}`;
  // Sub-dollar: pick decimals so ~3 significant digits show, capped at 8.
  const mag = Math.floor(Math.log10(a));      // e.g. 0.01 -> -2, 0.0001 -> -4
  const decimals = Math.min(8, Math.max(2, 2 - mag));
  return `$${n.toFixed(decimals)}`;
}

export function fmtSupply(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  if (n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
