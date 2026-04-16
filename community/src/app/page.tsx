"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Session = { xHandle: string; wallet: string | null } | null;

// Landing. Unauthenticated destination. Two jobs:
//   1. Set expectations (what points are, what they might become).
//   2. Funnel every visitor into "Connect X" as the first step.
//
// Copy is deliberately cautious about rewards — nothing here promises a
// token, allocation, or airdrop. Legal posture: points are provisional
// engagement metrics; utility is subject to change.
export default function Home() {
  const [me, setMe] = useState<Session | undefined>(undefined);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setMe(j as Session))
      .catch(() => setMe(null));
  }, []);

  // Auth-aware CTA copy. Three states:
  //   - undefined/null → "Connect X to begin"
  //   - connected, no wallet bound → nudge to finish connect
  //   - fully bound → "Open the forge"
  const cta = me == null
    ? { href: "/connect",    label: "Connect X to begin →" }
    : !me.wallet
    ? { href: "/connect",    label: "Bind your wallet →" }
    : { href: "/tasks",      label: "Open the forge →" };

  return (
    <>
      <section className="bg-hero-glow">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90">
            Season 1 · Open now
          </p>
          <h1 className="mt-5 font-display text-3xl sm:text-5xl lg:text-7xl tracking-tightest leading-[0.95]">
            Earn points.<br />
            <span className="text-gold-400">Shape the forge.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-muted leading-relaxed">
            Trade, mine, claim your identity, and show up on social.
            Every action compounds into Season 1 points — a permanent
            on-chain signal that you were here early.
          </p>

          {me && (
            <div className="mt-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-xs">
              <Dot /> Connected as @{me.xHandle}
              {!me.wallet && <span className="text-amber-300 ml-1">· bind wallet to continue</span>}
            </div>
          )}

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href={cta.href}
              className="
                inline-flex items-center gap-2 px-5 py-3 rounded-lg
                bg-gold-400 text-bg-base font-medium
                hover:bg-gold-300 transition-colors
              "
            >
              {cta.label}
            </Link>
            <Link
              href="/leaderboard"
              className="
                inline-flex items-center gap-2 px-5 py-3 rounded-lg
                border border-line text-ink
                hover:border-gold-400/60 hover:bg-white/5 transition-colors
              "
            >
              View leaderboard
            </Link>
          </div>

        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-tight">
            How it works
          </h2>
          <div className="mt-8 sm:mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Step n="01" title="Connect X"
              body="Sign in with X (OAuth 2.0). We read your handle, not your DMs. Account must be ≥ 30 days old." />
            <Step n="02" title="Bind wallet"
              body="Sign a message to link your Arc wallet. One X handle, one wallet. No gas, no approvals." />
            <Step n="03" title="Earn points"
              body="Complete tasks across social, trading, mining, and identity. Streaks and referrals stack." />
          </div>
        </div>
      </section>

      {/* Task categories preview */}
      <section className="border-t border-line bg-bg-surface/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-tight">
            Where points live
          </h2>
          <p className="mt-3 text-ink-muted max-w-xl">
            Five categories. Most tasks are one-click claims. Volume and
            mining tiers auto-unlock as the on-chain indexer picks up
            your activity.
          </p>
          <div className="mt-8 sm:mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Cat label="Social"   count="3"  hint="Follow, tweet, join TG" />
            <Cat label="Trade"    count="4"  hint="Volume milestones" />
            <Cat label="Mine"     count="4"  hint="Commitment milestones" />
            <Cat label="Identity" count="1"  hint=".fdoge name claim" />
            <Cat label="Daily"    count="∞"  hint="Streak + daily tweet" />
          </div>
          <p className="mt-6 text-sm text-ink-muted">
            Heads up: claiming a <span className="text-gold-300">.fdoge</span> identity on the main app
            unlocks one of the highest-point tasks here — +300 points, one-time.
          </p>
        </div>
      </section>

      {/* Trust / FAQ-ish */}
      <section className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 grid lg:grid-cols-2 gap-10">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl tracking-tight">Fair by default</h2>
            <p className="mt-4 text-ink-muted leading-relaxed">
              One X account per wallet. Minimum account age. Volume
              tracked on-chain via the same indexer that powers
              dogeforge.fun. Anti-sybil is baked in at the DB layer —
              duplicate attempts silently no-op.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl sm:text-3xl tracking-tight">On rewards</h2>
            <p className="mt-4 text-ink-muted leading-relaxed">
              We may launch <span className="text-ink">cDOGE</span> on
              mainnet as a community token — and Season 1 points would
              be the first thing we look at. That said: this is not a
              promise. Points are points. Treat them as
              participation credit, not pre-sale allocation.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 text-center">
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl tracking-tightest">
            {me?.wallet ? "See you inside." : "Ready when you are."}
          </h2>
          <p className="mt-4 text-ink-muted">
            {me?.wallet
              ? `You're connected as @${me.xHandle}. Jump back to your task dashboard.`
              : "Takes 30 seconds. First task unlocks the moment you connect."}
          </p>
          <Link
            href={cta.href}
            className="
              mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-lg
              bg-gold-400 text-bg-base font-medium text-lg
              hover:bg-gold-300 transition-colors
            "
          >
            {cta.label}
          </Link>
        </div>
      </section>
    </>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line p-5 bg-bg-surface/40">
      <div className="font-display text-gold-400 text-sm tabular">{n}</div>
      <div className="mt-2 font-medium text-ink text-lg">{title}</div>
      <p className="mt-2 text-sm text-ink-muted leading-relaxed">{body}</p>
    </div>
  );
}

function Dot() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />;
}

function Cat({ label, count, hint }: { label: string; count: string; hint: string }) {
  return (
    <div className="rounded-xl border border-line p-4 bg-bg-base hover:border-gold-400/40 transition-colors">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-gold-400 font-display text-xl tabular">{count}</span>
      </div>
      <div className="text-xs text-ink-faint mt-1">{hint}</div>
    </div>
  );
}
