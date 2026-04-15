"use client";
import Link from "next/link";
import { useState } from "react";

export type TaskCardData = {
  id:          number;
  slug:        string;
  kind:        "social" | "trade" | "mine" | "identity" | "daily" | "quiz";
  title:       string;
  description: string;
  points:      number;
  maxCompletions: number;
  payload:     Record<string, unknown>;
  completion:  { n: number; lastAt: number } | null;
};

const KIND_LABEL: Record<TaskCardData["kind"], string> = {
  social: "Social", trade: "Trade", mine: "Mine",
  identity: "Identity", daily: "Daily", quiz: "Quiz",
};

const KIND_TONE: Record<TaskCardData["kind"], string> = {
  social:   "border-sky-400/30   text-sky-300",
  trade:    "border-emerald-400/30 text-emerald-300",
  mine:     "border-gold-400/40   text-gold-300",
  identity: "border-purple-400/30 text-purple-300",
  daily:    "border-amber-400/30  text-amber-300",
  quiz:     "border-pink-400/30   text-pink-300",
};

export function TaskCard({
  task, onClaimed, disabled, progressUsd,
}: {
  task: TaskCardData;
  onClaimed: (awarded: number, total: number) => void;
  disabled?: boolean;
  /** For trade/mine tasks: current USD volume the user has accumulated. */
  progressUsd?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  const isDaily       = task.maxCompletions === -1;
  const completedOnce = !!task.completion && task.completion.n > 0;
  const todayKey      = new Date().toISOString().slice(0, 10);
  const completedToday = isDaily && task.completion && (() => {
    const last = new Date(task.completion!.lastAt * 1000).toISOString().slice(0, 10);
    return last === todayKey;
  })();
  const status: "done" | "today" | "open" = completedToday
    ? "today"
    : completedOnce && !isDaily
    ? "done"
    : "open";

  const [tweetUrl, setTweetUrl] = useState("");

  const submit = async (extra?: Record<string, unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/community/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: task.slug, extra }),
      });
      const j = await res.json();
      if (!j?.ok) {
        setErr(friendly(j?.reason, j?.meta));
        return;
      }
      onClaimed(j.awarded ?? 0, j.total ?? 0);
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const onClaim = () => submit();
  const onSubmitTweet = () => {
    if (!tweetUrl.trim()) { setErr("Paste your tweet URL first."); return; }
    submit({ tweetUrl: tweetUrl.trim() });
  };

  return (
    <div className={`
      group rounded-xl border p-4 sm:p-5 transition-colors
      ${status === "done" || status === "today"
        ? "border-emerald-500/30 bg-emerald-500/[0.04]"
        : "border-line bg-bg-surface/40 hover:border-gold-400/40"}
    `}>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border ${KIND_TONE[task.kind]}`}>
              {KIND_LABEL[task.kind]}
            </span>
            <span className="font-display text-gold-400 text-sm tabular">
              +{task.points.toLocaleString()} pts
            </span>
            {isDaily && <span className="text-[10px] text-ink-faint uppercase tracking-[0.2em]">Daily</span>}
          </div>
          <h3 className="mt-2 font-medium text-ink leading-tight">{task.title}</h3>
          <p className="mt-1 text-sm text-ink-muted leading-relaxed">{task.description}</p>

          {/* Progress bar — only on trade/mine tier tasks where we know
              the threshold and have a live USDC volume number. */}
          {(task.kind === "trade" || task.kind === "mine") && typeof progressUsd === "number" &&
            typeof (task.payload as { thresholdUsd?: number })?.thresholdUsd === "number" && (
            <Progress
              progressUsd={progressUsd}
              thresholdUsd={(task.payload as { thresholdUsd: number }).thresholdUsd}
            />
          )}

          {err && (
            <div className="mt-2 text-xs text-red-300">{err}</div>
          )}
        </div>

        <div className="shrink-0">
          {status === "done" || status === "today" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs">
              <Check /> {status === "today" ? "Today" : "Claimed"}
            </span>
          ) : task.slug === "quiz-whitepaper" ? (
            <Link
              href="/quiz"
              className="
                px-4 py-2 rounded-md text-sm font-medium transition-colors
                bg-gold-400 text-bg-base hover:bg-gold-300
              "
            >
              Start →
            </Link>
          ) : task.slug === "daily-tweet" ? (
            // Tweet URL form — wider so it gets its own row on mobile.
            <div className="hidden sm:flex items-center gap-2">
              <input
                type="url"
                value={tweetUrl}
                onChange={(e) => setTweetUrl(e.target.value)}
                placeholder="https://x.com/you/status/…"
                className="
                  w-64 px-3 py-2 rounded-md text-xs bg-bg-base
                  border border-line text-ink placeholder:text-ink-faint
                  focus:outline-none focus:border-gold-400/60
                "
              />
              <button
                onClick={onSubmitTweet}
                disabled={busy || disabled}
                className="
                  px-3 py-2 rounded-md text-sm font-medium transition-colors
                  bg-gold-400 text-bg-base hover:bg-gold-300
                  disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                {busy ? "…" : "Submit"}
              </button>
            </div>
          ) : (
            <button
              onClick={onClaim}
              disabled={busy || disabled}
              className="
                px-4 py-2 rounded-md text-sm font-medium transition-colors
                bg-gold-400 text-bg-base hover:bg-gold-300
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              {busy ? "…" : "Claim"}
            </button>
          )}
        </div>
      </div>

      {/* Mobile-only tweet form, full-width row under the description. */}
      {task.slug === "daily-tweet" && status === "open" && (
        <div className="sm:hidden mt-3 flex gap-2">
          <input
            type="url"
            value={tweetUrl}
            onChange={(e) => setTweetUrl(e.target.value)}
            placeholder="Paste tweet URL"
            className="
              flex-1 min-w-0 px-3 py-2 rounded-md text-xs bg-bg-base
              border border-line text-ink placeholder:text-ink-faint
              focus:outline-none focus:border-gold-400/60
            "
          />
          <button
            onClick={onSubmitTweet}
            disabled={busy || disabled}
            className="
              px-3 py-2 rounded-md text-sm font-medium transition-colors
              bg-gold-400 text-bg-base hover:bg-gold-300
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {busy ? "…" : "Submit"}
          </button>
        </div>
      )}
    </div>
  );
}

function friendly(reason?: string, meta?: Record<string, unknown>): string {
  switch (reason) {
    case "user_not_bound":          return "Bind your wallet first (Connect page).";
    case "max_completions_reached": return "Already claimed.";
    case "already_today":           return "Come back tomorrow.";
    case "no_name_yet":             return (meta?.hint as string) ?? "Claim your .fdoge identity first.";
    case "names_address_unset":     return "Identity contract not configured. Backend env missing.";
    case "indexer_not_live":        return "On-chain verification ships in step 5.";
    case "below_threshold":         return `Need $${meta?.thresholdUsd} total — you have $${meta?.progressUsd}. Indexer updates ~12s.`;
    case "tweet_verification_not_live": return "Tweet check ships in step 6.";
    case "missing_tweet_url":       return "Paste your tweet URL.";
    case "bad_tweet_url":           return "That doesn't look like a tweet URL.";
    case "tweet_already_claimed":   return "That tweet was already used.";
    case "x_bearer_unset":          return "Backend X bearer token not configured.";
    case "x_api_error":             return "X API rejected the lookup.";
    case "x_api_unreachable":       return "Couldn't reach X. Try again.";
    case "oembed_error":            return "X didn't return the tweet. Check the URL.";
    case "oembed_unreachable":      return "Couldn't reach X. Try again.";
    case "tweet_not_found":         return "Tweet not found or private.";
    case "wrong_author":            return "That tweet isn't from your linked X account.";
    case "tweet_too_old":           return "Tweet must be from the last 24 hours.";
    case "tweet_in_future":         return "Clock skew detected. Try again.";
    case "missing_tokens":          return `Missing required tokens: ${(meta?.missing as string[] ?? []).join(", ")}`;
    case "quiz_not_live":           return "Quiz lands in step 9.";
    case "rpc_error":               return "Couldn't reach the chain. Try again in a moment.";
    case "not_authenticated":       return "Session expired. Reconnect.";
    default:                        return reason ?? "Something went wrong.";
  }
}

function Check() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function Progress({ progressUsd, thresholdUsd }: { progressUsd: number; thresholdUsd: number }) {
  const pct = Math.min(100, Math.max(0, (progressUsd / thresholdUsd) * 100));
  const done = progressUsd >= thresholdUsd;
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className={done ? "text-emerald-300" : "text-ink-muted"}>
          ${progressUsd.toLocaleString()} / ${thresholdUsd.toLocaleString()}
        </span>
        <span className="text-ink-faint tabular">{Math.floor(pct)}%</span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full transition-[width] duration-500 ${done ? "bg-emerald-400" : "bg-gold-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
