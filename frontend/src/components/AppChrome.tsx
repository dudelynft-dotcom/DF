"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConnectButton } from "@/components/ConnectButton";

const FULL_BLEED_PATHS = new Set([
  "/tdogepaper",
]);

const NAV = [
  { href: "/mine",        label: "Mine" },
  { href: "/trade",       label: "Trade" },
  { href: "/id",          label: "Identity" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/portfolio",   label: "Portfolio" },
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname()?.toLowerCase() ?? "";
  const fullBleed = FULL_BLEED_PATHS.has(path);

  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [path]);

  return (
    <>
      {!fullBleed && (
        <header className="sticky top-0 z-30 backdrop-blur-md bg-bg-base/70 border-b border-line">
          <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 py-4 sm:py-5 gap-3">
            {/* Brand */}
            <div className="flex items-center gap-6 md:gap-10 min-w-0">
              <Link href="/" className="flex items-center gap-2.5 shrink-0">
                {/* Doge avatar. Use a transparent-background PNG at frontend/public/doge.png */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/doge.png"
                  alt=""
                  aria-hidden
                  className="h-9 w-9 object-contain drop-shadow-[0_0_8px_rgba(201,163,74,0.35)]"
                />
                <span className="font-display text-lg sm:text-xl tracking-tightest">DOGE FORGE</span>
              </Link>
              <nav className="hidden md:flex gap-5 lg:gap-7 text-sm text-ink-muted">
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} className="hover:text-ink transition-colors whitespace-nowrap">
                    {n.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <ConnectButton />
              {/* Mobile hamburger */}
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Toggle menu"
                className="md:hidden h-9 w-9 rounded-md border border-line flex items-center justify-center text-ink-muted hover:text-ink hover:border-gold-400/60 transition-colors"
              >
                {menuOpen ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Mobile drawer */}
          {menuOpen && (
            <nav className="md:hidden border-t border-line bg-bg-surface">
              <div className="max-w-6xl mx-auto px-4 py-2 flex flex-col">
                {NAV.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setMenuOpen(false)}
                    className="px-2 py-3 text-sm text-ink-muted hover:text-ink border-b border-line/50 last:border-0"
                  >
                    {n.label}
                  </Link>
                ))}
                <Link
                  href="/TDOGEPAPER"
                  onClick={() => setMenuOpen(false)}
                  className="px-2 py-3 text-sm text-gold-300 hover:text-gold-200"
                >
                  TDOGE Paper
                </Link>
              </div>
            </nav>
          )}
        </header>
      )}

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">{children}</main>

      <footer className="border-t border-line mt-16 sm:mt-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 text-[11px] sm:text-xs text-ink-faint flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span>DOGE FORGE · Tempo Chain</span>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5">
            <Link href="/TDOGEPAPER" className="hover:text-gold-300 transition-colors">
              TDOGE Paper
            </Link>
            <span className="tabular">TDOGE · 210M initial cap · 0.1% transfer fee</span>
          </div>
        </div>
      </footer>
    </>
  );
}
