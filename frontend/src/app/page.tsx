import Link from "next/link";
import { LiveStats } from "@/components/LiveStats";

export default function Home() {
  return (
    <div className="space-y-24">
      <section className="pt-10 pb-4">
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80 mb-6">
          Arc Network · Mining Protocol
        </p>
        <h1 className="font-display text-[48px] sm:text-[64px] lg:text-[84px] leading-[0.95] tracking-tightest text-ink">
          Mine <span className="text-gold-300">fDOGE</span>.
          <br /> Built on Arc.
        </h1>
        <p className="mt-6 sm:mt-8 max-w-xl text-ink-muted text-base sm:text-lg leading-relaxed">
          Commit USDC and earn fDOGE continuously. The emission curve follows
          a four-phase schedule with a hard cap of 210,000,000 fDOGE.
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
            Explore tokens
          </Link>
        </div>
      </section>

      <div className="hairline" />

      <LiveStats />

      <section className="grid md:grid-cols-3 gap-px bg-line rounded-xl overflow-hidden">
        <Feature
          eyebrow="Mine"
          title="Commit USDC. Earn fDOGE."
          body="Rewards accrue continuously across the emission curve. Multiple parallel positions, each with its own Harvest Mode and efficiency multiplier."
          href="/mine"
        />
        <Feature
          eyebrow="Trade"
          title="Unified token directory"
          body="Curated assets alongside tokens discovered automatically on Arc. Verified and unverified sections, with direct on-chain address access."
          href="/trade"
        />
        <Feature
          eyebrow="Portfolio"
          title="Balances and positions"
          body="Live view of your wallet balances, active mining positions, projected rewards, and cumulative miner score."
          href="/portfolio"
        />
      </section>

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
