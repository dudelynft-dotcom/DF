import Link from "next/link";

// Placeholder. Step 8 fills this with: point history chart, linked
// wallet, streak indicator, referral link + invite count, tier ring.
export default function Profile() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 text-center">
      <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90">
        Step 8
      </p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">
        Profile
      </h1>
      <p className="mt-4 text-ink-muted max-w-md mx-auto">
        Your point history, tier, streak, and referral link live here
        once you connect.
      </p>
      <Link href="/connect" className="mt-8 inline-block text-sm text-gold-400 hover:text-gold-300 transition-colors">
        Connect X →
      </Link>
    </div>
  );
}
