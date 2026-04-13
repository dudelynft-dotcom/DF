"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ConnectButton } from "@/components/ConnectButton";

const FULL_BLEED_PATHS = new Set([
  "/tdogepaper",
]);

export function AppChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname()?.toLowerCase() ?? "";
  const fullBleed = FULL_BLEED_PATHS.has(path);

  return (
    <>
      {!fullBleed && (
        <header className="sticky top-0 z-30 backdrop-blur-md bg-bg-base/70 border-b border-line">
          <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
            <div className="flex items-center gap-10">
              <Link href="/" className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-gold-400 shadow-[0_0_12px_rgba(201,163,74,0.7)]" />
                <span className="font-display text-xl tracking-tightest">DOGE FORGE</span>
              </Link>
              <nav className="hidden sm:flex gap-7 text-sm text-ink-muted">
                <NavLink href="/mine">Mine</NavLink>
                <NavLink href="/trade">Trade</NavLink>
                <NavLink href="/id">Identity</NavLink>
                <NavLink href="/leaderboard">Leaderboard</NavLink>
                <NavLink href="/portfolio">Portfolio</NavLink>
              </nav>
            </div>
            <ConnectButton />
          </div>
        </header>
      )}

      <main className="max-w-6xl mx-auto px-6 py-14">{children}</main>

      <footer className="border-t border-line mt-20">
        <div className="max-w-6xl mx-auto px-6 py-8 text-xs text-ink-faint flex flex-wrap items-center justify-between gap-3">
          <span>DOGE FORGE · Tempo Chain</span>
          <div className="flex items-center gap-5">
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

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="hover:text-ink transition-colors">
      {children}
    </Link>
  );
}
