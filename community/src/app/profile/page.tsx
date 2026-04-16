"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Me = {
  xId: string;
  xHandle: string;
  xName?: string;
  xAvatar?: string;
  wallet: `0x${string}` | null;
} | null;
type Tier = "bronze" | "silver" | "gold" | "diamond";
type CommunityMe = {
  points: number;
  referrals: number;
  tier: Tier;
} | null;
type LedgerEntry = {
  id: number;
  delta: number;
  reason: string;
  created_at: number;
  task_slug: string | null;
  task_title: string | null;
  task_kind: string | null;
};

// Point thresholds for tier promotion — must match backend logic
// in community.ts.
const TIER_THRESHOLDS: Record<Tier, number> = {
  bronze: 0, silver: 1000, gold: 5000, diamond: 25_000,
};
const NEXT_TIER: Record<Tier, Tier | null> = {
  bronze: "silver", silver: "gold", gold: "diamond", diamond: null,
};
const TIER_COLOR: Record<Tier, string> = {
  bronze: "#a07d4a", silver: "#9CA3AF", gold: "#D8BB60", diamond: "#67E8F9",
};

// Profile surface. Until Step 3 writes real stats, this reflects the
// live auth state:
//   - no session    → nudge to /connect
//   - session, no wallet → nudge to /connect step 2
//   - session + wallet   → current account summary + "stats coming"
export default function Profile() {
  const [me, setMe]   = useState<Me | undefined>(undefined);
  const [stats, setStats] = useState<CommunityMe>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me",             { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/community/me",        { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/community/me/ledger", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([m, c, l]) => {
      setMe(m as Me);
      setStats(c as CommunityMe);
      setLedger((l?.entries ?? []) as LedgerEntry[]);
    }).catch(() => setMe(null));
  }, []);

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/";
  };

  // Initial load — avoid layout jump.
  if (me === undefined) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="h-8 w-40 rounded bg-white/5 animate-pulse" />
        <div className="mt-6 h-40 rounded-xl bg-white/5 animate-pulse" />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90">Profile</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight">Not connected yet</h1>
        <p className="mt-4 text-ink-muted max-w-md mx-auto">
          Connect X and bind your Arc wallet to start earning Season 1 points.
        </p>
        <Link
          href="/connect"
          className="
            mt-8 inline-flex items-center gap-2 px-5 py-3 rounded-lg
            bg-gold-400 text-bg-base font-medium
            hover:bg-gold-300 transition-colors
          "
        >
          Connect X →
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
      {/* Hero card */}
      <div className="rounded-2xl border border-line bg-bg-surface/60 overflow-hidden">
        <div className="bg-hero-glow p-4 sm:p-6 lg:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <TierProgressRing
              tier={stats?.tier ?? "bronze"}
              points={stats?.points ?? 0}
              size={92}
            >
              {me.xAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.xAvatar} alt="" className="h-20 w-20 rounded-full" />
              ) : (
                <div className="h-20 w-20 rounded-full bg-bg-base" />
              )}
            </TierProgressRing>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-2xl text-ink">
                {me.xName || `@${me.xHandle}`}
              </span>
              <span className="text-ink-muted text-sm">@{me.xHandle}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-ink-muted">
              <TierPill tier="bronze" />
              <span className="opacity-60">·</span>
              <span>Season 1 member</span>
            </div>
          </div>

          <div className="sm:ml-auto text-right shrink-0">
            <div className="text-[11px] uppercase tracking-[0.25em] text-gold-400/90">Points</div>
            <div className="font-display text-3xl sm:text-4xl tabular text-ink mt-1">
              {(stats?.points ?? 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-ink-faint">
              {stats?.referrals ?? 0} referral{stats?.referrals === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {/* Linked accounts row */}
        <div className="border-t border-line grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line">
          <LinkedRow
            label="X account"
            value={`@${me.xHandle}`}
            status="connected"
          />
          <LinkedRow
            label="Arc wallet"
            value={me.wallet ? shortAddr(me.wallet) : "Not bound"}
            valueMono
            status={me.wallet ? "connected" : "pending"}
            cta={!me.wallet && { href: "/connect", label: "Bind →" }}
          />
        </div>
      </div>

      {/* Referral card — full width, prominent */}
      <h2 className="mt-10 font-display text-xl tracking-tight">Refer & earn</h2>
      <ReferralCard handle={me.xHandle} count={stats?.referrals ?? 0} />

      {/* Point history — real ledger */}
      <h2 className="mt-10 font-display text-xl tracking-tight">Point history</h2>
      <PointHistory entries={ledger} />
      <div className="mt-2 text-[11px] text-ink-faint">
        Shows up to 50 most recent entries. Full history available in the Season 1 snapshot at season end.
      </div>

      <div className="mt-12 text-right">
        <button
          onClick={onLogout}
          className="text-xs text-ink-faint hover:text-red-300 transition-colors"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

function LinkedRow({
  label, value, valueMono, status, cta,
}: {
  label: string;
  value: string;
  valueMono?: boolean;
  status: "connected" | "pending";
  cta?: { href: string; label: string } | false;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.25em] text-ink-faint">{label}</div>
          <div className={`mt-2 text-ink truncate ${valueMono ? "font-mono text-sm" : ""}`}>
            {value}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {status === "connected" ? <Dot color="emerald" /> : <Dot color="amber" />}
          {cta && (
            <Link
              href={cta.href}
              className="text-xs text-gold-400 hover:text-gold-300 transition-colors"
            >
              {cta.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function ReferralCard({ handle, count }: { handle: string; count: number }) {
  const [copied, setCopied] = useState(false);
  // Origin works in dev (localhost) and in prod (community.dogeforge.fun).
  const origin = typeof window !== "undefined" ? window.location.origin : "https://community.dogeforge.fun";
  const link = `${origin}/?ref=${handle}`;
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  };
  const tweetText = encodeURIComponent(
    `Mining $FDOGE on @DogeForgefun — Season 1 points are live. Connect via my link, you get a head start, I get 10%.\n\n${link}`
  );
  return (
    <div className="mt-4 rounded-xl border border-line bg-bg-surface/60 p-4 sm:p-5">
      <div className="flex flex-col gap-4">
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="text-[11px] uppercase tracking-[0.25em] text-ink-faint">Your link</div>
          <div className="mt-2 font-mono text-xs sm:text-sm text-ink truncate">{link}</div>
          <div className="mt-2 text-xs text-ink-muted">
            <span className="text-gold-300 font-medium">10%</span> of every referee&apos;s points,
            credited to you on every claim. {count} signed up so far.
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={onCopy}
            className="
              px-3 py-2 rounded-md text-sm font-medium transition-colors
              border border-line text-ink hover:border-gold-400/60 hover:bg-white/5
            "
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={`https://x.com/intent/tweet?text=${tweetText}`}
            target="_blank" rel="noreferrer"
            className="
              px-3 py-2 rounded-md text-sm font-medium transition-colors
              bg-gold-400 text-bg-base hover:bg-gold-300
            "
          >
            Share on X
          </a>
        </div>
      </div>
    </div>
  );
}

function Dot({ color }: { color: "emerald" | "amber" }) {
  const cls = color === "emerald" ? "bg-emerald-400" : "bg-amber-400";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`} />;
}

function TierPill({ tier }: { tier: "bronze" | "silver" | "gold" | "diamond" }) {
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

// SVG progress ring around the avatar. Shows how close the user is
// to their next tier. Stroke colour matches current tier. A small
// tier chip pins the tier name in the corner for legibility at a
// glance (icon alone is too abstract).
function TierProgressRing({
  tier, points, size, children,
}: {
  tier: Tier;
  points: number;
  size: number;
  children: React.ReactNode;
}) {
  const next    = NEXT_TIER[tier];
  const start   = TIER_THRESHOLDS[tier];
  const end     = next ? TIER_THRESHOLDS[next] : start;
  // Max tier → ring full; otherwise interpolate between thresholds.
  const progress = next
    ? Math.max(0, Math.min(1, (points - start) / (end - start)))
    : 1;

  const stroke  = 4;
  const r       = (size - stroke) / 2;
  const c       = 2 * Math.PI * r;
  const dash    = `${progress * c} ${c}`;
  const color   = TIER_COLOR[tier];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        {/* Progress */}
        <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={color} strokeWidth={stroke}
                strokeDasharray={dash} strokeLinecap="round"
                style={{ transition: "stroke-dasharray 700ms ease" }} />
      </svg>
      {/* Avatar centred */}
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
      {/* Tier label chip */}
      <div
        aria-hidden
        className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full border-2 border-bg-base text-[9px] uppercase tracking-[0.2em] font-medium"
        style={{ background: color, color: "#0E0D08" }}
      >
        {tier}
      </div>
    </div>
  );
}

function PointHistory({ entries }: { entries: LedgerEntry[] | null }) {
  if (entries === null) {
    return (
      <div className="mt-4 space-y-2">
        {[...Array(5)].map((_, i) => <div key={i} className="h-12 rounded bg-white/5 animate-pulse" />)}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-line bg-bg-surface/40 p-6 text-center text-sm text-ink-muted">
        No points yet. Claim a task to start the history.
      </div>
    );
  }
  return (
    <ul className="mt-4 divide-y divide-line border border-line rounded-xl overflow-hidden bg-bg-surface/40">
      {entries.map((e) => (
        <li key={e.id} className="p-3 sm:p-4 flex items-center gap-3">
          <div className={`shrink-0 w-14 text-right font-display tabular text-sm sm:text-base ${e.delta > 0 ? "text-emerald-300" : "text-red-300"}`}>
            {e.delta > 0 ? "+" : ""}{e.delta}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-ink truncate">
              {e.task_title ?? prettyReason(e.reason)}
            </div>
            <div className="text-[11px] text-ink-faint">
              {timeAgo(e.created_at)}
              {e.task_kind && <> · <span className="uppercase tracking-[0.15em]">{e.task_kind}</span></>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function prettyReason(raw: string): string {
  // Backend tags adjustments with prefixes like "admin:bulk:reason",
  // "admin:tweet-reject:...", "admin:ban:...". Strip the prefix for
  // display but keep the meaning obvious.
  if (raw.startsWith("admin:bulk:"))           return `Bulk award: ${raw.slice(11)}`;
  if (raw.startsWith("admin:tweet-reject:"))   return `Tweet rejected: ${raw.slice(19)}`;
  if (raw.startsWith("admin:ban:"))            return `Ban penalty: ${raw.slice(10)}`;
  if (raw.startsWith("admin:"))                return `Admin: ${raw.slice(6)}`;
  if (raw === "referral")                      return "Referral share";
  if (raw === "task")                          return "Task completion";
  return raw;
}
function timeAgo(sec: number): string {
  const s = Math.floor(Date.now() / 1000) - sec;
  if (s < 60)            return "just now";
  if (s < 3600)          return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)         return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30)    return `${Math.floor(s / 86400)}d ago`;
  return new Date(sec * 1000).toLocaleDateString();
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
