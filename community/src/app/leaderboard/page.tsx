"use client";
import { useEffect, useMemo, useState } from "react";

type Entry = {
  rank: number;
  userId: number;
  xHandle: string;
  xAvatar: string | null;
  tier: "bronze" | "silver" | "gold" | "diamond";
  wallet: string;
  points: number;
};
type Range = "24h" | "7d" | "all";
const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d",  label: "7 days" },
  { id: "all", label: "All time" },
];

// Fetches all-time + 24h + 7d leaderboards. Sticky "you" row pinned
// at the bottom if user is bound but off-screen on the visible page.
export default function Leaderboard() {
  const [range, setRange] = useState<Range>("all");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [me, setMe] = useState<{ userId: number; xHandle: string; xAvatar: string | null; points: number } | null>(null);
  const [search, setSearch] = useState("");

  // Refetch whenever range changes.
  useEffect(() => {
    setEntries(null);
    fetch(`/api/community/leaderboard?range=${range}&limit=200`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setEntries((j.entries ?? []) as Entry[]));
  }, [range]);

  // Fetch the signed-in user once so we can highlight their row + pin
  // it if they're off-screen.
  useEffect(() => {
    fetch("/api/community/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j) return;
        setMe({ userId: j.userId, xHandle: j.xHandle, xAvatar: j.xAvatar, points: j.points });
      });
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return null;
    if (!search.trim()) return entries;
    const q = search.toLowerCase().trim();
    return entries.filter((e) =>
      e.xHandle.toLowerCase().includes(q) || e.wallet.toLowerCase().includes(q),
    );
  }, [entries, search]);

  const myRow = me && entries?.find((e) => e.userId === me.userId);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90">Season 1</p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight">Leaderboard</h1>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-line p-1 bg-bg-surface/40">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`
                px-3 py-1.5 rounded text-xs transition-colors
                ${range === r.id ? "bg-gold-400/15 text-ink" : "text-ink-muted hover:text-ink"}
              `}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="mt-6">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search handle or wallet…"
          className="
            w-full px-3 py-2 rounded-md text-sm bg-bg-base border border-line
            text-ink placeholder:text-ink-faint
            focus:outline-none focus:border-gold-400/60
          "
        />
      </div>

      {/* Table */}
      <div className="mt-4 rounded-xl border border-line bg-bg-surface/30 overflow-hidden">
        <div className="grid grid-cols-[60px_1fr_auto] gap-3 sm:gap-6 px-4 sm:px-5 py-3 border-b border-line text-[10px] uppercase tracking-[0.25em] text-ink-faint">
          <div>Rank</div>
          <div>Account</div>
          <div className="text-right">Points</div>
        </div>
        {filtered === null ? (
          <div className="p-12 space-y-3">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-ink-faint text-sm">
            No entries yet. Be the first.
          </div>
        ) : (
          <ul>
            {filtered.map((e) => (
              <Row key={e.userId} entry={e} mine={me?.userId === e.userId} />
            ))}
          </ul>
        )}
      </div>

      {/* Sticky 'you' bar — only when bound AND not in the visible top list */}
      {me && entries && !myRow && (
        <div className="sticky bottom-3 mt-4 rounded-xl border border-gold-400/40 bg-bg-base/95 backdrop-blur shadow-2xl px-4 py-3 grid grid-cols-[60px_1fr_auto] gap-3 sm:gap-6 items-center">
          <div className="text-ink-faint text-xs">You</div>
          <div className="flex items-center gap-2 min-w-0">
            {me.xAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.xAvatar} alt="" className="h-6 w-6 rounded-full" />
            ) : <div className="h-6 w-6 rounded-full bg-bg-surface" />}
            <span className="text-ink truncate">@{me.xHandle}</span>
          </div>
          <div className="text-right font-display text-gold-300 tabular">
            {me.points.toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ entry, mine }: { entry: Entry; mine: boolean }) {
  const rankClass = entry.rank === 1 ? "text-gold-300" : entry.rank <= 3 ? "text-gold-400" : "text-ink-faint";
  const medal = entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : null;
  return (
    <li
      className={`
        grid grid-cols-[60px_1fr_auto] gap-3 sm:gap-6 px-4 sm:px-5 py-3 items-center
        border-b border-line/60 last:border-b-0
        ${mine ? "bg-gold-400/[0.06]" : ""}
      `}
    >
      <div className={`font-display tabular text-lg ${rankClass} flex items-center gap-1`}>
        {medal && <span aria-hidden className="text-base leading-none">{medal}</span>}
        <span>{entry.rank}</span>
      </div>
      <div className="flex items-center gap-3 min-w-0">
        {entry.xAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.xAvatar} alt="" className="h-7 w-7 rounded-full" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-bg-surface" />
        )}
        <div className="min-w-0">
          <div className="text-ink truncate flex items-center gap-2">
            <a
              href={`https://x.com/${entry.xHandle}`}
              target="_blank" rel="noreferrer"
              className="hover:text-gold-300 transition-colors"
            >
              @{entry.xHandle}
            </a>
            <TierPill tier={entry.tier} />
            {mine && <span className="text-[10px] uppercase tracking-[0.2em] text-gold-400">you</span>}
          </div>
          <div className="text-[11px] text-ink-faint font-mono">{entry.wallet}</div>
        </div>
      </div>
      <div className="text-right font-display text-ink tabular text-base">
        {entry.points.toLocaleString()}
      </div>
    </li>
  );
}

function TierPill({ tier }: { tier: Entry["tier"] }) {
  const styles = {
    bronze:  "border-[#a07d4a]/50 text-[#d2b27a]",
    silver:  "border-slate-400/50  text-slate-200",
    gold:    "border-gold-400/60   text-gold-300",
    diamond: "border-cyan-400/50   text-cyan-200",
  }[tier];
  return (
    <span className={`inline-block px-1.5 py-0 rounded-full border text-[9px] uppercase tracking-[0.2em] ${styles}`}>
      {tier}
    </span>
  );
}
