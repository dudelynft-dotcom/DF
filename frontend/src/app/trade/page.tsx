"use client";
import { useEffect, useMemo, useState } from "react";
import { CURATED_TOKENS, explorerLink, type CuratedToken } from "@/config/tokens";
import { addresses } from "@/config/chain";
import { TradeModal, type TradeToken } from "@/components/TradeModal";
import { PriceChart } from "@/components/PriceChart";
import { SwapForm } from "@/components/SwapForm";
import { useReadContract } from "wagmi";
import { forgeFactoryAbi } from "@/lib/dexAbis";
import { tempo } from "@/config/chain";
import { useTokenMetrics, fmtUsd, fmtSupply, fmtPct, type TokenMetrics } from "@/lib/metrics";

type DiscoveredToken = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
  first_seen?: number;
};

type RemoteList = { verified: DiscoveredToken[]; unverified: DiscoveredToken[] };

type SortKey = "top" | "trending" | "new" | "name";

export default function TradePage() {
  const [remote, setRemote] = useState<RemoteList>({ verified: [], unverified: [] });
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!url) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${url}/tokens?view=all`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const tokens = (data.tokens ?? []) as DiscoveredToken[];
        const curatedSet = new Set(CURATED_TOKENS.map((t) => t.address.toLowerCase()));
        setRemote({
          verified:   tokens.filter((t) =>  t.verified && !curatedSet.has(t.address.toLowerCase())),
          unverified: tokens.filter((t) => !t.verified && !curatedSet.has(t.address.toLowerCase())),
        });
      } catch { /* offline ok */ }
    }
    load();
    const i = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const verifiedAll = useMemo<TileToken[]>(() => [
    ...CURATED_TOKENS.map((t) => ({
      address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals,
      kind: t.kind, description: t.description, iconUrl: t.iconUrl, verified: true,
    })),
    ...remote.verified.map((t) => ({
      address: t.address as `0x${string}`, symbol: t.symbol, name: t.name, decimals: t.decimals,
      verified: true, first_seen: t.first_seen,
    })),
  ], [remote.verified]);

  const unverifiedAll = useMemo<TileToken[]>(
    () => remote.unverified.map((t) => ({
      address: t.address as `0x${string}`, symbol: t.symbol, name: t.name, decimals: t.decimals,
      verified: false, first_seen: t.first_seen,
    })),
    [remote.unverified]
  );

  const metricsByAddr = useTokenMetrics(verifiedAll);

  const [sort, setSort] = useState<SortKey>("top");
  const sortedVerified = useMemo(() => {
    const arr = [...verifiedAll];
    const m = (t: TileToken) => metricsByAddr[t.address.toLowerCase()];
    switch (sort) {
      case "top":      arr.sort((a, b) => (m(b)?.marketCapUsd ?? 0) - (m(a)?.marketCapUsd ?? 0)); break;
      case "trending": arr.sort((a, b) => (m(b)?.volume24hUsd ?? 0) - (m(a)?.volume24hUsd ?? 0)); break;
      case "new":      arr.sort((a, b) => (b.first_seen ?? 0) - (a.first_seen ?? 0)); break;
      case "name":     arr.sort((a, b) => a.symbol.localeCompare(b.symbol)); break;
    }
    // Pin fDOGE to the top regardless of sort.
    const dogeLc = addresses.doge.toLowerCase();
    const dogeIdx = arr.findIndex((t) => t.address.toLowerCase() === dogeLc);
    if (dogeIdx > 0) {
      const [d] = arr.splice(dogeIdx, 1);
      arr.unshift(d);
    }
    return arr;
  }, [verifiedAll, sort, metricsByAddr]);

  const [tradeToken, setTradeToken] = useState<TradeToken | null>(null);
  const openTrade = (t: TradeToken) => setTradeToken(t);

  // Search — filters both verified and unverified. Matches on symbol, name,
  // and address (so a user can paste a contract address to find it).
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  function matches(t: TileToken): boolean {
    if (!q) return true;
    return (
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q)
    );
  }
  const displayedVerified   = sortedVerified.filter(matches);
  const displayedUnverified = unverifiedAll.filter(matches);

  const [view, setView] = useState<"pro" | "list" | "grid">("pro");
  const [selectedAddr, setSelectedAddr] = useState<`0x${string}` | null>(null);

  // Default selection: first verified token (fDOGE) once loaded.
  useEffect(() => {
    if (!selectedAddr && sortedVerified.length > 0) {
      setSelectedAddr(sortedVerified[0].address);
    }
  }, [sortedVerified, selectedAddr]);

  const selectedToken = useMemo<TileToken | null>(() => {
    if (!selectedAddr) return null;
    const lc = selectedAddr.toLowerCase();
    return (
      sortedVerified.find((t) => t.address.toLowerCase() === lc)
      ?? unverifiedAll.find((t) => t.address.toLowerCase() === lc)
      ?? null
    );
  }, [selectedAddr, sortedVerified, unverifiedAll]);

  return (
    <div className="space-y-10">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80">Trading Hub</p>
        <h1 className="font-display text-5xl tracking-tightest mt-3">Markets</h1>
        <p className="text-ink-muted mt-3 max-w-2xl">
          Live on-chain pricing for every verified pair. fDOGE routes through the
          DOGE FORGE AMM on Arc; stablecoin transfers use standard ERC-20 routes.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by symbol, name, or contract address"
          className="w-full pl-10 pr-4 py-3 rounded-lg bg-bg-surface border border-line text-sm tabular text-ink placeholder:text-ink-faint focus:border-gold-400/60 focus:outline-none transition-colors"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" strokeLinecap="round" />
        </svg>
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full text-ink-faint hover:text-ink hover:bg-white/5 flex items-center justify-center transition-colors"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Sort bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1 p-1 rounded-lg border border-line bg-bg-surface">
          {([
            { key: "top",      label: "Top by MC" },
            { key: "trending", label: "Trending 24h" },
            { key: "new",      label: "New" },
            { key: "name",     label: "A-Z" },
          ] as const).map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                sort === s.key ? "bg-gold-400 text-bg-base font-medium" : "text-ink-muted hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-ink-faint">
            Verified: <span className="text-ink tabular">{displayedVerified.length}</span>
            {" · "}
            Unverified: <span className="text-ink tabular">{displayedUnverified.length}</span>
            {q && (
              <span className="ml-2 text-gold-300">· filtered by &ldquo;{query}&rdquo;</span>
            )}
          </div>
          <div className="flex gap-1 p-1 rounded-lg border border-line bg-bg-surface">
            {(["pro", "list", "grid"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  view === v ? "bg-gold-400 text-bg-base font-medium" : "text-ink-muted hover:text-ink"
                }`}
                title={
                  v === "pro"  ? "Pro trader view — market list + chart + swap"
                  : v === "list" ? "Dense table view"
                  :                "Tile cards"
                }
              >
                {v === "pro" ? "Pro" : v === "list" ? "List" : "Grid"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pro view — 2-pane trading terminal */}
      {view === "pro" ? (
        <ProView
          verified={displayedVerified}
          unverified={displayedUnverified}
          metricsByAddr={metricsByAddr}
          selected={selectedToken}
          onSelect={(t) => setSelectedAddr(t.address)}
        />
      ) : view === "grid" ? (
        <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayedVerified.map((t) => (
            <TokenCard
              key={t.address}
              token={t}
              metrics={metricsByAddr[t.address.toLowerCase()]}
              onTrade={() => openTrade({ address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals })}
            />
          ))}
          {displayedVerified.length === 0 && q && (
            <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-line bg-bg-surface p-6 text-center text-ink-muted text-sm">
              No verified tokens match &ldquo;{query}&rdquo;.
            </div>
          )}
        </section>
      ) : (
        <TokenTable
          rows={displayedVerified}
          metricsByAddr={metricsByAddr}
          onTrade={(t) => openTrade(t)}
          emptyHint={q ? `No verified tokens match "${query}".` : undefined}
        />
      )}

      {/* Unverified section — hidden in Pro view (it's inside the left pane) */}
      {view !== "pro" && (
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-2xl tracking-tight flex items-center gap-2">
              Unverified
              <span className="text-[11px] uppercase tracking-[0.22em] text-ink-muted bg-white/5 border border-line rounded-full px-2 py-0.5">
                {displayedUnverified.length}
              </span>
            </h2>
            <span className="text-xs text-ink-faint">Auto-discovered. Verify before trading.</span>
          </div>
          {displayedUnverified.length === 0 ? (
            <div className="rounded-xl border border-line bg-bg-surface p-8 text-center text-ink-muted text-sm">
              {q
                ? <>No unverified tokens match &ldquo;{query}&rdquo;.</>
                : <>No unverified tokens discovered yet. The indexer scans new contract deployments on Arc as it runs.</>}
            </div>
          ) : view === "grid" ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {displayedUnverified.map((t) => (
                <UnverifiedCard
                  key={t.address}
                  token={t}
                  onTrade={() => openTrade({ address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals })}
                />
              ))}
            </div>
          ) : (
            <TokenTable
              rows={displayedUnverified}
              metricsByAddr={metricsByAddr}
              onTrade={(t) => openTrade(t)}
              unverified
            />
          )}
        </section>
      )}

      <TradeModal open={!!tradeToken} onClose={() => setTradeToken(null)} token={tradeToken} />
    </div>
  );
}

