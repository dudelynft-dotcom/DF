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

export default function LeaderboardPage() {
  const { address: me } = useAccount();
  const client = usePublicClient();
  const config = useConfig();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!client) return;
    const c = client;
    let cancelled = false;
    async function load() {
      try {
        // 1) Page Committed event logs in chunks. Tempo caps `eth_getLogs`
        //    block range per call; we walk back from head in fixed windows.
        const head = await c.getBlockNumber();
        const SCAN_DEPTH = 500_000n; // covers all recent testnet activity
        const RANGE      = 10_000n;
        const fromBase   = head > SCAN_DEPTH ? head - SCAN_DEPTH : 0n;
        type LogChunk = Awaited<ReturnType<typeof c.getLogs<typeof committedEvent>>>;
        const logs: LogChunk = [];
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
            logs.push(...chunk);
          } catch {
            // Skip windows the RPC rejects; rare on Tempo testnet
          }
        }

        // 2) Aggregate per-address: sum amount, count positions.
        const agg = new Map<string, { committed: bigint; positions: number }>();
        for (const l of logs) {
          const u = l.args.user as `0x${string}` | undefined;
          const a = l.args.amount as bigint | undefined;
          if (!u || a === undefined) continue;
          const key = u.toLowerCase();
          const cur = agg.get(key) ?? { committed: 0n, positions: 0 };
          cur.committed += a;
          cur.positions += 1;
          agg.set(key, cur);
        }
        if (agg.size === 0) {
          if (!cancelled) { setRows([]); setUpdatedAt(Date.now()); }
          return;
        }

        const addrs = Array.from(agg.keys()) as `0x${string}`[];

        // 3) Multicall each address → minerScore + displayNameOf.
        const calls = addrs.flatMap((a) => [
          { address: addresses.miner, abi: minerAbi, functionName: "minerScore",   args: [a], chainId: tempo.id } as const,
          { address: addresses.names, abi: namesAbi, functionName: "displayNameOf", args: [a], chainId: tempo.id } as const,
        ]);
        const res = await multicall(config, { contracts: calls, allowFailure: true });

        const enriched: Row[] = addrs.map((a, i) => {
          const score = (res[i * 2]?.result as bigint | undefined) ?? 0n;
          const name  = (res[i * 2 + 1]?.result as string  | undefined) ?? "";
          const ag = agg.get(a.toLowerCase())!;
          return {
            rank: 0,
            address: a,
            name: name && name.length > 0 ? name : null,
            score,
            committed: ag.committed,
            positions: ag.positions,
          };
        });

        // 4) Sort by score desc, fallback to committed desc.
        enriched.sort((x, y) => {
          if (y.score !== x.score) return y.score > x.score ? 1 : -1;
          return y.committed > x.committed ? 1 : -1;
        });
        enriched.forEach((r, i) => { r.rank = i + 1; });

        if (!cancelled) {
          setRows(enriched);
          setUpdatedAt(Date.now());
          setError(null);
        }
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

  const myRow = useMemo(() => {
    if (!me || !rows) return null;
    return rows.find((r) => r.address.toLowerCase() === me.toLowerCase()) ?? null;
  }, [me, rows]);

  return (
    <div className="space-y-10 max-w-4xl mx-auto">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80">Community</p>
        <h1 className="font-display text-5xl tracking-tightest mt-3">Leaderboard</h1>
        <p className="text-ink-muted mt-3 max-w-xl">
          Ranked by miner score. Score grows as committed pathUSD multiplied by time active.
          Wallets that have claimed a <span className="text-gold-300">.tdoge</span> name
          show their identity here.
        </p>
      </div>

      {/* Your row */}
      {me && myRow && (
        <section className="rounded-xl border border-gold-400/40 bg-gradient-to-br from-gold-400/10 via-bg-surface to-bg-surface p-5">
          <div className="text-[10px] uppercase tracking-[0.22em] text-gold-400/90">You</div>
          <RankRow r={myRow} highlight />
        </section>
      )}
      {me && rows && !myRow && (
        <section className="rounded-xl border border-line bg-bg-surface p-5 text-sm text-ink-muted">
          You haven&apos;t committed yet. Open a position in <a href="/mine" className="text-gold-300 hover:text-gold-200">Mine</a> to appear here.
        </section>
      )}

      {/* Table */}
      <section className="rounded-xl border border-line bg-bg-surface overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-5 py-3 text-[10px] uppercase tracking-[0.22em] text-ink-faint border-b border-line">
          <div className="col-span-1">Rank</div>
          <div className="col-span-5">Identity</div>
          <div className="col-span-2 text-right">Positions</div>
          <div className="col-span-2 text-right">Committed</div>
          <div className="col-span-2 text-right">Score</div>
        </div>

        {rows === null && !error && (
          <div className="px-5 py-10 text-center text-ink-muted text-sm">Loading…</div>
        )}
        {error && (
          <div className="px-5 py-10 text-center text-red-300 text-sm break-words">
            {error}
          </div>
        )}
        {rows && rows.length === 0 && (
          <div className="px-5 py-10 text-center text-ink-muted text-sm">
            No miners yet. Be the first.
          </div>
        )}
        {rows && rows.slice(0, 100).map((r) => (
          <RankRow key={r.address} r={r} />
        ))}
      </section>

      {updatedAt && (
        <p className="text-[11px] text-ink-faint text-center">
          Updated {new Date(updatedAt).toLocaleTimeString()} · refreshes every 60s
        </p>
      )}
    </div>
  );
}

function RankRow({ r, highlight }: { r: Row; highlight?: boolean }) {
  const short = `${r.address.slice(0, 6)}…${r.address.slice(-4)}`;
  return (
    <div className={`grid grid-cols-12 gap-2 px-5 py-3 items-center text-sm border-b border-line/50 last:border-0 ${highlight ? "" : "hover:bg-bg-raised transition-colors"}`}>
      <div className="col-span-1 font-display tabular text-ink">
        {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`}
      </div>
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
      <div className="col-span-2 text-right tabular text-ink">
        {fmt(r.committed, PATHUSD_DECIMALS)}
      </div>
      <div className="col-span-2 text-right tabular text-gold-300 font-display">
        {fmt(r.score, PATHUSD_DECIMALS)}
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
