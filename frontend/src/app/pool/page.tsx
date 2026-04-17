"use client";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt,
  useReadContract, useReadContracts,
} from "wagmi";
import { formatUnits, parseUnits, maxUint256, type Address } from "viem";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { arc, addresses, USDC_DECIMALS, DOGE_DECIMALS } from "@/config/chain";
import { forgeRouterAbi, forgeFactoryAbi, pairAbi } from "@/lib/dexAbis";
import { erc20Abi } from "@/lib/abis";

// Curated pairs for the pool page. Same set as the trade page.
// In future you could read allPairs from the factory; for now a
// fixed list avoids an RPC round-trip and lets us attach metadata.
const POOLS: {
  name: string;
  tokenA: Address;
  tokenB: Address;
  symbolA: string;
  symbolB: string;
  decimalsA: number;
  decimalsB: number;
}[] = [
  {
    name: "fDOGE / USDC",
    tokenA: addresses.doge, tokenB: addresses.usdc,
    symbolA: "fDOGE", symbolB: "USDC",
    decimalsA: DOGE_DECIMALS, decimalsB: USDC_DECIMALS,
  },
];

const ROUTER = addresses.forgeRouter;
const FACTORY = addresses.factory;
const ZERO = 0n;
const SLIPPAGE_BPS = 100n; // 1%

// ============================================================
//                         PAGE
// ============================================================

