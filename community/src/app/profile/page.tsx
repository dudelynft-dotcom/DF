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
type CommunityMe = {
  points: number;
  referrals: number;
  tier: "bronze" | "silver" | "gold" | "diamond";
} | null;

// Profile surface. Until Step 3 writes real stats, this reflects the
// live auth state:
//   - no session    → nudge to /connect
//   - session, no wallet → nudge to /connect step 2
//   - session + wallet   → current account summary + "stats coming"
export default function Profile() {
  const [me, setMe]   = useState<Me | undefined>(undefined);
  const [stats, setStats] = useState<CommunityMe>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me",      { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/community/me", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([m, c]) => {
      setMe(m as Me);
      setStats(c as CommunityMe);
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
        <div className="bg-hero-glow p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <div className="relative shrink-0">
            {me.xAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={me.xAvatar}
                alt=""
                className="h-20 w-20 rounded-full border-2 border-gold-400"
              />
            ) : (
              <div className="h-20 w-20 rounded-full border-2 border-gold-400 bg-bg-base" />
            )}
            <TierRing tier="bronze" />
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
            <div className="font-display text-4xl tabular text-ink mt-1">
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

      {/* Upcoming — placeholder cards that light up as Steps land */}
      <h2 className="mt-10 font-display text-xl tracking-tight">Coming soon</h2>
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <Upcoming n="03" title="Point history" body="Every point, every reason, every timestamp." />
        <Upcoming n="08" title="Animated tier ring" body="Bronze → Silver → Gold → Diamond ring with progress." />
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
  const link = `${origin}/?ref=@${handle}`;
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  };
  const tweetText = encodeURIComponent(
    `Mining $FDOGE on @DogeForgefun — Season 1 points are live. Connect via my link, you get a head start, I get 10%.\n\n${link}`
  );
  return (
    <div className="mt-4 rounded-xl border border-line bg-bg-surface/60 p-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.25em] text-ink-faint">Your link</div>
          <div className="mt-2 font-mono text-sm text-ink truncate">{link}</div>
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

function Upcoming({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line p-4 bg-bg-surface/40">
      <div className="font-display text-gold-400 text-xs tabular">STEP {n}</div>
      <div className="mt-1 font-medium text-ink text-sm">{title}</div>
      <p className="mt-1 text-xs text-ink-muted leading-relaxed">{body}</p>
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

function TierRing({ tier }: { tier: "bronze" | "silver" | "gold" | "diamond" }) {
  // Visual chip in the bottom-right of the avatar indicating tier.
  const color = {
    bronze:  "#a07d4a",
    silver:  "#9CA3AF",
    gold:    "#D8BB60",
    diamond: "#67E8F9",
  }[tier];
  return (
    <div
      aria-hidden
      className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full border-2 border-bg-base flex items-center justify-center"
      style={{ background: color }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
              fill="#0E0D08" />
      </svg>
    </div>
  );
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
