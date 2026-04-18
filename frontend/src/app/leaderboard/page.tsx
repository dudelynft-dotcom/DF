"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { multicall } from "@wagmi/core";
import { formatUnits } from "viem";
import { useConfig } from "wagmi";
import { addresses, tempo, PATHUSD_DECIMALS } from "@/config/chain";
import { minerAbi } from "@/lib/abis";
import { namesAbi } from "@/lib/namesAbi";

type Row = {
  rank: number;
  address: `0x${string}`;
  name: string | null;
  score: bigint;
  committed: bigint;
  positions: number;
};

type Window = "24h" | "7d" | "all";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function LeaderboardPage() {
  const { address: me } = useAccount();
  const config = useConfig();

  const [miners, setMiners] = useState<Array<{ wallet: string; committed: bigint; positions: number }> | null>(null);
  const [nameByAddr, setNameByAddr] = useState<Record<string, string | null>>({});
  const [scoreByAddr, setScoreByAddr] = useState<Record<string, bigint>>({});
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const [window, setWindow] = useState<Window>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!BACKEND) {
      setError("Leaderboard service is not configured. Check back soon.");
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch(`${BACKEND}/leaderboard?window=${window}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as {
          miners: Array<{ wallet: string; committed: string; positions: number }>;
          updatedAt: number;
        };
        if (cancelled) return;

        const parsed = j.miners.map((m) => ({
          wallet: m.wallet,
          committed: (() => { try { return BigInt(m.committed); } catch { return 0n; } })(),
          positions: m.positions,
        }));
        setMiners(parsed);
        setUpdatedAt(j.updatedAt * 1000);
        setError(null);

        if (parsed.length === 0) {
          setScoreByAddr({}); setNameByAddr({});
          return;
        }

        // Enrich with on-chain score + .fdoge name via a single multicall.
        const uniq = parsed.map((m) => m.wallet as `0x${string}`);
        const calls = uniq.flatMap((a) => [
          { address: addresses.miner, abi: minerAbi, functionName: "minerScore",    args: [a], chainId: tempo.id } as const,
          { address: addresses.names, abi: namesAbi, functionName: "displayNameOf", args: [a], chainId: tempo.id } as const,
        ]);
        const res = await multicall(config, { contracts: calls, allowFailure: true });
        if (cancelled) return;

        const sMap: Record<string, bigint>        = {};
        const nMap: Record<string, string | null> = {};
        uniq.forEach((a, i) => {
          const s = (res[i * 2]?.result     as bigint | undefined) ?? 0n;
          const n = (res[i * 2 + 1]?.result as string | undefined) ?? "";
          sMap[a.toLowerCase()] = s;
          nMap[a.toLowerCase()] = n && n.length > 0 ? n : null;
        });
        setScoreByAddr(sMap);
        setNameByAddr(nMap);
      } catch (e: unknown) {
        const msg = (e as { message?: string })?.message ?? String(e);
        if (!cancelled) setError(msg);
      }
    }

    load();
    const i = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [window, config]);

  const rows = useMemo<Row[] | null>(() => {
    if (!miners) return null;

    const list: Row[] = miners.map((m) => ({
      rank: 0,
      address: m.wallet as `0x${string}`,
      name: nameByAddr[m.wallet] ?? null,
      score: scoreByAddr[m.wallet] ?? 0n,
      committed: m.committed,
      positions: m.positions,
    }));

    // For "all-time", rank primarily by on-chain miner score. Backend has
    // already sorted by committed, which is the right order for 24h/7d.
    if (window === "all") {
      list.sort((x, y) => {
        if (y.score !== x.score) return y.score > x.score ? 1 : -1;
        return y.committed > x.committed ? 1 : -1;
      });
    }
    list.forEach((r, i) => { r.rank = i + 1; });
    return list;
  }, [miners, window, nameByAddr, scoreByAddr]);

  const q = query.trim().toLowerCase();
  const displayed = useMemo(() => {
    if (!rows) return null;
    if (!q) return rows;
    return rows.filter((r) =>
      r.address.toLowerCase().includes(q)
      || (r.name ?? "").toLowerCase().includes(q),
    );
  }, [rows, q]);

  const myRow = useMemo(() => {
    if (!me || !rows) return null;
    return rows.find((r) => r.address.toLowerCase() === me.toLowerCase()) ?? null;
  }, [me, rows]);

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-24">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80">Community</p>
        <h1 className="font-display text-5xl tracking-tightest mt-3">Leaderboard</h1>
        <p className="text-ink-muted mt-3 max-w-xl">
          Ranked by miner score. Score grows as committed USDC multiplied by time active.
          Wallets that have claimed a <span className="text-gold-300">.fdoge</span> name
          show their identity here.
        </p>
      </div>

      {/* Filter + search bar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-1 p-1 rounded-lg border border-line bg-bg-surface">
          {([
            { k: "24h", label: "24h" },
            { k: "7d",  label: "7d"  },
            { k: "all", label: "All-time" },
          ] as const).map(({ k, label }) => (
            <button
              key={k}
              onClick={() => setWindow(k)}
              className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                window === k ? "bg-gold-400 text-bg-base font-medium" : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or address"
            className="w-full pl-9 pr-3 py-2 rounded-md bg-bg-surface border border-line text-sm tabular text-ink placeholder:text-ink-faint focus:border-gold-400/60 focus:outline-none"
          />
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none"
               viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* Table */}
      <section className="rounded-xl border border-line bg-bg-surface overflow-hidden">
        <div className="hidden sm:grid grid-cols-12 gap-2 px-5 py-3 text-[10px] uppercase tracking-[0.22em] text-ink-faint border-b border-line">
          <div className="col-span-1">Rank</div>
          <div className="col-span-5">Identity</div>
          <div className="col-span-2 text-right">Positions</div>
          <div className="col-span-2 text-right">Committed</div>
          <div className="col-span-2 text-right">Score</div>
        </div>

        {!rows && !error && (
          <div className="px-5 py-10 text-center text-ink-muted text-sm">Loading…</div>
        )}
        {error && (
          <div className="px-5 py-10 text-center text-red-300 text-sm break-words">{error}</div>
        )}
        {displayed && displayed.length === 0 && (
          <div className="px-5 py-10 text-center text-ink-muted text-sm">
            {q ? `No miners match "${query}" in this window.`
               : window === "all" ? "No miners yet. Be the first."
               : `No commits in the last ${window === "24h" ? "24 hours" : "7 days"}.`}
          </div>
        )}
        {displayed && displayed.slice(0, q ? 100 : 20).map((r) => (
          <RankRow key={r.address} r={r} highlight={me?.toLowerCase() === r.address.toLowerCase()} />
        ))}
        {displayed && !q && (rows?.length ?? 0) > 20 && (
          <div className="px-5 py-3 text-center text-[11px] text-ink-faint border-t border-line/50">
            Showing top 20 of {rows?.length}. Search above to find any wallet.
          </div>
        )}
      </section>

      {me && !myRow && rows && (
        <div className="rounded-xl border border-line bg-bg-surface p-5 text-sm text-ink-muted">
          You haven&apos;t committed {window === "all" ? "yet" : `in the last ${window === "24h" ? "24h" : "7d"}`}. Open a position in{" "}
          <a href="/mine" className="text-gold-300 hover:text-gold-200">Mine</a> to appear here.
        </div>
      )}

      {updatedAt && (
        <p className="text-[11px] text-ink-faint text-center">
          {rows?.length ?? 0} miner{(rows?.length ?? 0) === 1 ? "" : "s"} ·{" "}
          Updated {new Date(updatedAt).toLocaleTimeString()} · refreshes every 60s
        </p>
      )}

      {/* Sticky "you" bar — only when the user has a rank and isn't visible. */}
      {me && myRow && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-gold-400/30 bg-bg-surface/95 backdrop-blur-md shadow-[0_-8px_24px_rgba(0,0,0,0.45)]">
          <div className="max-w-4xl mx-auto px-4 sm:px-5 py-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="text-[10px] uppercase tracking-[0.22em] text-gold-400/90 shrink-0">You</span>
              <span className="font-display tabular text-ink shrink-0">
                {myRow.rank === 1 ? "🥇" : myRow.rank === 2 ? "🥈" : myRow.rank === 3 ? "🥉" : `#${myRow.rank}`}
              </span>
              <span className="truncate text-ink-muted">
                {myRow.name ?? `${myRow.address.slice(0, 6)}…${myRow.address.slice(-4)}`}
              </span>
              <span className="ml-auto tabular text-ink-faint">{myRow.positions}p</span>
              <span className="tabular text-ink-muted shrink-0 hidden sm:inline">{fmt(myRow.committed, PATHUSD_DECIMALS)}</span>
              <span className="tabular text-gold-300 shrink-0">{fmt(myRow.score, PATHUSD_DECIMALS)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RankRow({ r, highlight }: { r: Row; highlight?: boolean }) {
  const short = `${r.address.slice(0, 6)}…${r.address.slice(-4)}`;
  const rankLabel = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`;

  return (
    <div className={`px-4 sm:px-5 py-3 border-b border-line/50 last:border-0 ${
      highlight ? "bg-gold-400/10" : "hover:bg-bg-raised transition-colors"
    }`}>
      {/* Mobile: stacked */}
      <div className="sm:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-display tabular text-ink shrink-0 w-10">{rankLabel}</span>
            <div className="min-w-0">
              {r.name ? (
                <>
                  <div className="font-display text-gold-300 truncate">{r.name}</div>
                  <div className="text-[10px] text-ink-faint tabular truncate">{short}</div>
                </>
              ) : (
                <div className="font-display tabular text-ink truncate">{short}</div>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-display tabular text-gold-300 text-sm">{fmt(r.score, PATHUSD_DECIMALS)}</div>
            <div className="text-[10px] text-ink-faint">score</div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-4 text-[11px] text-ink-faint tabular">
          <span>{r.positions} {r.positions === 1 ? "pos" : "positions"}</span>
          <span>·</span>
          <span>{fmt(r.committed, PATHUSD_DECIMALS)} USDC</span>
        </div>
      </div>

      {/* Desktop: 12-col grid */}
      <div className="hidden sm:grid grid-cols-12 gap-2 items-center text-sm">
        <div className="col-span-1 font-display tabular text-ink">{rankLabel}</div>
        <div className="col-span-5 min-w-0">
          {r.name ? (
            <div>
              <div className="font-display text-gold-300 truncate">{r.name}</div>
              <div className="text-[10px] text-ink-faint tabular truncate">{short}</div>
            </div>
          ) : (
            <div className="font-display tabular text-ink truncate">{short}</div>
          )}
        </div>
        <div className="col-span-2 text-right tabular text-ink-muted">{r.positions}</div>
        <div className="col-span-2 text-right tabular text-ink">{fmt(r.committed, PATHUSD_DECIMALS)}</div>
        <div className="col-span-2 text-right tabular text-gold-300 font-display">{fmt(r.score, PATHUSD_DECIMALS)}</div>
      </div>
    </div>
  );
}

function fmt(v: bigint, decimals: number): string {
  const n = Number(formatUnits(v, decimals));
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
