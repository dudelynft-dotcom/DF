import Link from "next/link";
import { LiveStats } from "@/components/LiveStats";
import { HomeHeroTicker } from "@/components/HomeHeroTicker";

export default function Home() {
  return (
    <div className="space-y-24">
      {/* ───────── Hero ───────── */}
      <section className="pt-10 pb-4">
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80 mb-6">
          Arc Network · Mining Protocol
        </p>
        <h1 className="font-display text-[48px] sm:text-[64px] lg:text-[84px] leading-[0.95] tracking-tightest text-ink">
          Mine <span className="text-gold-300">fDOGE</span>.
          <br /> Built on Arc.
        </h1>
        <p className="mt-6 sm:mt-8 max-w-xl text-ink-muted text-base sm:text-lg leading-relaxed">
          Commit USDC and earn fDOGE continuously. Emission follows a four-phase curve
          with a hard cap of 210,000,000 fDOGE. Every mining cycle deepens liquidity
          automatically — no LP deposit required.
        </p>
        <div className="mt-8 sm:mt-10 flex flex-wrap gap-3">
          <Link
            href="/mine"
            className="px-5 sm:px-6 py-3 rounded-md bg-gold-400 text-bg-base font-medium hover:bg-gold-300 transition-colors"
          >
            Start mining
          </Link>
          <Link
            href="/trade"
            className="px-5 sm:px-6 py-3 rounded-md border border-line text-ink hover:border-gold-400/60 transition-colors"
          >
            Explore markets
          </Link>
          <Link
            href="/TDOGEPAPER"
            className="px-5 sm:px-6 py-3 rounded-md text-ink-muted hover:text-ink transition-colors"
          >
            Read the paper →
          </Link>
        </div>

        {/* Live ticker — renders client-side from pair reserves. */}
        <div className="mt-10 sm:mt-12">
          <HomeHeroTicker />
        </div>
      </section>

      <div className="hairline" />

      {/* ───────── Live protocol stats ───────── */}
      <LiveStats />

      {/* ───────── How it works ───────── */}
      <section>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80 mb-6">
          How it works
        </p>
        <div className="grid md:grid-cols-3 gap-px bg-line rounded-xl overflow-hidden">
          <Step
            num="01"
            title="Commit USDC"
            body="Open a mining position with any amount of USDC. Pick a Harvest Mode — Instant (1.00×), Monthly (1.20×), or Long-Term (1.50×) — each position is independent."
          />
          <Step
            num="02"
            title="Earn fDOGE"
            body="Each position converts at 2% / day of its commitment. The protocol mints fDOGE to you based on the active phase rate × your multipliers. Unlock and harvest anytime after the lock."
          />
          <Step
            num="03"
            title="Liquidity deepens"
            body="95% of every committed USDC routes into the fDOGE/USDC pool, auto-flushed from inside the Miner contract. No keeper, no timing game. The pool owns itself."
          />
        </div>
      </section>

      {/* ───────── Primary features ───────── */}
      <section className="grid md:grid-cols-3 gap-px bg-line rounded-xl overflow-hidden">
        <Feature
          eyebrow="Mine"
          title="Commit USDC. Earn fDOGE."
          body="Rewards accrue continuously across the emission curve. Multiple parallel positions, each with its own Harvest Mode and efficiency multiplier."
          href="/mine"
        />
        <Feature
          eyebrow="Trade"
          title="Own the liquidity layer"
          body="DOGE FORGE runs its own factory + router. Every pair on the DEX is deployed and seeded by the protocol — no external aggregator, no hidden spread."
          href="/trade"
        />
        <Feature
          eyebrow="Identity"
          title=".fdoge on-chain names"
          body="Claim a permanent .fdoge name once you've mined. Claim fee flows 100% into liquidity — identity is both a status signal and a deflationary act."
          href="/id"
        />
      </section>

      {/* ───────── Emission curve ───────── */}
      <section>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80 mb-6">
          Emission Curve
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-px bg-line rounded-xl overflow-hidden">
          <Phase label="Phase 0"   range="0 to 10M"     rate="200 fDOGE / USDC" tone="bright" note="bootstrap" />
          <Phase label="Phase 1"   range="10M to 70M"   rate="100 fDOGE / USDC" note="early growth" />
          <Phase label="Phase 2"   range="70M to 150M"  rate="40 fDOGE / USDC"  note="stabilisation" />
          <Phase label="Phase 3"   range="150M to 210M" rate="10 fDOGE / USDC"  note="scarcity" />
          <Phase label="Post-cap"  range="210M +"       rate="0.2 fDOGE / USDC" tone="dim" note="10M / yr inflation" />
        </div>
      </section>

      {/* ───────── Closing CTA ───────── */}
      <section className="rounded-2xl border border-gold-400/30 bg-gradient-to-br from-gold-400/10 via-bg-surface to-bg-surface p-8 sm:p-12 text-center">
        <p className="text-[11px] uppercase tracking-[0.28em] text-gold-400/90">Ready to mine</p>
        <h2 className="mt-3 font-display text-3xl sm:text-4xl tracking-tight text-ink">
          Your first position is a single click away.
        </h2>
        <p className="mt-3 max-w-xl mx-auto text-ink-muted text-sm">
          Free Arc Testnet USDC available from the Circle faucet. No audit yet — test with
          amounts you don&rsquo;t mind leaving on chain while the protocol hardens.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/mine"
            className="px-6 py-3 rounded-md bg-gold-400 text-bg-base font-semibold hover:bg-gold-300 transition-colors"
          >
            Open a position
          </Link>
          <a
            href="https://faucet.circle.com"
            target="_blank" rel="noreferrer"
            className="px-6 py-3 rounded-md border border-line text-ink hover:border-gold-400/60 transition-colors"
          >
            Faucet ↗
          </a>
        </div>
      </section>
    </div>
  );
}

function Feature({
  eyebrow, title, body, href,
}: { eyebrow: string; title: string; body: string; href: string }) {
  return (
    <Link
      href={href}
      className="group p-8 bg-bg-surface hover:bg-bg-raised transition-colors flex flex-col gap-3"
    >
      <span className="text-xs uppercase tracking-[0.22em] text-gold-400/80">{eyebrow}</span>
      <h3 className="font-display text-2xl tracking-tight text-ink">{title}</h3>
      <p className="text-sm text-ink-muted leading-relaxed">{body}</p>
      <span className="mt-auto pt-4 text-sm text-gold-300 opacity-0 group-hover:opacity-100 transition-opacity">
        Open →
      </span>
    </Link>
  );
}

function Step({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <div className="p-8 bg-bg-surface flex flex-col gap-3">
      <span className="font-display text-3xl text-gold-300 tabular">{num}</span>
      <h3 className="font-display text-xl tracking-tight text-ink">{title}</h3>
      <p className="text-sm text-ink-muted leading-relaxed">{body}</p>
    </div>
  );
}

function Phase({
  label, range, rate, tone, note,
}: { label: string; range: string; rate: string; tone?: "bright" | "dim"; note?: string }) {
  const accent =
    tone === "bright" ? "text-gold-200"
    : tone === "dim"  ? "text-ink-muted"
    :                   "text-gold-300";
  return (
    <div className="p-6 bg-bg-surface">
      <div className="text-xs uppercase tracking-[0.22em] text-ink-faint">{label}</div>
      <div className={`mt-3 font-display text-xl tracking-tight ${accent}`}>{range}</div>
      <div className="mt-1 text-sm text-ink-muted tabular">{rate}</div>
      {note && <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-ink-faint">{note}</div>}
    </div>
  );
}
