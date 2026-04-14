"use client";
import { useEffect, useMemo, useState } from "react";
import { CURATED_TOKENS, explorerLink, type CuratedToken } from "@/config/tokens";
import { addresses } from "@/config/chain";
import { TradeModal, type TradeToken } from "@/components/TradeModal";
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
      kind: t.kind, description: t.description, verified: true,
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
        <div className="text-xs text-ink-faint">
          Verified: <span className="text-ink tabular">{displayedVerified.length}</span>
          {" · "}
          Unverified: <span className="text-ink tabular">{displayedUnverified.length}</span>
          {q && (
            <span className="ml-2 text-gold-300">· filtered by &ldquo;{query}&rdquo;</span>
          )}
        </div>
      </div>

      {/* Verified grid */}
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

      {/* Unverified grid */}
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
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayedUnverified.map((t) => (
              <UnverifiedCard
                key={t.address}
                token={t}
                onTrade={() => openTrade({ address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals })}
              />
            ))}
          </div>
        )}
      </section>

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
  verified: boolean;
  first_seen?: number;
};

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
          <div className="h-10 w-10 rounded-lg bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-300 text-sm font-semibold shrink-0">
            {token.symbol.slice(0, 2).toUpperCase()}
          </div>
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
              title="Routes through DOGE FORGE AMM (fDOGE) or UnitFlow V2.5 (others)"
            >
              Trade
            </button>
          )}
        </div>
      </div>
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
          <div className="h-10 w-10 rounded-lg bg-white/5 border border-line flex items-center justify-center text-ink-muted text-sm font-semibold shrink-0">
            {token.symbol.slice(0, 2).toUpperCase()}
          </div>
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
            title="Attempts to route via UnitFlow V2.5; will show 'no liquidity' if no pair exists"
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
