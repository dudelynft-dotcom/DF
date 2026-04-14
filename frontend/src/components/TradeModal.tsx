"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { formatUnits, parseUnits } from "viem";
import { addresses, tempo } from "@/config/chain";
import { CURATED_TOKENS } from "@/config/tokens";
import { erc20Abi } from "@/lib/abis";
import { routerAbi, stablecoinDexAbi } from "@/lib/dexAbis";
import { sendTx, prettifyError } from "@/lib/tx";
import { useToast } from "./Toaster";

export type TradeToken = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
};

type Route = "tdoge-amm" | "stablecoin-dex" | "none";

function routeFor(a: string, b: string): Route {
  const doge = addresses.doge.toLowerCase();
  if (a.toLowerCase() === doge || b.toLowerCase() === doge) return "tdoge-amm";
  const stableSet = new Set(
    CURATED_TOKENS.filter((t) => t.kind !== "project").map((t) => t.address.toLowerCase())
  );
  if (stableSet.has(a.toLowerCase()) && stableSet.has(b.toLowerCase())) return "stablecoin-dex";
  return "none";
}

export function TradeModal({
  open, onClose, token,
}: {
  open: boolean;
  onClose: () => void;
  token: TradeToken | null;
}) {
  const { address } = useAccount();
  const config = useConfig();
  const toast = useToast();

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [busy, setBusy] = useState<null | "approve" | "swap">(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setAmount("");
      setSide("buy");
    }
  }, [open]);

  const quote = CURATED_TOKENS.find((t) => t.kind === "native-stable") ?? CURATED_TOKENS[0]; // USDC

  const from = side === "buy" ? { address: quote.address, symbol: quote.symbol, decimals: quote.decimals } : token;
  const to   = side === "buy" ? token : { address: quote.address, symbol: quote.symbol, decimals: quote.decimals };

  const route = token ? routeFor(token.address, quote.address) : "none";
  const parsedIn = from && amount ? safeParse(amount, from.decimals) : 0n;

  const spender =
    route === "tdoge-amm"     ? addresses.router :
    route === "stablecoin-dex"? addresses.stablecoinDex :
    undefined;

  // Balances + allowance on the "from" token
  const { data: fromBal } = useReadContract({
    address: from?.address, abi: erc20Abi, functionName: "balanceOf",
    args: address && from ? [address] : undefined,
    chainId: tempo.id,
    query: { enabled: open && !!address && !!from, refetchInterval: 5000 },
  });
  const { data: allowance } = useReadContract({
    address: from?.address, abi: erc20Abi, functionName: "allowance",
    args: address && from && spender ? [address, spender] : undefined,
    chainId: tempo.id,
    query: { enabled: open && !!address && !!from && !!spender, refetchInterval: 5000 },
  });
  const needsApproval = (allowance as bigint | undefined) !== undefined
    && parsedIn > (allowance as bigint);

  // Route-specific quote
  const { data: ammQuote } = useReadContract({
    address: addresses.router, abi: routerAbi, functionName: "quote",
    args: from ? [from.address, parsedIn] : undefined,
    chainId: tempo.id,
    query: { enabled: open && route === "tdoge-amm" && parsedIn > 0n, refetchInterval: 4000 },
  });
  const { data: dexQuote } = useReadContract({
    address: addresses.stablecoinDex, abi: stablecoinDexAbi, functionName: "quoteSwapExactAmountIn",
    args: from && to ? [from.address, to.address, parsedIn] : undefined,
    chainId: tempo.id,
    query: { enabled: open && route === "stablecoin-dex" && parsedIn > 0n, refetchInterval: 4000 },
  });
  const quoteOut = useMemo(() => {
    if (route === "tdoge-amm")      return ammQuote as bigint | undefined;
    if (route === "stablecoin-dex") return dexQuote as bigint | undefined;
    return undefined;
  }, [route, ammQuote, dexQuote]);

  const minOut = quoteOut ? quoteOut - (quoteOut * BigInt(slippageBps)) / 10_000n : 0n;
  const fb = fromBal as bigint | undefined;
  const exceedsWallet = fb !== undefined && parsedIn > fb;

  if (!open || !token) return null;

  async function doTx(
    label: "approve" | "swap",
    params: Parameters<typeof sendTx>[1],
    pendingTitle: string,
  ) {
    const id = toast.push({ kind: "pending", title: pendingTitle, ttl: 0 });
    setBusy(label);
    try {
      const hash = await sendTx(config, params);
      toast.update(id, { body: "Submitted. Waiting for confirmation.", hash });
      const r = await waitForTransactionReceipt(config, { hash, chainId: tempo.id });
      if (r.status === "success") {
        toast.update(id, { kind: "success", title: pendingTitle.replace(/ing$/, "ed"), body: undefined, ttl: 6000 });
      } else {
        toast.update(id, { kind: "error", title: "Transaction reverted", body: "Chain rejected the transaction.", ttl: 8000 });
      }
    } catch (e) {
      toast.update(id, { kind: "error", title: "Transaction failed", body: prettifyError(e), ttl: 8000 });
    } finally {
      setBusy(null);
    }
  }

  function onSwap() {
    if (!address || !from || !to || !parsedIn || !token) return;
    if (route === "tdoge-amm") {
      doTx("swap",
        { address: addresses.router, abi: routerAbi, functionName: "swapExactIn",
          args: [from.address, parsedIn, minOut, address, BigInt(Math.floor(Date.now()/1000) + 300)],
        },
        `${side === "buy" ? "Buying" : "Selling"} ${token.symbol}`,
      );
    } else if (route === "stablecoin-dex") {
      doTx("swap",
        { address: addresses.stablecoinDex, abi: stablecoinDexAbi, functionName: "swapExactAmountIn",
          args: [from.address, to.address, parsedIn, minOut],
        },
        `Swapping ${from.symbol} for ${to.symbol}`,
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-[tmFade_0.14s_ease-out]"
      onClick={onClose}
    >
      <div
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-line bg-bg-surface shadow-2xl overflow-hidden animate-[tmPop_0.18s_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-line">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-gold-400/90">Trade</p>
            <h2 className="mt-1 font-display text-2xl tracking-tight">
              {token.symbol} <span className="text-ink-faint text-base">/ {quote.symbol}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-md text-ink-faint hover:text-ink hover:bg-white/5 transition-colors flex items-center justify-center"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="px-6 pt-5">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-bg-base border border-line">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`py-2 rounded-md text-sm font-medium transition-colors ${
                  side === s
                    ? s === "buy" ? "bg-gold-400 text-bg-base" : "bg-white/10 text-ink"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {s === "buy" ? `Buy ${token.symbol}` : `Sell ${token.symbol}`}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 pt-5">
          <label className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">
            {from?.symbol} to spend
          </label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className="mt-1 w-full px-4 py-3 rounded-md bg-bg-base border border-line outline-none text-lg tabular focus:border-gold-400/70 transition-colors"
          />
          <div className="mt-2 text-[11px] text-ink-faint tabular flex items-center justify-between">
            <span>
              Balance:{" "}
              <span className="text-ink">
                {fb !== undefined && from ? formatUnits(fb, from.decimals) : "-"}
              </span>{" "}
              {from?.symbol}
            </span>
            {fb !== undefined && fb > 0n && from && (
              <button
                onClick={() => setAmount(formatUnits(fb, from.decimals))}
                className="text-gold-300 hover:text-gold-200 transition-colors"
              >
                Use max
              </button>
            )}
          </div>
        </div>

        <div className="mx-6 mt-5 rounded-lg border border-line bg-bg-base p-3 space-y-2 text-xs">
          <Row label="Route">
            <span className="text-ink-muted">
              {route === "tdoge-amm" ? "DOGE FORGE AMM"
                : route === "stablecoin-dex" ? "External DEX"
                : "No route"}
            </span>
          </Row>
          <Row label="You receive (est.)">
            <span className="text-ink tabular">
              {quoteOut !== undefined && to ? formatUnits(quoteOut, to.decimals) : "-"} {to?.symbol}
            </span>
          </Row>
          <Row label="Minimum received">
            <span className="text-ink-muted tabular">
              {quoteOut && to ? formatUnits(minOut, to.decimals) : "-"} {to?.symbol}
            </span>
          </Row>
          <Row label="Slippage">
            <select
              value={slippageBps}
              onChange={(e) => setSlippageBps(Number(e.target.value))}
              className="bg-bg-base border border-line rounded px-1.5 py-0.5 text-ink text-xs"
            >
              <option value={50}>0.5%</option>
              <option value={100}>1.0%</option>
              <option value={300}>3.0%</option>
              <option value={500}>5.0%</option>
            </select>
          </Row>
        </div>

        <div className="px-6 pt-5 pb-5">
          {route === "none" ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-[11px] text-red-300 leading-relaxed">
              No trading route available for this pair. fDOGE trades against USDC in the
              DOGE FORGE AMM. Other tokens need an external DEX.
            </div>
          ) : needsApproval ? (
            <button
              disabled={!address || !!busy || !parsedIn || exceedsWallet}
              onClick={() => from && spender && doTx("approve",
                { address: from.address, abi: erc20Abi, functionName: "approve", args: [spender, parsedIn] },
                `Approving ${amount} ${from.symbol}`,
              )}
              className="w-full px-4 py-3 rounded-md border border-gold-400/60 text-ink font-medium hover:bg-gold-400/10 transition-colors disabled:opacity-40"
            >
              {busy === "approve" ? "Approving..." : `Approve ${from?.symbol}`}
            </button>
          ) : (
            <button
              disabled={!address || !!busy || !parsedIn || exceedsWallet || quoteOut === undefined || quoteOut === 0n}
              onClick={onSwap}
              className="w-full px-4 py-3 rounded-md bg-gold-400 text-bg-base font-semibold hover:bg-gold-300 transition-colors disabled:opacity-40"
            >
              {busy === "swap"
                ? "Swapping..."
                : exceedsWallet
                  ? "Insufficient balance"
                  : side === "buy" ? `Buy ${token.symbol}` : `Sell ${token.symbol}`}
            </button>
          )}
          <p className="mt-3 text-[10px] text-ink-faint text-center">
            Trades settle on Arc. DOGE FORGE does not custody your swap.
          </p>
        </div>
      </div>

      <style jsx global>{`
        @keyframes tmFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes tmPop  { from { opacity: 0; transform: translateY(8px) scale(0.98) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-faint">{label}</span>
      {children}
    </div>
  );
}

function safeParse(v: string, decimals: number): bigint {
  try { return parseUnits(v, decimals); } catch { return 0n; }
}
