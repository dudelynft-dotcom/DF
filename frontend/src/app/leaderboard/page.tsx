"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { multicall } from "@wagmi/core";
import { formatUnits, parseAbiItem } from "viem";
import { useConfig } from "wagmi";
import { addresses, tempo, PATHUSD_DECIMALS } from "@/config/chain";
import { minerAbi } from "@/lib/abis";
import { namesAbi } from "@/lib/namesAbi";

const committedEvent = parseAbiItem(
  "event Committed(address indexed user, uint256 indexed positionId, uint256 amount, uint8 mode, uint64 unlockAt)"
);

type Row = {
  rank: number;
  address: `0x${string}`;
  name: string | null;
  score: bigint;
  committed: bigint;
  positions: number;
};

type RawCommit = {
  user: `0x${string}`;
  amount: bigint;
  blockNumber: bigint;
};

type Window = "24h" | "7d" | "all";

// Arc block time ≈ 0.5-1s. Windows are approximate.
// Reduced scan depths and larger chunk sizes for faster loading.
const BLOCKS_PER_DAY = 86_400n; // ~1 block/sec on Arc
const WINDOW_BLOCKS: Record<Window, bigint> = {
  "24h": BLOCKS_PER_DAY,
  "7d":  BLOCKS_PER_DAY * 7n,
  "all": BLOCKS_PER_DAY * 7n, // cap "all" at 7 days for performance; testnet activity is recent
};

export default function LeaderboardPage() {
  const { address: me } = useAccount();
  const client = usePublicClient();
  const config = useConfig();

  const [raw, setRaw] = useState<RawCommit[] | null>(null);
  const [head, setHead] = useState<bigint | null>(null);
  const [nameByAddr, setNameByAddr] = useState<Record<string, string | null>>({});
  const [scoreByAddr, setScoreByAddr] = useState<Record<string, bigint>>({});
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const [window, setWindow] = useState<Window>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!client) return;
    const c = client;
    let cancelled = false;

    async function load() {
      try {
        const headNow = await c.getBlockNumber();
        const SCAN_DEPTH = WINDOW_BLOCKS[window];
        const RANGE      = 50_000n; // Arc RPC handles larger ranges well
        const fromBase   = headNow > SCAN_DEPTH ? headNow - SCAN_DEPTH : 0n;

        type LogChunk = Awaited<ReturnType<typeof c.getLogs<typeof committedEvent>>>;
        const logs: LogChunk = [];
        for (let f = fromBase; f <= headNow; f += RANGE + 1n) {
          if (cancelled) return;
          const t = f + RANGE > headNow ? headNow : f + RANGE;
          try {
            const chunk = await c.getLogs({
              address: addresses.miner,
              event: committedEvent,
              fromBlock: f,
              toBlock: t,
            });
            logs.push(...chunk);
          } catch { /* rare RPC rejection */ }
        }

        const commits: RawCommit[] = logs
          .map((l) => {
            const u = l.args.user as `0x${string}` | undefined;
            const a = l.args.amount as bigint | undefined;
            const b = l.blockNumber;
            if (!u || a === undefined || b === null) return null;
            return { user: u, amount: a, blockNumber: b } satisfies RawCommit;
          })
          .filter((x): x is RawCommit => x !== null);

        if (cancelled) return;
        setRaw(commits);
        setHead(headNow);

        // Enrich addresses with on-chain data (independent of filter window).
        const uniq = Array.from(new Set(commits.map((x) => x.user.toLowerCase()))) as `0x${string}`[];
        if (uniq.length === 0) {
          setScoreByAddr({}); setNameByAddr({});
          setUpdatedAt(Date.now()); setError(null);
          return;
        }

        const calls = uniq.flatMap((a) => [
          { address: addresses.miner, abi: minerAbi, functionName: "minerScore",   args: [a], chainId: tempo.id } as const,
          { address: addresses.names, abi: namesAbi, functionName: "displayNameOf", args: [a], chainId: tempo.id } as const,
        ]);
        const res = await multicall(config, { contracts: calls, allowFailure: true });

        const sMap: Record<string, bigint>       = {};
        const nMap: Record<string, string | null> = {};
        uniq.forEach((a, i) => {
          const s = (res[i * 2]?.result as bigint | undefined) ?? 0n;
          const n = (res[i * 2 + 1]?.result as string | undefined) ?? "";
          sMap[a.toLowerCase()] = s;
          nMap[a.toLowerCase()] = n && n.length > 0 ? n : null;
        });
        if (cancelled) return;
        setScoreByAddr(sMap);
        setNameByAddr(nMap);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (e: unknown) {
        const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
                 ?? (e as { message?: string })?.message ?? String(e);
        if (!cancelled) setError(msg);
      }
    }

    load();
    const i = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [client, config]);

  // Filtering + ranking is reactive to the window toggle without refetch.
  const rows = useMemo<Row[] | null>(() => {
    if (!raw || !head) return null;
    const cutoff = window === "all" ? 0n : (head > WINDOW_BLOCKS[window] ? head - WINDOW_BLOCKS[window] : 0n);

    const agg = new Map<string, { committed: bigint; positions: number }>();
    for (const l of raw) {
      if (l.blockNumber < cutoff) continue;
      const key = l.user.toLowerCase();
      const cur = agg.get(key) ?? { committed: 0n, positions: 0 };
      cur.committed += l.amount;
      cur.positions += 1;
      agg.set(key, cur);
    }

    const list: Row[] = Array.from(agg.entries()).map(([key, ag]) => ({
      rank: 0,
      address: key as `0x${string}`,
      name: nameByAddr[key] ?? null,
      score: scoreByAddr[key] ?? 0n,
      committed: ag.committed,
      positions: ag.positions,
    }));

    // Score is all-time cumulative; for windowed views, rank by committed in window.
    list.sort((x, y) => {
      if (window === "all") {
        if (y.score !== x.score) return y.score > x.score ? 1 : -1;
        return y.committed > x.committed ? 1 : -1;
      }
      return y.committed > x.committed ? 1 : -1;
    });
    list.forEach((r, i) => { r.rank = i + 1; });
    return list;
  }, [raw, head, window, nameByAddr, scoreByAddr]);

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
        {displayed && displayed.slice(0, 100).map((r) => (
          <RankRow key={r.address} r={r} highlight={me?.toLowerCase() === r.address.toLowerCase()} />
        ))}
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
