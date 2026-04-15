import Link from "next/link";

// Placeholder. Step 8 ships the real leaderboard (client-side filters,
// sticky "you" bar, weekly top-10 highlight).
export default function Leaderboard() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 text-center">
      <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90">
        Step 8
      </p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">
        Leaderboard
      </h1>
      <p className="mt-4 text-ink-muted max-w-md mx-auto">
        Ranks every connected account by Season 1 points. Comes online
        once the points ledger is writing.
      </p>
      <Link href="/" className="mt-8 inline-block text-sm text-ink-muted hover:text-ink transition-colors">
        ← Back to landing
      </Link>
    </div>
  );
}