export default function PoolPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const pub = usePublicClient({ chainId: arc.id });
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [tab, setTab] = useState<"add" | "remove">("add");

  const pool = POOLS[selectedIdx];

  // ---- Resolve pair address ----
  const { data: pairAddr } = useReadContract({
    address: FACTORY, abi: forgeFactoryAbi, functionName: "getPair",
    args: [pool.tokenA, pool.tokenB], chainId: arc.id,
  });
  const pair = pairAddr as Address | undefined;
  const hasPair = pair && pair !== "0x0000000000000000000000000000000000000000";

  // ---- Pool state reads (batched) ----
  const reads = useReadContracts({
    contracts: hasPair ? [
      { address: pair!, abi: pairAbi, functionName: "getReserves" },
      { address: pair!, abi: pairAbi, functionName: "totalSupply" },
      { address: pair!, abi: pairAbi, functionName: "token0" },
      { address: pair!, abi: pairAbi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] },
      { address: pool.tokenA, abi: erc20Abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] },
      { address: pool.tokenB, abi: erc20Abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] },
      { address: pool.tokenA, abi: erc20Abi, functionName: "allowance", args: [address ?? "0x0000000000000000000000000000000000000000", ROUTER] },
      { address: pool.tokenB, abi: erc20Abi, functionName: "allowance", args: [address ?? "0x0000000000000000000000000000000000000000", ROUTER] },
      { address: pair!, abi: erc20Abi, functionName: "allowance", args: [address ?? "0x0000000000000000000000000000000000000000", ROUTER] },
    ] : [],
    query: { enabled: !!hasPair, refetchInterval: 8_000 },
  });

  const r = reads.data;
  const reserves     = r?.[0]?.result as [bigint, bigint, number] | undefined;
  const totalLP      = (r?.[1]?.result as bigint | undefined) ?? ZERO;
  const token0       = (r?.[2]?.result as Address | undefined);
  const userLP       = (r?.[3]?.result as bigint | undefined) ?? ZERO;
  const balA         = (r?.[4]?.result as bigint | undefined) ?? ZERO;
  const balB         = (r?.[5]?.result as bigint | undefined) ?? ZERO;
  const allowA       = (r?.[6]?.result as bigint | undefined) ?? ZERO;
  const allowB       = (r?.[7]?.result as bigint | undefined) ?? ZERO;
  const lpAllowance  = (r?.[8]?.result as bigint | undefined) ?? ZERO;

  // Sort reserves to match tokenA/tokenB order (factory stores in sorted order).
  const isAToken0 = token0?.toLowerCase() === pool.tokenA.toLowerCase();
  const reserveA = reserves ? (isAToken0 ? reserves[0] : reserves[1]) : ZERO;
  const reserveB = reserves ? (isAToken0 ? reserves[1] : reserves[0]) : ZERO;

  // Pool share
  const sharePct = totalLP > 0n && userLP > 0n
    ? Number((userLP * 10000n) / totalLP) / 100
    : 0;

  // Pooled amounts for user
  const pooledA = totalLP > 0n ? (userLP * reserveA) / totalLP : ZERO;
  const pooledB = totalLP > 0n ? (userLP * reserveB) / totalLP : ZERO;

  const fmtA = (v: bigint) => formatUnits(v, pool.decimalsA);
  const fmtB = (v: bigint) => formatUnits(v, pool.decimalsB);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-display text-3xl sm:text-4xl tracking-tightest mb-1">Pool</h1>
      <p className="text-ink-muted text-sm mb-8">Provide liquidity to earn 0.30% on every swap.</p>

      {/* Pool selector (for now just one pair — extensible) */}
      {POOLS.length > 1 && (
        <div className="mb-6 flex gap-2">
          {POOLS.map((p, i) => (
            <button
              key={i}
              onClick={() => { setSelectedIdx(i); reads.refetch(); }}
              className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                i === selectedIdx
                  ? "border-gold-400/60 bg-gold-400/10 text-ink"
                  : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Pool overview card */}
      <div className="rounded-xl border border-line bg-bg-surface/40 p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="font-display text-xl">{pool.name}</h2>
            <div className="text-xs text-ink-faint mt-1">0.30% LP fee · UniV2</div>
          </div>
          {!isConnected ? (
            <button onClick={() => openConnectModal?.()} className="px-4 py-2 rounded-md bg-gold-400 text-bg-base text-sm font-medium hover:bg-gold-300">
              Connect wallet
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label={pool.symbolA + " reserve"} value={reserveA > 0n ? Number(fmtA(reserveA)).toLocaleString(undefined, {maximumFractionDigits: 2}) : "—"} />
          <Stat label={pool.symbolB + " reserve"} value={reserveB > 0n ? Number(fmtB(reserveB)).toLocaleString(undefined, {maximumFractionDigits: 2}) : "—"} />
          <Stat label="Your LP tokens" value={userLP > 0n ? Number(formatUnits(userLP, 18)).toLocaleString(undefined, {maximumFractionDigits: 6}) : "0"} />
          <Stat label="Your share" value={sharePct > 0 ? `${sharePct.toFixed(2)}%` : "—"} />
        </div>

        {userLP > 0n && (
          <div className="mt-3 pt-3 border-t border-line text-xs text-ink-muted">
            Pooled: {Number(fmtA(pooledA)).toLocaleString(undefined, {maximumFractionDigits: 4})} {pool.symbolA}
            {" + "}
            {Number(fmtB(pooledB)).toLocaleString(undefined, {maximumFractionDigits: 4})} {pool.symbolB}
          </div>
        )}
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 border border-line rounded-lg p-1 mb-6">
        {(["add", "remove"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t ? "bg-gold-400 text-bg-base" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t === "add" ? "Add Liquidity" : "Remove Liquidity"}
          </button>
        ))}
      </div>

      {/* Add / Remove panels */}
      {tab === "add" ? (
        <AddLiquidity
          pool={pool} pair={pair} hasPair={!!hasPair}
          reserveA={reserveA} reserveB={reserveB}
          balA={balA} balB={balB} allowA={allowA} allowB={allowB}
          isConnected={isConnected} address={address}
          refetch={() => reads.refetch()}
        />
      ) : (
        <RemoveLiquidity
          pool={pool} pair={pair} hasPair={!!hasPair}
          reserveA={reserveA} reserveB={reserveB} totalLP={totalLP}
          userLP={userLP} lpAllowance={lpAllowance}
          isConnected={isConnected} address={address}
          refetch={() => reads.refetch()}
        />
      )}
    </div>
  );
}

// ============================================================
//                      ADD LIQUIDITY
// ============================================================

type PoolMeta = typeof POOLS[number];

function AddLiquidity({
  pool, pair, hasPair, reserveA, reserveB, balA, balB, allowA, allowB,
  isConnected, address, refetch,
}: {
  pool: PoolMeta; pair: Address | undefined; hasPair: boolean;
  reserveA: bigint; reserveB: bigint;
  balA: bigint; balB: bigint; allowA: bigint; allowB: bigint;
  isConnected: boolean; address: Address | undefined;
  refetch: () => void;
}) {
  const [amtA, setAmtA] = useState("");
  const [amtB, setAmtB] = useState("");
  const [err, setErr]   = useState<string | null>(null);

  const parsedA = safeParseUnits(amtA, pool.decimalsA);
  const parsedB = safeParseUnits(amtB, pool.decimalsB);

  // Auto-quote the other side based on reserves
  const autoQuote = (which: "A" | "B", raw: string) => {
    if (which === "A") {
      setAmtA(raw);
      if (reserveA > 0n && reserveB > 0n && raw) {
        const a = safeParseUnits(raw, pool.decimalsA);
        if (a > 0n) {
          const b = (a * reserveB) / reserveA;
          setAmtB(formatUnits(b, pool.decimalsB));
        }
      } else { setAmtB(""); }
    } else {
      setAmtB(raw);
      if (reserveA > 0n && reserveB > 0n && raw) {
        const b = safeParseUnits(raw, pool.decimalsB);
        if (b > 0n) {
          const a = (b * reserveA) / reserveB;
          setAmtA(formatUnits(a, pool.decimalsA));
        }
      } else { setAmtA(""); }
    }
  };

  const needApproveA = parsedA > 0n && allowA < parsedA;
  const needApproveB = parsedB > 0n && allowB < parsedB;

  const { writeContractAsync, isPending } = useWriteContract();

  const approve = async (token: Address) => {
    setErr(null);
    try {
      await writeContractAsync({
        address: token, abi: erc20Abi, functionName: "approve",
        args: [ROUTER, maxUint256], chainId: arc.id,
      });
      setTimeout(refetch, 2000);
    } catch (e) { setErr(prettyErr(e)); }
  };

  const add = async () => {
    if (!address || parsedA === 0n || parsedB === 0n) return;
    setErr(null);
    const minA = parsedA - (parsedA * SLIPPAGE_BPS) / 10000n;
    const minB = parsedB - (parsedB * SLIPPAGE_BPS) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContractAsync({
        address: ROUTER, abi: forgeRouterAbi, functionName: "addLiquidity",
        args: [pool.tokenA, pool.tokenB, parsedA, parsedB, minA, minB, address, deadline],
        chainId: arc.id,
      });
      setAmtA(""); setAmtB("");
      setTimeout(refetch, 3000);
    } catch (e) { setErr(prettyErr(e)); }
  };

  const validInput = parsedA > 0n && parsedB > 0n;
  const hasBal     = parsedA <= balA && parsedB <= balB;

  return (
    <div className="rounded-xl border border-line bg-bg-surface/40 p-5 space-y-4">
      <TokenInput
        symbol={pool.symbolA}
        decimals={pool.decimalsA}
        balance={balA}
        value={amtA}
        onChange={(v) => autoQuote("A", v)}
        onMax={() => autoQuote("A", formatUnits(balA, pool.decimalsA))}
      />
      <div className="flex justify-center"><Plus /></div>
      <TokenInput
        symbol={pool.symbolB}
        decimals={pool.decimalsB}
        balance={balB}
        value={amtB}
        onChange={(v) => autoQuote("B", v)}
        onMax={() => autoQuote("B", formatUnits(balB, pool.decimalsB))}
      />

      {reserveA > 0n && reserveB > 0n && (
        <div className="text-xs text-ink-faint text-center">
          1 {pool.symbolA} = {(Number(reserveB) / Number(reserveA) * 10**(pool.decimalsA - pool.decimalsB)).toLocaleString(undefined, {maximumFractionDigits: 4})} {pool.symbolB}
        </div>
      )}

      {err && <div className="text-xs text-red-300">{err}</div>}

      <div className="space-y-2">
        {needApproveA && (
          <button onClick={() => approve(pool.tokenA)} disabled={isPending}
                  className="w-full py-3 rounded-md border border-line text-sm font-medium hover:border-gold-400/60 disabled:opacity-50">
            {isPending ? "Approving…" : `Approve ${pool.symbolA}`}
          </button>
        )}
        {needApproveB && (
          <button onClick={() => approve(pool.tokenB)} disabled={isPending}
                  className="w-full py-3 rounded-md border border-line text-sm font-medium hover:border-gold-400/60 disabled:opacity-50">
            {isPending ? "Approving…" : `Approve ${pool.symbolB}`}
          </button>
        )}
        <button
          onClick={add}
          disabled={!isConnected || !validInput || !hasBal || needApproveA || needApproveB || isPending}
          className="w-full py-3 rounded-md bg-gold-400 text-bg-base text-sm font-medium hover:bg-gold-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!isConnected ? "Connect wallet" :
           !validInput ? "Enter amounts" :
           !hasBal ? "Insufficient balance" :
           isPending ? "Adding…" : "Add Liquidity"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
//                    REMOVE LIQUIDITY
// ============================================================

function RemoveLiquidity({
  pool, pair, hasPair, reserveA, reserveB, totalLP, userLP, lpAllowance,
  isConnected, address, refetch,
}: {
  pool: PoolMeta; pair: Address | undefined; hasPair: boolean;
  reserveA: bigint; reserveB: bigint; totalLP: bigint;
  userLP: bigint; lpAllowance: bigint;
  isConnected: boolean; address: Address | undefined;
  refetch: () => void;
}) {
  const [pct, setPct] = useState(50);
  const [err, setErr] = useState<string | null>(null);

  const lpToRemove = userLP > 0n ? (userLP * BigInt(pct)) / 100n : ZERO;
  const estA = totalLP > 0n ? (lpToRemove * reserveA) / totalLP : ZERO;
  const estB = totalLP > 0n ? (lpToRemove * reserveB) / totalLP : ZERO;
  const needApproveLP = lpToRemove > 0n && lpAllowance < lpToRemove;

  const { writeContractAsync, isPending } = useWriteContract();

  const approveLP = async () => {
    if (!pair) return;
    setErr(null);
    try {
      await writeContractAsync({
        address: pair, abi: erc20Abi, functionName: "approve",
        args: [ROUTER, maxUint256], chainId: arc.id,
      });
      setTimeout(refetch, 2000);
    } catch (e) { setErr(prettyErr(e)); }
  };

  const remove = async () => {
    if (!address || !pair || lpToRemove === 0n) return;
    setErr(null);
    const minA = estA - (estA * SLIPPAGE_BPS) / 10000n;
    const minB = estB - (estB * SLIPPAGE_BPS) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContractAsync({
        address: ROUTER, abi: forgeRouterAbi, functionName: "removeLiquidity",
        args: [pool.tokenA, pool.tokenB, lpToRemove, minA, minB, address, deadline],
        chainId: arc.id,
      });
      setPct(50);
      setTimeout(refetch, 3000);
    } catch (e) { setErr(prettyErr(e)); }
  };

  const fmtA = (v: bigint) => Number(formatUnits(v, pool.decimalsA)).toLocaleString(undefined, {maximumFractionDigits: 6});
  const fmtB = (v: bigint) => Number(formatUnits(v, pool.decimalsB)).toLocaleString(undefined, {maximumFractionDigits: 6});

  return (
    <div className="rounded-xl border border-line bg-bg-surface/40 p-5 space-y-5">
      {userLP === 0n ? (
        <div className="text-center text-ink-muted text-sm py-8">
          You don&apos;t have any LP tokens in this pool.
        </div>
      ) : (
        <>
          {/* Percentage slider */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm text-ink-muted">Amount to remove</span>
              <span className="font-display text-3xl tabular text-ink">{pct}%</span>
            </div>
            <input
              type="range" min={1} max={100} value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="w-full accent-gold-400"
            />
            <div className="flex justify-between mt-2 gap-2">
              {[25, 50, 75, 100].map((v) => (
                <button
                  key={v}
                  onClick={() => setPct(v)}
                  className={`flex-1 py-1.5 rounded-md text-xs border transition-colors ${
                    pct === v
                      ? "border-gold-400/60 bg-gold-400/10 text-ink"
                      : "border-line text-ink-muted hover:text-ink"
                  }`}
                >
                  {v}%
                </button>
              ))}
            </div>
          </div>

          {/* Estimated output */}
          <div className="rounded-md border border-line bg-bg-base p-4 space-y-2">
            <div className="text-[11px] uppercase tracking-[0.25em] text-ink-faint mb-2">You will receive (estimated)</div>
            <div className="flex items-center justify-between">
              <span className="text-ink">{fmtA(estA)}</span>
              <span className="text-ink-muted text-sm">{pool.symbolA}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink">{fmtB(estB)}</span>
              <span className="text-ink-muted text-sm">{pool.symbolB}</span>
            </div>
          </div>

          {err && <div className="text-xs text-red-300">{err}</div>}

          <div className="space-y-2">
            {needApproveLP && (
              <button onClick={approveLP} disabled={isPending}
                      className="w-full py-3 rounded-md border border-line text-sm font-medium hover:border-gold-400/60 disabled:opacity-50">
                {isPending ? "Approving…" : "Approve LP tokens"}
              </button>
            )}
            <button
              onClick={remove}
              disabled={!isConnected || lpToRemove === 0n || needApproveLP || isPending}
              className="w-full py-3 rounded-md bg-gold-400 text-bg-base text-sm font-medium hover:bg-gold-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? "Removing…" : `Remove ${pct}%`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
//                      SMALL HELPERS
// ============================================================

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-bg-base p-3">
      <div className="text-[10px] uppercase tracking-[0.25em] text-ink-faint">{label}</div>
      <div className="mt-1 font-display tabular text-ink">{value}</div>
    </div>
  );
}

function TokenInput({
  symbol, decimals, balance, value, onChange, onMax,
}: {
  symbol: string; decimals: number; balance: bigint;
  value: string; onChange: (v: string) => void; onMax: () => void;
}) {
  return (
    <div className="rounded-md border border-line bg-bg-base p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-ink">{symbol}</span>
        <span className="text-xs text-ink-faint">
          Balance: {Number(formatUnits(balance, decimals)).toLocaleString(undefined, {maximumFractionDigits: 4})}
          <button onClick={onMax} className="ml-2 text-gold-300 hover:text-gold-200">Max</button>
        </span>
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.0"
        className="w-full bg-transparent text-2xl font-display tabular text-ink outline-none placeholder:text-ink-faint/40"
      />
    </div>
  );
}

function Plus() {
  return (
    <div className="h-8 w-8 rounded-full border border-line bg-bg-surface flex items-center justify-center text-ink-faint">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </div>
  );
}

function safeParseUnits(s: string, decimals: number): bigint {
  if (!s || s === "." || s === "0.") return ZERO;
  try { return parseUnits(s, decimals); } catch { return ZERO; }
}

function prettyErr(e: unknown): string {
  const msg = (e as { shortMessage?: string; message?: string }).shortMessage
    ?? (e as Error)?.message ?? "";
  if (msg.toLowerCase().includes("user rejected")) return "Transaction rejected.";
  if (msg.includes("InsufficientAAmount"))  return "Price moved — try a smaller amount or increase slippage.";
  if (msg.includes("InsufficientBAmount"))  return "Price moved — try a smaller amount or increase slippage.";
  if (msg.includes("InsufficientLiquidity"))return "Not enough liquidity in the pool.";
  return msg.slice(0, 120) || "Transaction failed.";
}
