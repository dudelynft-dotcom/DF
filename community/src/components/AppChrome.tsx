"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Top-level shell for the community app. Intentionally narrower than the
// main product's chrome: the community surface has fewer destinations and
// a stronger "connect-first" funnel.
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Gated routes get rendered but link state reflects whether the user is
  // actually logged in. The auth wiring lands in Step 2; for now these are
  // placeholders with an aria-disabled hint.
  const nav = [
    { href: "/tasks",        label: "Tasks",        gated: true  },
    { href: "/leaderboard",  label: "Leaderboard",  gated: false },
    { href: "/profile",      label: "Profile",      gated: true  },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg-base/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <DogeMark />
            <span className="font-display text-lg tracking-tight">
              <span className="text-ink">DOGE</span>{" "}
              <span className="text-gold-400">FORGE</span>
              <span className="text-ink-faint text-[11px] tracking-[0.3em] uppercase ml-2 hidden sm:inline">
                Community
              </span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 ml-6">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`
                  px-3 py-1.5 rounded-md text-sm transition-colors
                  ${pathname?.startsWith(n.href)
                    ? "text-ink bg-white/5"
                    : "text-ink-muted hover:text-ink hover:bg-white/5"}
                `}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <a
              href="https://dogeforge.fun"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline text-xs text-ink-faint hover:text-ink transition-colors"
            >
              ↗ dogeforge.fun
            </a>
            <ConnectPlaceholder />
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              className="md:hidden h-8 w-8 rounded-md border border-line flex items-center justify-center text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-line bg-bg-base">
            <nav className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-1">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setMenuOpen(false)}
                  className={`
                    px-3 py-2 rounded-md text-sm
                    ${pathname?.startsWith(n.href)
                      ? "text-ink bg-white/5"
                      : "text-ink-muted hover:text-ink hover:bg-white/5"}
                  `}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="border-t border-line mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 text-xs text-ink-faint">
          <div>
            <span className="text-ink-muted">DOGE FORGE Community · Season 1</span>
            <span className="mx-2">·</span>
            <span>Arc testnet</span>
          </div>
          <div className="sm:ml-auto flex items-center gap-4">
            <a href="https://dogeforge.fun" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors">
              Main app
            </a>
            <a href="https://dogeforge.fun/TDOGEPAPER" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors">
              Paper
            </a>
            <a href="https://twitter.com/dogeforge" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors">
              X / @dogeforge
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Session-aware header pill. Polls /api/auth/me on mount; if logged in,
// shows the user's X avatar + handle + a logout affordance. Otherwise
// routes the user to the /connect funnel.
type Me = { xHandle: string; xAvatar?: string; wallet: string | null } | null;

function ConnectPlaceholder() {
  const [me, setMe] = useState<Me | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setMe(j as Me))
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) {
    return <div className="h-8 w-24 rounded-md bg-white/5 animate-pulse" />;
  }

  if (me) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/profile"
          className="
            inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md
            border border-line bg-bg-surface/60 text-sm
            hover:border-gold-400/60 hover:bg-white/5 transition-colors
          "
        >
          {me.xAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.xAvatar} alt="" className="h-5 w-5 rounded-full" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-gold-400/10 border border-gold-400/30" />
          )}
          <span className="text-ink hidden sm:inline">@{me.xHandle}</span>
          {me.wallet ? <Dot color="emerald" title="Wallet bound" /> : <Dot color="amber" title="Bind wallet" />}
        </Link>
      </div>
    );
  }

  return (
    <Link
      href="/connect"
      className="
        inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
        bg-gold-400 text-bg-base hover:bg-gold-300 transition-colors
      "
    >
      <XGlyph />
      <span className="hidden sm:inline">Connect X</span>
      <span className="sm:hidden">Connect</span>
    </Link>
  );
}

function Dot({ color, title }: { color: "emerald" | "amber"; title: string }) {
  const cls = color === "emerald" ? "bg-emerald-400" : "bg-amber-400";
  return <span title={title} className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`} />;
}

function DogeMark() {
  // Small inline logo to avoid a raster request on first paint. Matches
  // the monogram pfp direction.
  return (
    <div className="relative h-7 w-7 rounded-full border border-gold-400/80 flex items-center justify-center bg-gradient-to-br from-bg-surface to-bg-base">
      <span className="font-display text-[11px] text-gold-400 leading-none">DF</span>
    </div>
  );
}

function XGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2H21l-6.56 7.5L22 22h-6.828l-4.76-6.22L4.8 22H2l7.02-8.02L2 2h6.914l4.32 5.73L18.244 2zm-2.4 18h1.9L7.3 4H5.3l10.545 16z"/>
    </svg>
  );
}
