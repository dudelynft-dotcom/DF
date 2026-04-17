"use client";
import { useEffect, useState } from "react";
import { usePublicClient, useReadContracts } from "wagmi";
import { formatUnits, parseAbiItem } from "viem";
import { addresses, tempo, PATHUSD_DECIMALS, DOGE_DECIMALS } from "@/config/chain";
import { erc20Abi, minerAbi } from "@/lib/abis";

const committedEvent = parseAbiItem(
  "event Committed(address indexed user, uint256 indexed positionId, uint256 amount, uint8 mode, uint64 unlockAt)"
);

export function LiveStats() {
  const client = usePublicClient();
  const [miners, setMiners] = useState<number | null>(null);

  // Read USDC balance of every protocol contract to compute TVL.
  // Split into Mining TVL (Miner + LiquidityManager pipeline) and
  // LP TVL (all pair contracts holding USDC).
  const CDOGE_PAIR  = "0x152B8a54835Ac5853ec449B60DCAB55da3A355DD" as `0x${string}`;
  const EURC_PAIR   = "0xa699a07e68fe465d684374af02fe6105b18b5209" as `0x${string}`;
  const WUSDC_PAIR  = "0xfb75dee2cf4fb4c4cdd3486fc28a4fd9d13a3a2a" as `0x${string}`;

  const { data } = useReadContracts({
    contracts: [
      { address: addresses.miner,   abi: minerAbi, functionName: "totalFlowed", chainId: tempo.id },
      { address: addresses.doge,    abi: erc20Abi, functionName: "totalSupply", chainId: tempo.id },
      // Mining pipeline
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "balanceOf",   args: [addresses.miner],            chainId: tempo.id },
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "balanceOf",   args: [addresses.liquidityManager], chainId: tempo.id },
      // LP pairs (USDC side)
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "balanceOf",   args: [addresses.pair],             chainId: tempo.id },
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "balanceOf",   args: [CDOGE_PAIR],                 chainId: tempo.id },
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "balanceOf",   args: [EURC_PAIR],                  chainId: tempo.id },
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "balanceOf",   args: [WUSDC_PAIR],                 chainId: tempo.id },
    ],
    allowFailure: true,
    query: { refetchInterval: 15_000 },
  });

  const totalFlowed = data?.[0]?.result as bigint | undefined;
  const totalMined  = data?.[1]?.result as bigint | undefined;
  const minerBal    = data?.[2]?.result as bigint | undefined;
  const lmBal       = data?.[3]?.result as bigint | undefined;
  const fdogePairBal = data?.[4]?.result as bigint | undefined;
  const cdogePairBal = data?.[5]?.result as bigint | undefined;
  const eurcPairBal  = data?.[6]?.result as bigint | undefined;
  const wusdcPairBal = data?.[7]?.result as bigint | undefined;

  const miningTvl = (minerBal !== undefined && lmBal !== undefined)
    ? minerBal + lmBal : undefined;
  const lpTvl = [fdogePairBal, cdogePairBal, eurcPairBal, wusdcPairBal]
    .reduce<bigint | undefined>((sum, v) => {
      if (v === undefined) return sum;
      return (sum ?? 0n) + v;
    }, undefined);
  const tvl = (miningTvl !== undefined || lpTvl !== undefined)
    ? (miningTvl ?? 0n) + (lpTvl ?? 0n) : undefined;

  useEffect(() => {
    if (!client) return;
    const c = client;
    let cancelled = false;
    async function loadMiners() {
      try {
        const head = await c.getBlockNumber();
        const SCAN_DEPTH = 500_000n;
        const RANGE      = 10_000n;
        const fromBase   = head > SCAN_DEPTH ? head - SCAN_DEPTH : 0n;
        const unique = new Set<string>();
        for (let f = fromBase; f <= head; f += RANGE + 1n) {
          if (cancelled) return;
          const t = f + RANGE > head ? head : f + RANGE;
          try {
            const chunk = await c.getLogs({
              address: addresses.miner,
              event: committedEvent,
              fromBlock: f,
              toBlock: t,
            });
            for (const l of chunk) {
              const u = l.args.user;
              if (u) unique.add(u.toLowerCase());
            }
          } catch {
            // skip rejected windows
          }
        }
        if (!cancelled) setMiners(unique.size);
      } catch {
        if (!cancelled) setMiners(null);
      }
    }
    loadMiners();
    const t = setInterval(loadMiners, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [client]);

  return (
    <section>
      <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80 mb-6">
        Protocol metrics
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line rounded-xl overflow-hidden">
        <StatTile
          label="Total TVL"
          value={tvl !== undefined ? fmt(tvl, PATHUSD_DECIMALS) : "-"}
          unit="USDC locked across protocol"
          emphasis
        />
        <StatTile
          label="Mining TVL"
          value={miningTvl !== undefined ? fmt(miningTvl, PATHUSD_DECIMALS) : "-"}
          unit="Miner + LiquidityManager"
        />
        <StatTile
          label="LP TVL"
          value={lpTvl !== undefined ? fmt(lpTvl, PATHUSD_DECIMALS) : "-"}
          unit="USDC across all pools"
        />
        <StatTile
          label="USDC Converted"
          value={totalFlowed !== undefined ? fmt(totalFlowed, PATHUSD_DECIMALS) : "-"}
          unit="cumulative flowed"
        />
        <StatTile
          label="fDOGE Mined"
          value={totalMined !== undefined ? fmt(totalMined, DOGE_DECIMALS) : "-"}
          unit="of 210,000,000"
        />
        <StatTile
          label="Active Miners"
          value={miners === null ? "-" : miners.toLocaleString()}
          unit={miners === 1 ? "wallet" : "wallets"}
        />
      </div>
    </section>
  );
}

function StatTile({
  label, value, unit, emphasis, dim,
}: { label: string; value: string; unit?: string; emphasis?: boolean; dim?: boolean }) {
  const valueClass = emphasis
    ? "text-3xl text-gold-300"
    : dim
      ? "text-xl text-ink-muted"
      : "text-2xl text-ink";
  return (
    <div className="p-6 bg-bg-surface">
      <div className="text-[11px] uppercase tracking-[0.22em] text-ink-faint">{label}</div>
      <div className={`mt-3 font-display tabular tracking-tight ${valueClass}`}>{value}</div>
      {unit && <div className="mt-0.5 text-xs text-ink-faint">{unit}</div>}
    </div>
  );
}

function fmt(v: bigint, decimals: number): string {
  const n = Number(formatUnits(v, decimals));
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(2) + "K";
  if (Math.abs(n) < 0.0001) return n.toFixed(6);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
