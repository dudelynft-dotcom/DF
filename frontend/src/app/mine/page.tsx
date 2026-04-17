"use client";
import { useAccount, useConfig, useReadContract, useReadContracts } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { formatUnits, parseUnits } from "viem";
import { useEffect, useMemo, useState } from "react";
import { addresses, PATHUSD_DECIMALS, DOGE_DECIMALS, tempo } from "@/config/chain";
import { erc20Abi, minerAbi } from "@/lib/abis";
import { pairAbi } from "@/lib/dexAbis";
import { sendTx, ensureTempoChain, prettifyError } from "@/lib/tx";
import { useToast } from "@/components/Toaster";
import { useIdentity } from "@/lib/useIdentity";

const HARVEST_MODES = [
  { id: 0, name: "Instant",   boost: "1.00×", boostBps: 10_000, sub: "claim anytime",            lockLabel: "no wait" },
  { id: 1, name: "Monthly",   boost: "1.20×", boostBps: 12_000, sub: "rewards unlock in 30 days",  lockLabel: "30 days" },
  { id: 2, name: "Long-Term", boost: "1.50×", boostBps: 15_000, sub: "rewards unlock in 180 days", lockLabel: "180 days" },
] as const;

type Position = {
  remaining: bigint;
  totalDeposited: bigint;
  lastUpdate: bigint;
  unlockAt: bigint;
  mode: number;
  open: boolean;
  pendingDoge: bigint;
};

