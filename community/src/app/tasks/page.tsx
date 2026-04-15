import Link from "next/link";

// Placeholder. Step 4 builds the real dashboard (left nav + task cards +
// totals bar). Kept live so navigation in the header works and the
// design shell can be previewed.
export default function Tasks() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 text-center">
      <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90">
        Step 4
      </p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">
        Task dashboard
      </h1>
      <p className="mt-4 text-ink-muted max-w-md mx-auto">
        Lands after auth + DB are wired. Will show task cards grouped by
        Social / Trade / Mine / Identity / Daily with progress bars and
        a totals bar up top.
      </p>
      <Link href="/" className="mt-8 inline-block text-sm text-ink-muted hover:text-ink transition-colors">
        ← Back to landing
      </Link>
    </div>
  );
}
