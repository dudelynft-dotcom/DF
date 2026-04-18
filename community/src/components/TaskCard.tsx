"use client";
import Link from "next/link";
import { useState } from "react";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";

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

const TG_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

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
  task, onClaimed, disabled, progressUsd, progressUnit = "usd", telegramLinked, onTelegramLinked,
}: {
  task: TaskCardData;
  onClaimed: (awarded: number, total: number) => void;
  disabled?: boolean;
  /** Current progress value. Interpreted per progressUnit. */
  progressUsd?: number;
  /** "usd" = $-prefixed dollars, "fdoge" = "N fDOGE" token amount. */
  progressUnit?: "usd" | "fdoge";
  /** True once the user has linked their Telegram (from /community/me). */
  telegramLinked?: boolean;
  onTelegramLinked?: () => void;
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
      group rounded-xl border p-3 sm:p-5 transition-colors
      ${status === "done" || status === "today"
        ? "border-emerald-500/30 bg-emerald-500/[0.04]"
        : "border-line bg-bg-surface/40 hover:border-gold-400/40"}
    `}>
      <div className="space-y-3 sm:space-y-0 sm:flex sm:items-start sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span className={`text-[9px] sm:text-[10px] uppercase tracking-[0.2em] px-1.5 sm:px-2 py-0.5 rounded-full border ${KIND_TONE[task.kind]}`}>
              {KIND_LABEL[task.kind]}
            </span>
            <span className="font-display text-gold-400 text-xs sm:text-sm tabular">
              +{task.points.toLocaleString()} pts
            </span>
            {isDaily && <span className="text-[9px] sm:text-[10px] text-ink-faint uppercase tracking-[0.2em]">Daily</span>}
          </div>
          <h3 className="mt-1.5 sm:mt-2 font-medium text-ink text-sm sm:text-base leading-tight">{task.title}</h3>
          <p className="mt-1 text-xs sm:text-sm text-ink-muted leading-relaxed">{task.description}</p>

          {/* Progress bar — trade/mine tier tasks. Threshold is either
              thresholdUsd (USDC volume or LP tasks) or thresholdFdoge
              (buy-fDOGE tasks); the parent routes which field to pass. */}
          {(task.kind === "trade" || task.kind === "mine") && typeof progressUsd === "number" && (() => {
            const pl = task.payload as { thresholdUsd?: number; thresholdFdoge?: number };
            const threshold = progressUnit === "fdoge" ? pl.thresholdFdoge : pl.thresholdUsd;
            if (typeof threshold !== "number") return null;
            return (
              <Progress
                progress={progressUsd}
                threshold={threshold}
                unit={progressUnit}
              />
            );
          })()}

          {err && (
            <div className="mt-2 text-xs text-red-300">{err}</div>
          )}
        </div>

        <div className="shrink-0 sm:self-start">
          {status === "done" || status === "today" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs">
              <Check /> {status === "today" ? "Today" : "Claimed"}
            </span>
          ) : (task.slug === "join-tg-channel" || task.slug === "join-tg-group") ? (
            <TelegramCta
              task={task}
              telegramLinked={!!telegramLinked}
              busy={busy}
              onLink={onTelegramLinked}
              onClaim={onClaim}
            />
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
          ) : (task.payload as { url?: string })?.url ? (
            // Generic social task with an action URL (follow link, tweet
            // to retweet, etc.). Show "Open ↗" to go do the thing, then
            // "Claim" on return.
            <div className="flex items-center gap-2">
              <a
                href={(task.payload as { url: string }).url}
                target="_blank" rel="noreferrer"
                className="
                  px-3 py-2 rounded-md text-sm font-medium transition-colors
                  border border-line text-ink hover:border-gold-400/60 hover:bg-white/5
                "
              >
                Open ↗
              </a>
              <button
                onClick={onClaim}
                disabled={busy || disabled}
                className="
                  px-4 py-2 rounded-md text-sm font-medium transition-colors
                  bg-gold-400 text-bg-base hover:bg-gold-300
                  disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                {busy ? (<span className="inline-flex items-center gap-1.5"><Spinner /> Verifying</span>) : "Claim"}
              </button>
            </div>
          ) : task.slug === "daily-tweet" ? (
            // Tweet URL form — wider so it gets its own row on mobile.
            <div className="hidden sm:flex items-center gap-2">
              <input
                type="url"
                value={tweetUrl}
                onChange={(e) => setTweetUrl(e.target.value)}
                placeholder="https://x.com/you/status/…"
                className="
                  w-48 lg:w-64 px-3 py-2 rounded-md text-xs bg-bg-base
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
                {busy ? (<span className="inline-flex items-center gap-1.5"><Spinner /> Checking</span>) : "Submit"}
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
              {busy ? (<span className="inline-flex items-center gap-1.5"><Spinner /> Verifying</span>) : "Claim"}
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
            {busy ? (<span className="inline-flex items-center gap-1.5"><Spinner /> Checking</span>) : "Submit"}
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
    case "below_threshold": {
      // Unit depends on the task: buy-fDOGE uses thresholdFdoge/progressFdoge
      // (token amounts), everything else uses thresholdUsd/progressUsd.
      if (typeof meta?.thresholdFdoge === "number") {
        return `Need ${meta.thresholdFdoge} fDOGE total — you have ${meta.progressFdoge ?? 0} fDOGE. Indexer updates ~12s.`;
      }
      return `Need $${meta?.thresholdUsd} total — you have $${meta?.progressUsd}. Indexer updates ~12s.`;
    }
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
    case "rate_limited":            return "Slow down — too many claims in a minute.";
    case "telegram_not_linked":     return "Link your Telegram first (button above).";
    case "not_in_chat":              return "You're not a member of that chat yet.";
    case "chat_not_configured":      return "Chat not configured on backend.";
    case "telegram_api_error":       return "Telegram API rejected the check.";
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

function TelegramCta({
  task, telegramLinked, busy, onClaim, onLink,
}: {
  task: TaskCardData;
  telegramLinked: boolean;
  busy: boolean;
  onClaim: () => void;
  onLink?: () => void;
}) {
  const url = (task.payload as { url?: string })?.url;

  // Not linked yet → directly render the Telegram Login Widget so the
  // user can link in place without leaving the dashboard.
  if (!telegramLinked) {
    if (!TG_BOT_USERNAME) {
      return <span className="text-xs text-amber-300">TG bot not configured</span>;
    }
    return (
      <div className="flex items-center gap-2">
        <TelegramLoginButton
          botUsername={TG_BOT_USERNAME}
          disabled={busy}
          onLinked={() => onLink?.()}
        />
      </div>
    );
  }

  // Linked → show "Open chat" + "Claim".
  return (
    <div className="flex items-center gap-2">
      {url && (
        <a
          href={url}
          target="_blank" rel="noreferrer"
          className="
            px-3 py-2 rounded-md text-sm font-medium transition-colors
            border border-line text-ink hover:border-gold-400/60 hover:bg-white/5
          "
        >
          Open ↗
        </a>
      )}
      <button
        onClick={onClaim}
        disabled={busy}
        className="
          px-4 py-2 rounded-md text-sm font-medium transition-colors
          bg-gold-400 text-bg-base hover:bg-gold-300
          disabled:opacity-50 disabled:cursor-not-allowed
        "
      >
        {busy ? (<span className="inline-flex items-center gap-1.5"><Spinner /> Verifying</span>) : "Claim"}
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Progress({ progress, threshold, unit = "usd" }: { progress: number; threshold: number; unit?: "usd" | "fdoge" }) {
  const pct = Math.min(100, Math.max(0, (progress / threshold) * 100));
  const done = progress >= threshold;
  const fmt = (n: number) => unit === "fdoge"
    ? `${n.toLocaleString()} fDOGE`
    : `$${n.toLocaleString()}`;
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className={done ? "text-emerald-300" : "text-ink-muted"}>
          {fmt(progress)} / {fmt(threshold)}
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
