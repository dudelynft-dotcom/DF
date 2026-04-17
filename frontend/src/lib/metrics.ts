"use client";
import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { addresses, tempo } from "@/config/chain";
import { erc20Abi } from "@/lib/abis";
import { pairAbi, forgeFactoryAbi } from "@/lib/dexAbis";

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
export function useTokenMetrics(tokens: { address: `0x${string}`; decimals: number; symbol: string; kind?: string }[]) {
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

  // fDOGE pair reads (legacy single-pair)
  const { data: pairData } = useReadContracts({
    contracts: [
      { address: addresses.pair, abi: pairAbi, functionName: "getReserves", chainId: tempo.id },
      { address: addresses.pair, abi: pairAbi, functionName: "token0",      chainId: tempo.id },
    ],
    allowFailure: true,
    query: { refetchInterval: 10_000 },
  });

  // For "project" tokens other than fDOGE (e.g. cDOGE), resolve their
  // USDC pair from the factory + read reserves to compute price.
  const projectTokens = tokens.filter(
    (t) => t.kind === "project" && t.address.toLowerCase() !== addresses.doge.toLowerCase(),
  );
  const { data: pairAddrs } = useReadContracts({
    contracts: projectTokens.map((t) => ({
      address: addresses.factory,
      abi: forgeFactoryAbi,
      functionName: "getPair" as const,
      args: [t.address, addresses.usdc],
      chainId: tempo.id,
    })),
    allowFailure: true,
    query: { enabled: projectTokens.length > 0, refetchInterval: 30_000 },
  });
  // Read reserves + token0 for each resolved pair.
  const resolvedPairs = (pairAddrs ?? [])
    .map((r) => r?.result as `0x${string}` | undefined)
    .filter((a): a is `0x${string}` => !!a && a !== "0x0000000000000000000000000000000000000000");
  const { data: projectPairData } = useReadContracts({
    contracts: resolvedPairs.flatMap((pair) => [
      { address: pair, abi: pairAbi, functionName: "getReserves" as const, chainId: tempo.id },
      { address: pair, abi: pairAbi, functionName: "token0" as const, chainId: tempo.id },
    ]),
    allowFailure: true,
    query: { enabled: resolvedPairs.length > 0, refetchInterval: 10_000 },
  });

  return useMemo(() => {
    // --- fDOGE price from its dedicated pair ---
    const reserves = pairData?.[0]?.result as readonly [bigint, bigint, number] | undefined;
    const token0   = pairData?.[1]?.result as `0x${string}` | undefined;

    let tdogePriceUsd: number | null = null;
    let pathUSDReserveUsd: number | null = null;

    if (reserves && token0) {
      const pathIsT0 = token0.toLowerCase() === addresses.pathUSD.toLowerCase();
      const rPath = pathIsT0 ? reserves[0] : reserves[1];
      const rDoge = pathIsT0 ? reserves[1] : reserves[0];
      if (rPath > 0n && rDoge > 0n) {
        const pathHuman = Number(formatUnits(rPath, 6));
        const dogeHuman = Number(formatUnits(rDoge, 18));
        if (dogeHuman > 0) {
          tdogePriceUsd = pathHuman / dogeHuman;
          pathUSDReserveUsd = pathHuman;
        }
      }
    }

    // --- Project token prices from dynamically resolved pairs ---
    const projectPrices: Record<string, { price: number; liqUsd: number }> = {};
    projectTokens.forEach((t, i) => {
      const pairAddr = pairAddrs?.[i]?.result as `0x${string}` | undefined;
      if (!pairAddr || pairAddr === "0x0000000000000000000000000000000000000000") return;
      const pairIdx = resolvedPairs.indexOf(pairAddr);
      if (pairIdx < 0) return;
      const res = projectPairData?.[pairIdx * 2]?.result as readonly [bigint, bigint, number] | undefined;
      const t0  = projectPairData?.[pairIdx * 2 + 1]?.result as `0x${string}` | undefined;
      if (!res || !t0) return;
      const usdcIsT0 = t0.toLowerCase() === addresses.usdc.toLowerCase();
      const rUsdc  = usdcIsT0 ? res[0] : res[1];
      const rToken = usdcIsT0 ? res[1] : res[0];
      if (rUsdc > 0n && rToken > 0n) {
        const usdcHuman  = Number(formatUnits(rUsdc, 6));
        const tokenHuman = Number(formatUnits(rToken, t.decimals));
        if (tokenHuman > 0) {
          projectPrices[t.address.toLowerCase()] = {
            price: usdcHuman / tokenHuman,
            liqUsd: usdcHuman * 2,
          };
        }
      }
    });

    const out: Record<string, TokenMetrics> = {};
    tokens.forEach((t, i) => {
      const total = supplies?.[i]?.result as bigint | undefined;
      const totalHuman = total !== undefined ? Number(formatUnits(total, t.decimals)) : null;

      const isTdoge = t.address.toLowerCase() === addresses.doge.toLowerCase();
      const isStable =
        t.kind === "stablecoin" || t.kind === "native-stable"
        || /USD$|USDC$|USDT$|USYC$/i.test(t.symbol)
        || t.address.toLowerCase() === addresses.usdc.toLowerCase();
      const pp = projectPrices[t.address.toLowerCase()];

      let price: number | null = null;
      let liquidity: number | null = null;
      if (isTdoge) {
        price = tdogePriceUsd;
        liquidity = pathUSDReserveUsd !== null ? pathUSDReserveUsd * 2 : null;
      } else if (isStable) {
        price = 1;
      } else if (pp) {
        price = pp.price;
        liquidity = pp.liqUsd;
      }

      const mc  = price !== null && totalHuman !== null ? price * totalHuman : null;
      const fdv = isTdoge ? (price !== null ? price * TDOGE_INITIAL_CAP : null) : mc;

      out[t.address.toLowerCase()] = {
        priceUsd: price,
        marketCapUsd: mc,
        fdvUsd: fdv,
        liquidityUsd: liquidity,
        circulatingSupply: totalHuman,
        totalSupply: totalHuman,
        volume24hUsd: null,
        priceChange24hPct: null,
      };
    });
    return out;
  }, [supplies, pairData, pairAddrs, projectPairData, tokens, projectTokens]);
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
