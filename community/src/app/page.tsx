import Link from "next/link";

// Landing. Unauthenticated destination. Two jobs:
//   1. Set expectations (what points are, what they might become).
//   2. Funnel every visitor into "Connect X" as the first step.
//
// Copy is deliberately cautious about rewards — nothing here promises a
// token, allocation, or airdrop. Legal posture: points are provisional
// engagement metrics; utility is subject to change.
export default function Home() {
  return (
    <>
      <section className="bg-hero-glow">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90">
            Season 1 · Open now
          </p>
          <h1 className="mt-5 font-display text-5xl sm:text-7xl tracking-tightest leading-[0.95]">
            Earn points.<br />
            <span className="text-gold-400">Shape the forge.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-muted leading-relaxed">
            Trade, mine, claim your identity, and show up on social.
            Every action compounds into Season 1 points — a permanent
            on-chain signal that you were here early.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/connect"
              className="
                inline-flex items-center gap-2 px-5 py-3 rounded-lg
                bg-gold-400 text-bg-base font-medium
                hover:bg-gold-300 transition-colors
              "
            >
              Connect X to begin →
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

          <p className="mt-6 text-xs text-ink-faint max-w-md">
            Points have no monetary value today. Future utility — including
            a possible community token on mainnet — is not guaranteed.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            How it works
          </h2>
          <div className="mt-10 grid sm:grid-cols-3 gap-4">
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
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Where points live
          </h2>
          <p className="mt-3 text-ink-muted max-w-xl">
            Five categories. Most tasks are one-click claims. Volume and
            mining tiers auto-unlock as the on-chain indexer picks up
            your activity.
          </p>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Cat label="Social"   count="8"  hint="Follow, tweet, retweet" />
            <Cat label="Trade"    count="4"  hint="Volume milestones" />
            <Cat label="Mine"     count="5"  hint="Commitment milestones" />
            <Cat label="Identity" count="1"  hint=".fdoge name claim" />
            <Cat label="Daily"    count="∞"  hint="Streak + daily tweet" />
          </div>
        </div>
      </section>

      {/* Trust / FAQ-ish */}
      <section className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 grid lg:grid-cols-2 gap-10">
          <div>
            <h2 className="font-display text-3xl tracking-tight">Fair by default</h2>
            <p className="mt-4 text-ink-muted leading-relaxed">
              One X account per wallet. Minimum account age. Volume
              tracked on-chain via the same indexer that powers
              dogeforge.fun. Anti-sybil is baked in at the DB layer —
              duplicate attempts silently no-op.
            </p>
          </div>
          <div>
            <h2 className="font-display text-3xl tracking-tight">On rewards</h2>
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
          <h2 className="font-display text-4xl sm:text-5xl tracking-tightest">
            Ready when you are.
          </h2>
          <p className="mt-4 text-ink-muted">
            Takes 30 seconds. First task unlocks the moment you connect.
          </p>
          <Link
            href="/connect"
            className="
              mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-lg
              bg-gold-400 text-bg-base font-medium text-lg
              hover:bg-gold-300 transition-colors
            "
          >
            Connect X →
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
