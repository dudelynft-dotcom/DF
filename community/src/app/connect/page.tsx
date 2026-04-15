"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BindWallet } from "@/components/BindWallet";

type Me = {
  xId: string;
  xHandle: string;
  xName?: string;
  xAvatar?: string;
  wallet: `0x${string}` | null;
} | null;

// The real connect funnel. Two steps, revealed in order:
//   1. Connect X   — delegates to /api/auth/x/login
//   2. Bind wallet — gated on session from /api/auth/me
//
// All state lives server-side; this page just reads /api/auth/me.
export default function Connect() {
  const [me, setMe] = useState<Me | undefined>(undefined);
  const search = useSearchParams();
  const err = search.get("err");

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setMe(j as Me))
      .catch(() => setMe(null));
  }, []);

  return (
    <section className="bg-hero-glow">
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-20">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90 text-center">
          Get started
        </p>
        <h1 className="mt-4 font-display text-4xl tracking-tight text-center">
          Two steps. Then you&apos;re in.
        </h1>

        {err && <ErrBanner err={err} />}

        <div className="mt-10 space-y-4">
          {/* Step 1 — X */}
          <Card
            step="1"
            title="Connect X"
            body="Sign in with your X account. We only read your handle and account age. No posts, no DMs."
            status={
              me === undefined ? "loading" :
              me ? "done" : "idle"
            }
          >
            {me === undefined ? (
              <Skeleton />
            ) : me ? (
              <BoundPill label={`@${me.xHandle}`} avatar={me.xAvatar} />
            ) : (
              <a
                href="/api/auth/x/login"
                className="
                  inline-flex items-center gap-2 px-4 py-2 rounded-md
                  bg-gold-400 text-bg-base text-sm font-medium
                  hover:bg-gold-300 transition-colors
                "
              >
                <XGlyph /> Connect X
              </a>
            )}
          </Card>

          {/* Step 2 — Wallet */}
          <Card
            step="2"
            title="Bind your Arc wallet"
            body="Sign a gas-free message to link your wallet. One X, one wallet. You can always change it later by re-binding from settings."
            status={
              me === undefined ? "loading" :
              !me ? "locked" :
              me.wallet ? "done" : "idle"
            }
          >
            {me === undefined ? (
              <Skeleton />
            ) : !me ? (
              <div className="text-xs text-ink-faint">Complete step 1 first.</div>
            ) : (
              <BindWallet
                xHandle={me.xHandle}
                xId={me.xId}
                initialBoundWallet={me.wallet}
                onBound={(w) => setMe({ ...me, wallet: w })}
              />
            )}
          </Card>
        </div>

        {/* Finished — send to tasks */}
        {me?.wallet && (
          <div className="mt-10 text-center">
            <Link
              href="/tasks"
              className="
                inline-flex items-center gap-2 px-5 py-3 rounded-lg
                bg-gold-400 text-bg-base font-medium
                hover:bg-gold-300 transition-colors
              "
            >
              Enter the forge →
            </Link>
          </div>
        )}

        <div className="mt-10 text-center">
          <Link href="/" className="text-sm text-ink-muted hover:text-ink transition-colors">
            ← Back
          </Link>
        </div>
      </div>
    </section>
  );
}

function Card({
  step, title, body, status, children,
}: {
  step: string; title: string; body: string;
  status: "idle" | "done" | "locked" | "loading";
  children: React.ReactNode;
}) {
  return (
    <div className={`
      rounded-xl border p-5 transition-colors
      ${status === "done"   ? "border-emerald-500/30 bg-emerald-500/5" :
        status === "locked" ? "border-line bg-bg-surface/30 opacity-60" :
        "border-line bg-bg-surface/60"}
    `}>
      <div className="flex items-start gap-4">
        <div className={`
          shrink-0 h-9 w-9 rounded-md border flex items-center justify-center font-display
          ${status === "done" ? "border-emerald-500/50 text-emerald-400" :
            "border-gold-400/40 text-gold-400"}
        `}>
          {status === "done" ? <Check /> : step}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-ink">{title}</div>
          <p className="mt-1 text-sm text-ink-muted leading-relaxed">{body}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ErrBanner({ err }: { err: string }) {
  const msg: Record<string, string> = {
    denied:           "You declined the X authorization.",
    missing_code:     "X didn't return an authorization code. Try again.",
    bad_state:        "Session expired mid-flow. Try again.",
    x_api_error:      "X rejected the token exchange. Check the app credentials.",
    account_too_young: "Your X account must be at least 30 days old to participate.",
  };
  return (
    <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm text-red-300">
      {msg[err] ?? "Something went wrong. Try again."}
    </div>
  );
}

function BoundPill({ label, avatar }: { label: string; avatar?: string }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-sm">
      {avatar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="h-5 w-5 rounded-full" />
      )}
      <span className="text-ink">{label}</span>
      <Check />
    </div>
  );
}

function Skeleton() { return <div className="h-9 w-40 rounded-md bg-white/5 animate-pulse" />; }

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-emerald-400">
      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function XGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2H21l-6.56 7.5L22 22h-6.828l-4.76-6.22L4.8 22H2l7.02-8.02L2 2h6.914l4.32 5.73L18.244 2zm-2.4 18h1.9L7.3 4H5.3l10.545 16z"/>
    </svg>
  );
}
