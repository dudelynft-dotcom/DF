"use client";
import { useMemo, useState } from "react";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { formatUnits, parseUnits } from "viem";
import { addresses, tempo } from "@/config/chain";
import { CURATED_TOKENS } from "@/config/tokens";
import { erc20Abi } from "@/lib/abis";
import { routerAbi, unitflowFactoryAbi, unitflowRouterAbi, aggregatorAbi } from "@/lib/dexAbis";
import { sendTx, prettifyError } from "@/lib/tx";
import { useToast } from "./Toaster";

const ZERO = "0x0000000000000000000000000000000000000000";
const HAS_AGGREGATOR = addresses.aggregator && addresses.aggregator.toLowerCase() !== ZERO;

export type SwapToken = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
};

type Route = "tdoge-amm" | "unitflow" | "none";

/// fDOGE always routes through our own AMM; any other non-USDC token goes
/// through UnitFlow (via our aggregator if deployed). USDC itself can't be
/// traded against itself, so the route is "none".
function routeFor(tokenAddr: string): Route {
  const doge = addresses.doge.toLowerCase();
  const usdc = addresses.usdc.toLowerCase();
  const t = tokenAddr.toLowerCase();
  if (t === doge) return "tdoge-amm";
  if (t === usdc) return "none";
  return "unitflow";
}

