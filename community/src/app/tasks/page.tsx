"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TaskCard, type TaskCardData } from "@/components/TaskCard";

type Me = {
  userId: number;
  xId: string;
  xHandle: string;
  xAvatar: string | null;
  wallet: `0x${string}`;
  tier: "bronze" | "silver" | "gold" | "diamond";
  points: number;
  completions: Record<string, { n: number; lastAt: number }>;
  referrals: number;
  volume?: { tradeUsd: number; mineUsd: number };
  telegram?: { id: string; username: string | null } | null;
} | null;

type Filter = "all" | "social" | "trade" | "mine" | "identity" | "daily" | "quiz";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all",      label: "All" },
  { id: "social",   label: "Social" },
  { id: "trade",    label: "Trade" },
  { id: "mine",     label: "Mine" },
  { id: "identity", label: "Identity" },
  { id: "daily",    label: "Daily" },
  { id: "quiz",     label: "Quiz" },
];

export default function Tasks() {
  const [me,    setMe]    = useState<Me | undefined>(undefined);
  const [tasks, setTasks] = useState<TaskCardData[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  // Initial load
  useEffect(() => {
    Promise.all([
      fetch("/api/community/me",    { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/community/tasks", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([m, t]) => {
      setMe(m as Me);
      setTasks((t?.tasks ?? []) as TaskCardData[]);
    });
  }, []);

  // After a successful claim, re-fetch to refresh totals + completion state.
  const onClaimed = async () => {
    const [m, t] = await Promise.all([
      fetch("/api/community/me",    { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/community/tasks", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setMe(m as Me);
    setTasks((t?.tasks ?? []) as TaskCardData[]);
  };

  // Counts per category for the nav badges. Computed before any early
  // return so the hook order is stable across renders (React rule).
  const counts = useMemo(() => {
    const out: Record<Filter, { total: number; done: number }> = {
      all: { total: 0, done: 0 },
      social: { total: 0, done: 0 },
      trade: { total: 0, done: 0 },
      mine: { total: 0, done: 0 },
      identity: { total: 0, done: 0 },
      daily: { total: 0, done: 0 },
      quiz: { total: 0, done: 0 },
    };
    if (!tasks) return out;
    out.all.total = tasks.length;
    for (const t of tasks) {
      const k = t.kind as Filter;
      out[k].total++;
      const completed = (t.completion?.n ?? 0) > 0 && t.maxCompletions !== -1;
      if (completed) { out[k].done++; out.all.done++; }
    }
    return out;
  }, [tasks]);

  // ----- early states -----
  if (me === undefined || tasks === null) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="h-24 rounded-2xl bg-white/5 animate-pulse" />
        <div className="mt-8 grid sm:grid-cols-3 gap-4">
          <div className="h-32 rounded-xl bg-white/5 animate-pulse" />
          <div className="h-32 rounded-xl bg-white/5 animate-pulse" />
          <div className="h-32 rounded-xl bg-white/5 animate-pulse" />
        </div>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90">Tasks</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight">Connect first</h1>
        <p className="mt-4 text-ink-muted max-w-md mx-auto">
          Sign in with X and bind your Arc wallet to start earning Season 1 points.
        </p>
        <Link href="/connect" className="
          mt-8 inline-flex items-center gap-2 px-5 py-3 rounded-lg
          bg-gold-400 text-bg-base font-medium hover:bg-gold-300 transition-colors
        ">
          Connect X →
        </Link>
      </div>
    );
  }

  const visible = filter === "all" ? tasks : tasks.filter((t) => t.kind === filter);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <Stats me={me} totalTasks={tasks.length} doneTasks={counts.all.done} />

      <div className="mt-8 grid lg:grid-cols-[200px_minmax(0,1fr)] gap-6">
        {/* Left filter nav */}
        <nav className="lg:sticky lg:top-20 lg:self-start">
          <div className="text-[11px] uppercase tracking-[0.3em] text-ink-faint mb-3">Categories</div>
          <ul className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible -mx-1 px-1">
            {FILTERS.map((f) => {
              const c = counts[f.id];
              const active = filter === f.id;
              return (
                <li key={f.id} className="shrink-0">
                  <button
                    onClick={() => setFilter(f.id)}
                    className={`
                      w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm whitespace-nowrap
                      transition-colors
                      ${active
                        ? "bg-gold-400/10 text-ink border border-gold-400/40"
                        : "text-ink-muted hover:text-ink hover:bg-white/5 border border-transparent"}
                    `}
                  >
                    <span>{f.label}</span>
                    <span className="text-[10px] tabular text-ink-faint">{c.done}/{c.total}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Task list */}
        <div className="space-y-3">
          {visible.length === 0 ? (
            <div className="text-sm text-ink-muted text-center py-16 border border-line rounded-xl">
              Nothing here yet.
            </div>
          ) : (
            visible.map((t) => {
              const progressUsd =
                t.kind === "trade" ? me.volume?.tradeUsd :
                t.kind === "mine"  ? me.volume?.mineUsd  :
                undefined;
              return (
                <TaskCard
                  key={t.id}
                  task={t}
                  onClaimed={onClaimed}
                  progressUsd={progressUsd}
                  telegramLinked={!!me.telegram}
                  onTelegramLinked={onClaimed}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Stats({ me, totalTasks, doneTasks }: { me: NonNullable<Me>; totalTasks: number; doneTasks: number }) {
  const progressPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  return (
    <div className="rounded-2xl border border-line bg-bg-surface/60 overflow-hidden">
      <div className="bg-hero-glow p-4 sm:p-6">
        {/* Mobile: compact 2-col (avatar+info left, points right) */}
        <div className="flex items-start gap-3 sm:gap-5">
          {me.xAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.xAvatar} alt="" className="h-10 w-10 sm:h-14 sm:w-14 rounded-full border-2 border-gold-400 shrink-0" />
          ) : (
            <div className="h-10 w-10 sm:h-14 sm:w-14 rounded-full border-2 border-gold-400 bg-bg-base shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-base sm:text-xl text-ink truncate">@{me.xHandle}</span>
              <TierPill tier={me.tier} />
            </div>
            <div className="mt-1 sm:mt-2 flex items-center gap-2 text-[11px] sm:text-xs text-ink-faint">
              <span>{doneTasks}/{totalTasks} tasks</span>
              <span className="opacity-60">·</span>
              <span>{me.referrals} ref{me.referrals === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-[9px] sm:text-[11px] uppercase tracking-[0.25em] text-gold-400/90">Season 1</div>
            <div className="font-display text-2xl sm:text-4xl lg:text-5xl tabular text-ink">
              {me.points.toLocaleString()}
            </div>
            <div className="text-[10px] sm:text-[11px] text-ink-faint">points</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full bg-gold-400 transition-[width] duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Ref link — bottom right */}
        <div className="mt-2 flex justify-end">
          <ReferralShortcut handle={me.xHandle} />
        </div>
      </div>
    </div>
  );
}

function ReferralShortcut({ handle }: { handle: string }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://community.dogeforge.fun";
  const link = `${origin}/?ref=${handle}`;
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  };
  return (
    <button
      onClick={onCopy}
      className="
        mt-2 inline-flex items-center gap-1.5 text-[11px] text-ink-muted
        hover:text-gold-300 transition-colors
      "
      title="Copy referral link"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.07 0l3.54-3.54a5 5 0 0 0-7.07-7.07L11.76 4.2M14 11a5 5 0 0 0-7.07 0L3.39 14.54a5 5 0 0 0 7.07 7.07L12.24 19.8"
              stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {copied ? "Copied!" : "Copy ref link"}
    </button>
  );
}

function TierPill({ tier }: { tier: NonNullable<Me>["tier"] }) {
  const styles = {
    bronze:  "border-[#a07d4a]/50 text-[#d2b27a]",
    silver:  "border-slate-400/50  text-slate-200",
    gold:    "border-gold-400/60   text-gold-300",
    diamond: "border-cyan-400/50   text-cyan-200",
  }[tier];
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-[0.2em] ${styles}`}>
      {tier}
    </span>
  );
}