type TileToken = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  kind?: CuratedToken["kind"];
  description?: string;
  iconUrl?: string;
  verified: boolean;
  first_seen?: number;
};

/// Small round token icon. Falls back to colored initials when no image set or
/// the remote URL fails to load (common on testnets with incomplete logos).
function TokenIcon({ token, size = 32 }: { token: TileToken; size?: number }) {
  const [errored, setErrored] = useState(false);
  if (token.iconUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={token.iconUrl}
        alt=""
        aria-hidden
        width={size}
        height={size}
        onError={() => setErrored(true)}
        className="rounded-full bg-bg-base shrink-0 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-lg bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-300 font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {token.symbol.slice(0, 2).toUpperCase()}
    </div>
  );
}

function TokenCard({
  token, metrics, onTrade,
}: {
  token: TileToken;
  metrics?: TokenMetrics;
  onTrade: () => void;
}) {
  const change = metrics?.priceChange24hPct ?? null;
  const changeClass =
    change === null ? "text-ink-faint"
    : change > 0 ? "text-emerald-300"
    : change < 0 ? "text-red-300"
    : "text-ink-muted";

  return (
    <div className="rounded-xl border border-line bg-bg-surface p-5 flex flex-col gap-4 hover:border-gold-400/40 transition-colors">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <TokenIcon token={token} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-lg text-ink truncate">{token.symbol}</span>
              <VerifiedTick />
              {token.kind === "project" && (
                <span className="text-[10px] uppercase tracking-wider text-gold-300 bg-gold-400/10 border border-gold-400/30 rounded-full px-1.5 py-0.5">
                  Project
                </span>
              )}
            </div>
            <div className="text-xs text-ink-faint mt-0.5 truncate">{token.name}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-display tabular text-lg text-ink">{fmtUsd(metrics?.priceUsd ?? null)}</div>
          <div className={`text-[10px] tabular ${changeClass}`}>{fmtPct(change)}</div>
        </div>
      </div>

      {/* metrics grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <MetricRow label="Market Cap"   value={fmtUsd(metrics?.marketCapUsd ?? null)} />
        <MetricRow label="FDV"          value={fmtUsd(metrics?.fdvUsd ?? null)} />
        <MetricRow label="Liquidity"    value={fmtUsd(metrics?.liquidityUsd ?? null)} />
        <MetricRow label="24h Volume"   value={fmtUsd(metrics?.volume24hUsd ?? null)} />
        <MetricRow label="Circ. Supply" value={fmtSupply(metrics?.circulatingSupply ?? null)} />
        <MetricRow label="Total Supply" value={fmtSupply(metrics?.totalSupply ?? null)} />
      </div>

      {/* footer actions */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-line mt-auto">
        <code className="text-[11px] text-ink-faint tabular truncate">
          {token.address.slice(0, 8)}…{token.address.slice(-6)}
        </code>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={explorerLink(token.address)}
            target="_blank" rel="noreferrer"
            className="px-2.5 py-1.5 rounded-md border border-line text-[11px] text-ink-muted hover:text-ink hover:border-gold-400/60 transition-colors"
            title="View on explorer"
          >
            ↗
          </a>
          {token.kind !== "native-stable" && (
            <button
              onClick={onTrade}
              className="px-3 py-1.5 rounded-md bg-gold-400 text-bg-base text-xs font-semibold hover:bg-gold-300 transition-colors"
              title="Routes through DOGE FORGE AMM (fDOGE) or DOGE FORGE Aggregator (others)"
            >
              Trade
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/// Hyperliquid-inspired 2-pane terminal: scrollable market list on the left,
/// selected-token detail + metrics + swap trigger on the right. Mobile stacks
/// the panes vertically.
function ProView({
  verified, unverified, metricsByAddr, selected, onSelect,
}: {
  verified: TileToken[];
  unverified: TileToken[];
  metricsByAddr: Record<string, TokenMetrics | undefined>;
  selected: TileToken | null;
  onSelect: (t: TileToken) => void;
}) {
  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-4 min-h-[600px]">
      {/* Left: market list */}
      <aside className="rounded-xl border border-line bg-bg-surface overflow-hidden flex flex-col">
        <MarketListGroup title="Verified" tokens={verified} metricsByAddr={metricsByAddr} selected={selected} onSelect={onSelect} showTick />
        <MarketListGroup title="Unverified" tokens={unverified} metricsByAddr={metricsByAddr} selected={selected} onSelect={onSelect} subdued />
      </aside>

      {/* Right: detail + swap trigger */}
      <section className="rounded-xl border border-line bg-bg-surface p-6 flex flex-col gap-6">
        {selected ? (
          <ProDetail token={selected} metrics={metricsByAddr[selected.address.toLowerCase()]} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
            Select a market to view details.
          </div>
        )}
      </section>
    </div>
  );
}

function MarketListGroup({
  title, tokens, metricsByAddr, selected, onSelect, showTick, subdued,
}: {
  title: string;
  tokens: TileToken[];
  metricsByAddr: Record<string, TokenMetrics | undefined>;
  selected: TileToken | null;
  onSelect: (t: TileToken) => void;
  showTick?: boolean;
  subdued?: boolean;
}) {
  if (tokens.length === 0) return null;
  return (
    <div className="border-b border-line last:border-0">
      <div className="px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-ink-faint bg-bg-base/40 sticky top-0">
        {title} · {tokens.length}
      </div>
      <ul className="max-h-[400px] overflow-y-auto">
        {tokens.map((t) => {
          const m = metricsByAddr[t.address.toLowerCase()];
          const change = m?.priceChange24hPct ?? null;
          const changeClass =
            change === null ? "text-ink-faint"
            : change > 0 ? "text-emerald-300"
            : change < 0 ? "text-red-300"
            : "text-ink-muted";
          const isSelected = selected?.address.toLowerCase() === t.address.toLowerCase();
          return (
            <li key={t.address}>
              <button
                onClick={() => onSelect(t)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-l-2 ${
                  isSelected
                    ? "bg-gold-400/10 border-gold-400"
                    : "border-transparent hover:bg-bg-raised"
                } ${subdued ? "opacity-75" : ""}`}
              >
                <TokenIcon token={t} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium text-ink truncate">{t.symbol}</span>
                    {showTick && <VerifiedTick />}
                  </div>
                  <div className="text-[10px] text-ink-faint tabular truncate">
                    {fmtUsd(m?.priceUsd ?? null)}
                  </div>
                </div>
                <div className={`text-[10px] tabular shrink-0 ${changeClass}`}>
                  {fmtPct(change)}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProDetail({
  token, metrics,
}: {
  token: TileToken;
  metrics?: TokenMetrics;
}) {
  const change = metrics?.priceChange24hPct ?? null;
  const changeClass =
    change === null ? "text-ink-faint"
    : change > 0 ? "text-emerald-300"
    : change < 0 ? "text-red-300"
    : "text-ink-muted";

  const canTrade = token.kind !== "native-stable";

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-4">
        <TokenIcon key={token.address} token={token} size={48} />
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-3xl tracking-tight text-ink">{token.symbol}</h2>
            {token.verified && <VerifiedTick />}
            {token.kind === "project" && (
              <span className="text-[10px] uppercase tracking-wider text-gold-300 bg-gold-400/10 border border-gold-400/30 rounded-full px-1.5 py-0.5">
                Project
              </span>
            )}
          </div>
          <div className="text-xs text-ink-muted">{token.name}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="font-display text-3xl tabular text-ink">{fmtUsd(metrics?.priceUsd ?? null)}</div>
          <div className={`text-xs tabular ${changeClass}`}>{fmtPct(change)} (24h)</div>
        </div>
      </div>

      {/* Chart + swap panel, Hyperliquid-style 2-column. Stacks on mobile. */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="flex flex-col gap-4">
          {/* Price chart — our own pair for fDOGE, UnitFlow pair lookup for the
              rest. Backend indexes both as long as they exist. */}
          <div className="h-48 sm:h-64 rounded-lg border border-line bg-bg-base overflow-hidden">
            <ChartForToken token={token} />
          </div>

          {/* Metrics strip — flat rows for readability in the narrow left column. */}
          <div className="rounded-lg border border-line bg-bg-base overflow-hidden divide-y divide-line">
            <DetailRow label="Market Cap"   value={fmtUsd(metrics?.marketCapUsd ?? null)} />
            <DetailRow label="FDV"          value={fmtUsd(metrics?.fdvUsd ?? null)} />
            <DetailRow label="Liquidity"    value={fmtUsd(metrics?.liquidityUsd ?? null)} />
            <DetailRow label="24h Volume"   value={fmtUsd(metrics?.volume24hUsd ?? null)} />
            <DetailRow label="Circ. Supply" value={fmtSupply(metrics?.circulatingSupply ?? null)} />
            <DetailRow label="Total Supply" value={fmtSupply(metrics?.totalSupply ?? null)} />
            <DetailRow label="Contract"     value={`${token.address.slice(0, 6)}…${token.address.slice(-4)}`} mono />
            <DetailRow
              label="Explorer"
              value={
                <a
                  href={explorerLink(token.address)}
                  target="_blank" rel="noreferrer"
                  className="text-gold-300 hover:text-gold-200 transition-colors"
                >
                  Open ↗
                </a>
              }
            />
          </div>
        </div>

        {/* Right rail: inline swap form. Re-mounts per token so stale quote
            state doesn't leak between markets. */}
        <aside className="rounded-lg border border-line bg-bg-base p-4">
          <div className="text-[10px] uppercase tracking-[0.24em] text-gold-400/90 mb-3">Trade</div>
          {canTrade ? (
            <SwapForm
              key={token.address}
              token={{ address: token.address, symbol: token.symbol, name: token.name, decimals: token.decimals }}
            />
          ) : (
            <div className="text-sm text-ink-muted leading-relaxed">
              <span className="text-ink font-medium">{token.symbol}</span> is the native quote asset — select any other market to trade it.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/// Resolves the correct pair address for a given token so PriceChart can
/// fetch its candles. fDOGE maps to our historical TdogePair (kept for the
/// Miner/LM flow); any other token resolves via `TdogeFactory.getPair`.
function ChartForToken({ token }: { token: TileToken }) {
  const isDoge = token.address.toLowerCase() === addresses.doge.toLowerCase();
  const { data: registryPair } = useReadContract({
    address: addresses.factory,
    abi: forgeFactoryAbi,
    functionName: "getPair",
    args: !isDoge ? [token.address, addresses.usdc] : undefined,
    chainId: tempo.id,
    query: { enabled: !isDoge && !!addresses.factory, refetchInterval: 60_000 },
  });

  let pair: `0x${string}` | undefined;
  if (isDoge) {
    pair = addresses.pair;
  } else {
    const p = registryPair as `0x${string}` | undefined;
    if (p && p.toLowerCase() !== "0x0000000000000000000000000000000000000000") pair = p;
  }

  return <PriceChart key={token.address} pair={pair} interval="1h" className="w-full h-full" />;
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
      <span className="text-[11px] uppercase tracking-[0.18em] text-ink-faint whitespace-nowrap">{label}</span>
      <span className={`text-ink text-right ${mono ? "tabular" : ""}`}>{value}</span>
    </div>
  );
}

/// Dense pro-trading table view. One row per token. Columns scale down on
/// narrow viewports (volume/liquidity hide on mobile).
function TokenTable({
  rows, metricsByAddr, onTrade, unverified, emptyHint,
}: {
  rows: TileToken[];
  metricsByAddr: Record<string, TokenMetrics | undefined>;
  onTrade: (t: TradeToken) => void;
  unverified?: boolean;
  emptyHint?: string;
}) {
  if (rows.length === 0 && emptyHint) {
    return (
      <div className="rounded-xl border border-line bg-bg-surface p-6 text-center text-ink-muted text-sm">
        {emptyHint}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-bg-surface overflow-hidden">
      <div className="hidden sm:grid grid-cols-[1fr_100px_80px_110px_110px_110px_110px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-[0.18em] text-ink-faint border-b border-line bg-bg-base/40">
        <div>Token</div>
        <div className="text-right">Price</div>
        <div className="text-right">24h</div>
        <div className="text-right">Market Cap</div>
        <div className="hidden md:block text-right">Liquidity</div>
        <div className="hidden md:block text-right">24h Vol</div>
        <div className="text-right pr-1">Action</div>
      </div>
      {rows.map((t) => {
        const m = metricsByAddr[t.address.toLowerCase()];
        const change = m?.priceChange24hPct ?? null;
        const changeClass =
          change === null ? "text-ink-faint"
          : change > 0 ? "text-emerald-300"
          : change < 0 ? "text-red-300"
          : "text-ink-muted";
        return (
          <div
            key={t.address}
            className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_100px_80px_110px_110px_110px_110px] gap-3 px-4 py-3 border-b border-line/50 last:border-0 items-center text-sm hover:bg-bg-raised transition-colors"
          >
            {/* Token cell */}
            <div className="flex items-center gap-3 min-w-0">
              <TokenIcon token={t} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-ink truncate">{t.symbol}</span>
                  {!unverified && <VerifiedTick />}
                  {t.kind === "project" && (
                    <span className="text-[9px] uppercase tracking-wider text-gold-300 bg-gold-400/10 border border-gold-400/30 rounded-full px-1.5 py-0.5 shrink-0">
                      Project
                    </span>
                  )}
                  {unverified && (
                    <span className="text-[9px] uppercase tracking-wider text-ink-faint bg-white/5 border border-line rounded-full px-1.5 py-0.5 shrink-0">
                      Unverified
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-ink-faint mt-0.5 tabular truncate">
                  {t.name} · {t.address.slice(0, 6)}…{t.address.slice(-4)}
                </div>
              </div>
            </div>

            {/* Metric cells — hidden on mobile, shown sm+ */}
            <div className="hidden sm:block text-right tabular text-ink">{fmtUsd(m?.priceUsd ?? null)}</div>
            <div className={`hidden sm:block text-right tabular ${changeClass}`}>{fmtPct(change)}</div>
            <div className="hidden sm:block text-right tabular text-ink-muted">{fmtUsd(m?.marketCapUsd ?? null)}</div>
            <div className="hidden md:block text-right tabular text-ink-muted">{fmtUsd(m?.liquidityUsd ?? null)}</div>
            <div className="hidden md:block text-right tabular text-ink-muted">{fmtUsd(m?.volume24hUsd ?? null)}</div>

            {/* Action */}
            <div className="flex items-center justify-end gap-1.5">
              <a
                href={explorerLink(t.address)}
                target="_blank" rel="noreferrer"
                className="h-7 w-7 rounded-md border border-line text-ink-muted hover:text-ink hover:border-gold-400/60 flex items-center justify-center text-xs transition-colors"
                title="Explorer"
              >
                ↗
              </a>
              {t.kind !== "native-stable" && (
                <button
                  onClick={() => onTrade({ address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals })}
                  className="px-3 py-1 rounded-md bg-gold-400 text-bg-base text-xs font-semibold hover:bg-gold-300 transition-colors"
                >
                  Trade
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VerifiedTick() {
  return (
    <span
      title="Verified by DOGE FORGE"
      className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-sky-400/15 border border-sky-400/40 text-sky-300 shrink-0"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12 5 5L20 7" />
      </svg>
    </span>
  );
}

function UnverifiedCard({ token, onTrade }: { token: TileToken; onTrade: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-bg-surface p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <TokenIcon token={token} size={40} />
          <div className="min-w-0">
            <span className="font-display text-lg text-ink truncate">{token.symbol}</span>
            <div className="text-xs text-ink-faint mt-0.5 truncate">{token.name}</div>
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-ink-muted bg-white/5 rounded-full px-1.5 py-0.5 shrink-0">
          Unverified
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line mt-auto">
        <code className="text-[11px] text-ink-faint tabular truncate">
          {token.address.slice(0, 8)}…{token.address.slice(-6)}
        </code>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigator.clipboard.writeText(token.address)}
            className="px-2.5 py-1.5 rounded-md border border-line text-[11px] text-ink-muted hover:text-ink hover:border-gold-400/60 transition-colors"
          >
            Copy
          </button>
          <a
            href={explorerLink(token.address)}
            target="_blank" rel="noreferrer"
            className="px-2.5 py-1.5 rounded-md border border-line text-[11px] text-ink-muted hover:text-ink hover:border-gold-400/60 transition-colors"
          >
            View ↗
          </a>
          <button
            onClick={onTrade}
            className="px-3 py-1.5 rounded-md border border-gold-400/60 text-ink text-xs hover:bg-gold-400/10 transition-colors"
            title="Routes via DOGE FORGE Aggregator; shows 'no liquidity' if the pool isn't seeded yet"
          >
            Trade
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-faint">{label}</span>
      <span className="text-ink tabular">{value}</span>
    </div>
  );
}