export default function MinePage() {
  const { address, chainId } = useAccount();
  const config = useConfig();
  const toast = useToast();
  const identity = useIdentity(address);
  const [switching, setSwitching] = useState(false);
  const onWrongChain = Boolean(address) && chainId !== tempo.id;

  const [amount, setAmount] = useState("");
  const [selectedMode, setSelectedMode] = useState<number>(0);
  const [txBusy, setTxBusy] = useState<null | "approve" | "commit" | "harvest" | "harvestAll">(null);

  async function switchToTempo() {
    setSwitching(true);
    try { await ensureTempoChain(config); }
    catch (e) { toast.push({ kind: "error", title: "Switch failed", body: prettifyError(e), ttl: 8000 }); }
    finally { setSwitching(false); }
  }

  const miner = { address: addresses.miner, abi: minerAbi, chainId: tempo.id } as const;
  const usd   = { address: addresses.usdc, abi: erc20Abi, chainId: tempo.id } as const;

  // Global reads
  const pair = { address: addresses.pair, abi: pairAbi, chainId: tempo.id } as const;
  const { data: globals, refetch: refetchGlobals } = useReadContracts({
    contracts: [
      { ...miner, functionName: "currentPhase" },
      { ...miner, functionName: "flowRateBpsPerDay" },
      { ...miner, functionName: "perWalletCap" },
      { ...miner, functionName: "maxPositionsPerWallet" },
      { ...miner, functionName: "minerScore",       args: address ? [address] : undefined },
      { ...miner, functionName: "pendingAll",       args: address ? [address] : undefined },
      { ...usd,   functionName: "balanceOf",        args: address ? [address] : undefined },
      { ...usd,   functionName: "allowance",        args: address ? [address, addresses.miner] : undefined },
      { ...usd,   functionName: "balanceOf",        args: [addresses.miner] },
      { ...usd,   functionName: "balanceOf",        args: [addresses.liquidityManager] },
      { ...usd,   functionName: "balanceOf",        args: [addresses.pair] },
      { ...pair,  functionName: "getReserves" },
      { ...pair,  functionName: "token0" },
    ],
    allowFailure: true,
    query: { refetchInterval: 5000 },
  });

  const phase        = globals?.[0]?.result as readonly [bigint, bigint] | undefined;
  const convRate     = globals?.[1]?.result as bigint | undefined;
  const cap          = globals?.[2]?.result as bigint | undefined;
  const maxPositions = globals?.[3]?.result as bigint | undefined;
  const score        = globals?.[4]?.result as bigint | undefined;
  const pendAll      = globals?.[5]?.result as readonly [bigint, bigint, bigint] | undefined;
  const bal          = globals?.[6]?.result as bigint | undefined;
  const allowance    = globals?.[7]?.result as bigint | undefined;
  const minerBal     = globals?.[8]?.result as bigint | undefined;
  const lmBal        = globals?.[9]?.result as bigint | undefined;
  const pairBal      = globals?.[10]?.result as bigint | undefined;
  const reserves     = globals?.[11]?.result as readonly [bigint, bigint, number] | undefined;
  const token0       = globals?.[12]?.result as `0x${string}` | undefined;

  // fDOGE price in USDC (computed from pair reserves).
  const fdogePrice = useMemo(() => {
    if (!reserves || !token0) return null;
    const isT0Doge = token0.toLowerCase() === addresses.doge.toLowerCase();
    const rDoge = isT0Doge ? reserves[0] : reserves[1];
    const rUsd  = isT0Doge ? reserves[1] : reserves[0];
    if (rDoge === 0n || rUsd === 0n) return null;
    // USDC-human / fDOGE-human. USDC 6-dec, fDOGE 18-dec.
    const usdH  = Number(formatUnits(rUsd, 6));
    const dogeH = Number(formatUnits(rDoge, 18));
    return dogeH > 0 ? usdH / dogeH : null;
  }, [reserves, token0]);

  /// Compute APR for 1 committed USDC under a given harvest-mode boost.
  ///   daily USDC flowed = commitment * flowRateBpsPerDay / 10000
  ///   daily fDOGE minted = daily USDC flowed * phaseRate_per_USDC_human * modeBoost
  ///   daily USD yield = daily fDOGE minted * fDOGE price
  ///   APR = daily yield * 365 * 100
  function aprForBoost(modeBps: number): number | null {
    if (fdogePrice === null || !phase || convRate === undefined) return null;
    const phaseRateHuman = Number(formatUnits(phase[1], DOGE_DECIMALS)); // fDOGE per 1 whole USDC
    const dailyFlowFrac  = Number(convRate) / 10_000;                    // e.g. 0.02 for 2%/day
    const boost          = modeBps / 10_000;
    const dailyfDOGE     = dailyFlowFrac * phaseRateHuman * boost;
    const dailyUSD       = dailyfDOGE * fdogePrice;
    return dailyUSD * 365 * 100;
  }
  const tvl = (minerBal !== undefined && lmBal !== undefined && pairBal !== undefined)
    ? minerBal + lmBal + pairBal
    : undefined;

  // Positions array (ticks every 2s so earnings feel live)
  const { data: posArr, refetch: refetchPositions } = useReadContract({
    ...miner,
    functionName: "getPositions",
    args: address ? [address] : undefined,
    query: { refetchInterval: 2000 },
  });
  const positions = (posArr as Position[] | undefined) ?? [];
  const openPositions = useMemo(
    () => positions.map((p, idx) => ({ ...p, id: idx })).filter((p) => p.open),
    [positions]
  );

  // Per-position pending preview (includes unrealised flow). Refreshes every 2s.
  const { data: pendingPerPos } = useReadContracts({
    contracts: openPositions.map((p) => ({
      ...miner,
      functionName: "pending" as const,
      args: [address!, BigInt(p.id)] as const,
    })),
    allowFailure: true,
    query: { enabled: !!address && openPositions.length > 0, refetchInterval: 2000 },
  });
  const previewById = new Map<number, bigint>();
  openPositions.forEach((p, i) => {
    const r = pendingPerPos?.[i]?.result as readonly [bigint, bigint, bigint] | undefined;
    if (r) previewById.set(p.id, r[1]);
  });

  const parsed = amount ? safeParse(amount) : 0n;
  const needsApproval = allowance !== undefined && parsed > 0n && parsed > allowance;
  const exceedsWallet = bal !== undefined && parsed > bal;
  const committedSum = openPositions.reduce((s, p) => s + p.totalDeposited, 0n);
  const exceedsCap = cap !== undefined && committedSum + parsed > cap;
  const reachedMaxPositions = maxPositions !== undefined && openPositions.length >= Number(maxPositions);
  const disableCommit = !address || !!txBusy || !parsed || exceedsWallet || exceedsCap || reachedMaxPositions;

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(i); }, []);

  const anyClaimable = openPositions.some((p) => {
    const live = previewById.get(p.id) ?? p.pendingDoge;
    return Number(p.unlockAt) <= now && live > 0n;
  });

  async function doTx(
    label: "approve" | "commit" | "harvest" | "harvestAll",
    params: Parameters<typeof sendTx>[1],
    pendingTitle: string,
  ) {
    const id = toast.push({ kind: "pending", title: pendingTitle, ttl: 0 });
    setTxBusy(label);
    try {
      const hash = await sendTx(config, params);
      toast.update(id, { body: "Submitted. Waiting for confirmation…", hash });
      const r = await waitForTransactionReceipt(config, { hash, chainId: tempo.id });
      if (r.status === "success") {
        toast.update(id, { kind: "success", title: pendingTitle.replace(/ing$/, "ed"), body: undefined, ttl: 6000 });
        refetchGlobals();
        refetchPositions();
      } else {
        toast.update(id, { kind: "error", title: "Transaction reverted", body: "Chain rejected the transaction.", ttl: 8000 });
      }
    } catch (e) {
      toast.update(id, { kind: "error", title: "Transaction failed", body: prettifyError(e), ttl: 8000 });
    } finally {
      setTxBusy(null);
    }
  }

  return (
    <div className="space-y-12">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80">Mining</p>
        <h1 className="font-display text-5xl tracking-tightest mt-3">Start a mining position</h1>
        <p className="text-ink-muted mt-3 max-w-xl">
          Run multiple positions in parallel. Each commit becomes its own position
          with its own Harvest Mode and unlock timer.
        </p>
        {identity && (
          <p className="mt-4 text-sm text-ink-muted">
            Mining as <span className="font-display text-gold-300">{identity}</span>
          </p>
        )}
      </div>

      {onWrongChain && (
        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-red-500/40 bg-red-500/5">
          <div>
            <div className="text-sm font-medium text-red-300">Your wallet is on the wrong network</div>
            <div className="text-xs text-red-200/70 mt-0.5">
              DOGE FORGE runs on Arc Testnet (chain {tempo.id}). Switch to submit transactions.
            </div>
          </div>
          <button
            onClick={switchToTempo} disabled={switching}
            className="px-4 py-2 rounded-md bg-gold-400 text-bg-base text-sm font-medium hover:bg-gold-300 transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            {switching ? "Switching…" : "Switch to Arc"}
          </button>
        </div>
      )}

      {/* Protocol-wide */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line rounded-xl overflow-hidden">
        <Stat label="TVL"               value={tvl !== undefined ? fmtUsd(tvl) : "-"} unit="USDC locked across protocol" emphasis />
        <Stat label="Current Phase"     value={phase ? toRoman(Number(phase[0]) + 1) : "-"} />
        <Stat label="Phase Rate"        value={phase ? fmtDoge(phase[1]) : "-"} unit="fDOGE / USDC" />
        <Stat label="Conversion Rate"   value={convRate ? `${(Number(convRate) / 100).toFixed(2)}%` : "-"} unit="per day" />
      </section>

      {/* Your wallet */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line rounded-xl overflow-hidden">
        <Stat label="Open Positions"    value={`${openPositions.length}${maxPositions ? ` / ${maxPositions}` : ""}`} unit="per wallet" />
        <Stat label="Committed"         value={cap ? `${fmtUsd(committedSum)} / ${fmtUsd(cap)}` : "-"} unit="USDC active" />
        <Stat label="Your Score"        value={score !== undefined ? fmtScore(score) : "-"} unit="miner points" />
      </section>

      {/* Commit form */}
      <section className="rounded-xl border border-line bg-bg-surface p-6 md:p-8">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-ink-faint">New position</p>
            <h2 className="font-display text-2xl tracking-tight mt-1">Open a position</h2>
          </div>
          <div className="text-sm text-ink-muted tabular">
            Wallet: {bal !== undefined ? `${fmtUsd(bal)} USDC` : "-"}
          </div>
        </div>

        <div className="mt-5 grid md:grid-cols-3 gap-3">
          {HARVEST_MODES.map((m) => {
            const active = selectedMode === m.id;
            const apr = aprForBoost(m.boostBps);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedMode(m.id)}
                className={`text-left rounded-xl p-4 border transition-colors ${
                  active ? "border-gold-400 bg-gold-400/10" : "border-line bg-bg-base hover:border-gold-400/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-lg text-ink">{m.name}</span>
                  <span className={`font-display text-xl tabular ${active ? "text-gold-300" : "text-ink"}`}>{m.boost}</span>
                </div>
                <div className="mt-1 text-xs text-ink-muted">{m.sub}</div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">{m.lockLabel}</span>
                  <span className={`text-[11px] tabular ${active ? "text-gold-300" : "text-ink-muted"}`}>
                    {apr !== null ? `${fmtApr(apr)} APR` : "— APR"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-ink-faint">Amount (USDC)</span>
            <span className="text-xs text-ink-faint">
              Balance: <span className="text-ink tabular">{bal !== undefined ? fmtUsd(bal) : "-"}</span>
              {bal !== undefined && bal > 0n && (
                <button
                  onClick={() => setAmount(fmtUsd(bal))}
                  className="ml-2 text-gold-300 hover:text-gold-200"
                >
                  Max
                </button>
              )}
            </span>
          </div>
          <div className="flex items-stretch gap-3">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className="flex-1 px-4 py-3 rounded-md bg-bg-base border border-line outline-none text-lg tabular focus:border-gold-400/70 transition-colors"
          />
          {needsApproval ? (
            <button
              disabled={disableCommit}
              onClick={() => doTx("approve",
                { address: addresses.usdc, abi: erc20Abi, functionName: "approve", args: [addresses.miner, parsed] },
                `Approving ${amount} USDC`
              )}
              className="px-6 rounded-md border border-gold-400/60 text-ink hover:bg-gold-400/10 transition-colors disabled:opacity-40"
            >
              {txBusy === "approve" ? "Approving…" : `Approve ${amount || "0"}`}
            </button>
          ) : (
            <button
              disabled={disableCommit}
              onClick={() => doTx("commit",
                { address: addresses.miner, abi: minerAbi, functionName: "commit", args: [parsed, selectedMode] },
                `Opening ${HARVEST_MODES[selectedMode].name} position`
              )}
              className="px-6 rounded-md bg-gold-400 text-bg-base font-medium hover:bg-gold-300 transition-colors disabled:opacity-40"
            >
              {txBusy === "commit" ? "Opening…" : `Open · ${HARVEST_MODES[selectedMode].boost}`}
            </button>
          )}
        </div>
        </div>

        {exceedsWallet && amount && (
          <p className="mt-3 text-xs text-red-300">Amount exceeds your wallet balance.</p>
        )}
        {exceedsCap && amount && !exceedsWallet && (
          <p className="mt-3 text-xs text-red-300">
            Would exceed per-wallet cap ({fmtUsd(cap!)} USDC total across open positions).
          </p>
        )}
        {reachedMaxPositions && (
          <p className="mt-3 text-xs text-red-300">
            You have the maximum number of open positions. Close one to open another.
          </p>
        )}

        {amount && parsed > 0n && !exceedsWallet && !exceedsCap && (() => {
          const selectedApr = aprForBoost(HARVEST_MODES[selectedMode].boostBps);
          if (selectedApr === null || selectedApr <= 0) return null;
          const amountNum = Number(amount);
          if (!Number.isFinite(amountNum) || amountNum <= 0) return null;
          const annualYield = amountNum * (selectedApr / 100);
          const breakevenDays = 365 * (100 / selectedApr);
          const dailyFdoge = fdogePrice !== null && fdogePrice > 0
            ? (annualYield / 365) / fdogePrice
            : null;
          return (
            <div className="mt-4 rounded-lg border border-gold-400/30 bg-gold-400/5 px-4 py-3 text-xs leading-relaxed">
              <div className="text-gold-300 font-medium">Projection at current phase rate</div>
              <div className="mt-1 text-ink-muted tabular">
                {dailyFdoge !== null && <>~{dailyFdoge.toFixed(2)} fDOGE/day · </>}
                ~${annualYield.toFixed(2)} / yr · breakeven in {fmtDays(breakevenDays)}
              </div>
              <div className="mt-0.5 text-ink-faint text-[10px]">
                Before commitment-tier boost and adaptive multiplier. Phase rate changes as supply crosses thresholds.
              </div>
            </div>
          );
        })()}

        <p className="mt-4 text-xs text-ink-faint leading-relaxed max-w-2xl">
          Commitment tiers (by position size): {"<"}100 USDC = 1.00×. 100 to 999 = 1.10×. 1,000 to 4,999 = 1.25×. 5,000 and above = 1.50×.
          Harvest Mode compounds on top. Each position runs independently.
        </p>
      </section>

      {/* Real-time earning hero */}
      {openPositions.length > 0 && (
        <section className="rounded-2xl border border-gold-400/40 bg-gradient-to-br from-gold-400/10 via-bg-surface to-bg-surface p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-gold-400 shadow-[0_0_12px_rgba(201,163,74,0.9)] animate-pulse" />
                <p className="text-[11px] uppercase tracking-[0.28em] text-gold-400/90">Total accruing</p>
              </div>
              <div className="mt-3 font-display text-5xl md:text-6xl tracking-tightest text-gold-200 tabular">
                {pendAll ? fmtDoge(pendAll[2]) : "0"}
              </div>
              <div className="mt-1 text-sm text-ink-muted">
                fDOGE across {openPositions.length} active position{openPositions.length === 1 ? "" : "s"}
              </div>
            </div>
            <button
              disabled={!address || !!txBusy || !anyClaimable}
              onClick={() => doTx("harvestAll",
                { address: addresses.miner, abi: minerAbi, functionName: "harvestAll" },
                "Claiming all unlocked"
              )}
              className="px-5 py-3 rounded-md bg-gold-400 text-bg-base text-sm font-semibold hover:bg-gold-300 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {txBusy === "harvestAll" ? "Claiming…" : "Claim all unlocked"}
            </button>
          </div>
        </section>
      )}

      {/* Positions list */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-ink-faint">Your positions</p>
            <h2 className="font-display text-2xl tracking-tight mt-1">Portfolio</h2>
          </div>
        </div>

        {openPositions.length === 0 ? (
          <div className="rounded-xl border border-line bg-bg-surface p-10 text-center">
            <p className="text-ink-muted">No open positions yet. Commit above to start mining.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {openPositions.map((p) => (
              <PositionCard
                key={p.id}
                p={p}
                now={now}
                livePending={previewById.get(p.id) ?? p.pendingDoge}
                busy={txBusy === "harvest"}
                onHarvest={() => doTx("harvest",
                  { address: addresses.miner, abi: minerAbi, functionName: "harvest", args: [BigInt(p.id)] },
                  `Claiming position #${p.id}`
                )}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PositionCard({
  p, now, livePending, busy, onHarvest,
}: {
  p: Position & { id: number };
  now: number;
  livePending: bigint;
  busy: boolean;
  onHarvest: () => void;
}) {
  const unlockAt = Number(p.unlockAt);
  const secs = Math.max(0, unlockAt - now);
  const unlocked = secs === 0;
  const mode = HARVEST_MODES[p.mode] ?? HARVEST_MODES[0];
  const canClaim = unlocked && livePending > 0n;

  return (
    <div className="rounded-xl border border-line bg-bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">#{p.id}</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] uppercase tracking-wider ${
            mode.id === 0 ? "bg-white/5 text-ink-muted"
              : mode.id === 1 ? "bg-gold-400/15 text-gold-300"
              : "bg-gold-400/25 text-gold-200"
          }`}>{mode.name} · {mode.boost}</span>
          {unlocked ? (
            <span className="text-[11px] text-emerald-300">Unlocked</span>
          ) : (
            <span className="text-[11px] text-ink-faint tabular">unlocks in {fmtDuration(secs)}</span>
          )}
        </div>
        <button
          disabled={busy || !canClaim}
          onClick={onHarvest}
          className="px-4 py-1.5 rounded-md bg-gold-400 text-bg-base text-sm font-medium hover:bg-gold-300 transition-colors disabled:opacity-40"
        >
          {unlocked ? (livePending === 0n ? "Nothing to claim" : "Claim") : "Locked"}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">Committed</div>
          <div className="mt-1 font-display tabular text-ink">{fmtUsd(p.totalDeposited)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">Remaining</div>
          <div className="mt-1 font-display tabular text-ink">{fmtUsd(p.remaining)}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-gold-400 animate-pulse" />
            <div className="text-[10px] uppercase tracking-[0.2em] text-gold-400/90">Earning</div>
          </div>
          <div className="mt-1 font-display tabular text-gold-300 text-base">{fmtDoge(livePending)}</div>
          <div className="text-[10px] text-ink-faint">fDOGE</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">Unlock date</div>
          <div className="mt-1 font-display tabular text-ink">
            {unlockAt > 0 ? new Date(unlockAt * 1000).toLocaleDateString() : "-"}
          </div>
        </div>
      </div>

      {/* Conversion progress — portion of original USDC that has flowed out. */}
      {p.totalDeposited > 0n && (() => {
        const flowed = p.totalDeposited - p.remaining;
        const pct = Number((flowed * 10_000n) / p.totalDeposited) / 100;
        return (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-ink-faint">
              <span>Converted</span>
              <span className="tabular normal-case text-ink-muted">
                {fmtUsd(flowed)} / {fmtUsd(p.totalDeposited)} USDC · {pct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-bg-base overflow-hidden">
              <div
                className="h-full bg-gold-400 transition-[width] duration-500"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Stat({
  label, value, unit, emphasis,
}: { label: string; value: string; unit?: string; emphasis?: boolean }) {
  return (
    <div className="p-5 bg-bg-surface">
      <div className="text-[11px] uppercase tracking-[0.22em] text-ink-faint">{label}</div>
      <div className={`mt-2 font-display tracking-tight tabular ${emphasis ? "text-2xl text-gold-300" : "text-xl text-ink"}`}>
        {value}
      </div>
      {unit && <div className="mt-0.5 text-[11px] text-ink-faint">{unit}</div>}
    </div>
  );
}

function fmtUsd(v: bigint): string { return fmtNumber(Number(formatUnits(v, PATHUSD_DECIMALS))); }
function fmtDoge(v: bigint): string { return fmtNumber(Number(formatUnits(v, DOGE_DECIMALS))); }
function fmtScore(v: bigint): string { return fmtNumber(Number(formatUnits(v, PATHUSD_DECIMALS))); }
function fmtNumber(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(2) + "K";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
function fmtApr(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  if (Math.abs(pct) >= 1_000_000) return `${(pct / 1_000_000).toFixed(1)}M%`;
  if (Math.abs(pct) >= 1_000)     return `${(pct / 1_000).toFixed(1)}K%`;
  if (Math.abs(pct) >= 10)        return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(2)}%`;
}
function fmtDays(d: number): string {
  if (!Number.isFinite(d) || d <= 0) return "—";
  if (d < 1)    return `${Math.round(d * 24)}h`;
  if (d < 365)  return `${d.toFixed(1)}d`;
  return `${(d / 365).toFixed(1)}y`;
}
function fmtDuration(secs: number): string {
  secs = Math.max(0, Math.floor(secs));
  if (secs >= 86400) return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
  if (secs >= 3600)  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  if (secs >= 60)    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${secs}s`;
}
function toRoman(n: number): string {
  const map: [number, string][] = [[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
function safeParse(v: string): bigint {
  try { return parseUnits(v, PATHUSD_DECIMALS); } catch { return 0n; }
}