/// Full swap form. Self-contained — manages its own amount, side, slippage,
/// approvals, and quote polling. Used both inline in Pro view and inside
/// the legacy TradeModal.
export function SwapForm({
  token,
  enabled = true,
  className = "",
}: {
  token: SwapToken;
  /// If false, all hooks are disabled (e.g. when a parent modal is closed).
  enabled?: boolean;
  className?: string;
}) {
  const { address } = useAccount();
  const config = useConfig();
  const toast = useToast();

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [busy, setBusy] = useState<null | "approve" | "swap">(null);

  const quote = CURATED_TOKENS.find((t) => t.kind === "native-stable") ?? CURATED_TOKENS[0];
  const from  = side === "buy" ? { address: quote.address, symbol: quote.symbol, decimals: quote.decimals } : token;
  const to    = side === "buy" ? token : { address: quote.address, symbol: quote.symbol, decimals: quote.decimals };

  const route = routeFor(token.address);
  const parsedIn = amount ? safeParse(amount, from.decimals) : 0n;

  // Confirm UnitFlow pair exists before enabling the unitflow route.
  const { data: unitflowPairAddr } = useReadContract({
    address: addresses.unitflowFactory, abi: unitflowFactoryAbi, functionName: "getPair",
    args: route === "unitflow" ? [token.address, addresses.usdc] : undefined,
    chainId: tempo.id,
    query: { enabled: enabled && route === "unitflow", refetchInterval: 30_000 },
  });
  const hasUnitflowPair = (unitflowPairAddr as `0x${string}` | undefined)
    && (unitflowPairAddr as string).toLowerCase() !== ZERO;
  const effectiveRoute: Route = route === "unitflow" && !hasUnitflowPair ? "none" : route;

  const spender =
    effectiveRoute === "tdoge-amm" ? addresses.router :
    effectiveRoute === "unitflow"  ? (HAS_AGGREGATOR ? addresses.aggregator : addresses.unitflowRouter) :
    undefined;

  const { data: fromBal } = useReadContract({
    address: from.address, abi: erc20Abi, functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: tempo.id,
    query: { enabled: enabled && !!address, refetchInterval: 5000 },
  });
  const { data: allowance } = useReadContract({
    address: from.address, abi: erc20Abi, functionName: "allowance",
    args: address && spender ? [address, spender] : undefined,
    chainId: tempo.id,
    query: { enabled: enabled && !!address && !!spender, refetchInterval: 5000 },
  });
  const needsApproval = (allowance as bigint | undefined) !== undefined
    && parsedIn > (allowance as bigint);

  const { data: ammQuote } = useReadContract({
    address: addresses.router, abi: routerAbi, functionName: "quote",
    args: [from.address, parsedIn],
    chainId: tempo.id,
    query: { enabled: enabled && effectiveRoute === "tdoge-amm" && parsedIn > 0n, refetchInterval: 4000 },
  });
  const { data: unitflowQuote } = useReadContract({
    address: HAS_AGGREGATOR ? addresses.aggregator : addresses.unitflowRouter,
    abi: HAS_AGGREGATOR ? aggregatorAbi : unitflowRouterAbi,
    functionName: HAS_AGGREGATOR ? "getAmountsOutAfterFee" : "getAmountsOut",
    args: [parsedIn, [from.address, to.address] as const],
    chainId: tempo.id,
    query: { enabled: enabled && effectiveRoute === "unitflow" && parsedIn > 0n, refetchInterval: 4000 },
  });

  const quoteOut = useMemo(() => {
    if (effectiveRoute === "tdoge-amm") return ammQuote as bigint | undefined;
    if (effectiveRoute === "unitflow") {
      const arr = unitflowQuote as readonly bigint[] | undefined;
      return arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
    }
    return undefined;
  }, [effectiveRoute, ammQuote, unitflowQuote]);

  const minOut = quoteOut ? quoteOut - (quoteOut * BigInt(slippageBps)) / 10_000n : 0n;
  const fb = fromBal as bigint | undefined;
  const exceedsWallet = fb !== undefined && parsedIn > fb;

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
    if (!address || !parsedIn) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    if (effectiveRoute === "tdoge-amm") {
      doTx("swap",
        { address: addresses.router, abi: routerAbi, functionName: "swapExactIn",
          args: [from.address, parsedIn, minOut, address, deadline] },
        `${side === "buy" ? "Buying" : "Selling"} ${token.symbol}`,
      );
    } else if (effectiveRoute === "unitflow") {
      doTx("swap",
        HAS_AGGREGATOR
          ? { address: addresses.aggregator, abi: aggregatorAbi, functionName: "swapExactTokensForTokens",
              args: [parsedIn, minOut, [from.address, to.address] as const, address, deadline] }
          : { address: addresses.unitflowRouter, abi: unitflowRouterAbi, functionName: "swapExactTokensForTokens",
              args: [parsedIn, minOut, [from.address, to.address] as const, address, deadline] },
        `${side === "buy" ? "Buying" : "Selling"} ${token.symbol}`,
      );
    }
  }

  return (
    <div className={className}>
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

      <div className="mt-4">
        <label className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">
          {from.symbol} to spend
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
              {fb !== undefined ? formatUnits(fb, from.decimals) : "-"}
            </span>{" "}
            {from.symbol}
          </span>
          {fb !== undefined && fb > 0n && (
            <button
              onClick={() => setAmount(formatUnits(fb, from.decimals))}
              className="text-gold-300 hover:text-gold-200 transition-colors"
            >
              Use max
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-bg-base p-3 space-y-2 text-xs">
        <Row label="Route">
          <span className="text-ink-muted">
            {effectiveRoute === "tdoge-amm" ? "DOGE FORGE AMM"
              : effectiveRoute === "unitflow" ? (HAS_AGGREGATOR ? "DOGE FORGE → UnitFlow (0.10% fee)" : "UnitFlow V2.5")
              : "No route"}
          </span>
        </Row>
        <Row label="You receive (est.)">
          <span className="text-ink tabular">
            {quoteOut !== undefined ? formatUnits(quoteOut, to.decimals) : "-"} {to.symbol}
          </span>
        </Row>
        <Row label="Minimum received">
          <span className="text-ink-muted tabular">
            {quoteOut ? formatUnits(minOut, to.decimals) : "-"} {to.symbol}
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

      <div className="mt-4">
        {route === "none" ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-[11px] text-red-300 leading-relaxed">
            No trading route available for this pair. fDOGE trades against USDC in the
            DOGE FORGE AMM. Other tokens need an external DEX.
          </div>
        ) : effectiveRoute === "none" ? (
          <div className="rounded-md border border-line bg-bg-base px-3 py-2.5 text-[11px] text-ink-muted leading-relaxed">
            No UnitFlow pair for {token.symbol}/USDC yet. Liquidity must be seeded before this pair is tradable.
          </div>
        ) : needsApproval ? (
          <button
            disabled={!address || !!busy || !parsedIn || exceedsWallet}
            onClick={() => spender && doTx("approve",
              { address: from.address, abi: erc20Abi, functionName: "approve", args: [spender, parsedIn] },
              `Approving ${amount} ${from.symbol}`,
            )}
            className="w-full px-4 py-3 rounded-md border border-gold-400/60 text-ink font-medium hover:bg-gold-400/10 transition-colors disabled:opacity-40"
          >
            {busy === "approve" ? "Approving..." : `Approve ${from.symbol}`}
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
