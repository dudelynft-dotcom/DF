"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Question = { q: string; options: string[] };

// Whitepaper quiz. Five multiple-choice. All-or-nothing scoring.
// The user can retry indefinitely until they get all five right —
// the goal is engagement (reading the paper), not gating.
export default function Quiz() {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers,   setAnswers]   = useState<(number | null)[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; awarded: number; total: number }
    | { ok: false; wrongIndices: number[] }
    | null
  >(null);

  useEffect(() => {
    fetch("/api/community/quiz", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setQuestions(j.questions ?? []);
        setAnswers(new Array(j.questions?.length ?? 0).fill(null));
      });
  }, []);

  const allAnswered = answers.every((a) => a !== null);

  const onSubmit = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/community/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "quiz-whitepaper", extra: { answers } }),
      });
      const j = await res.json();
      if (j.ok) {
        setResult({ ok: true, awarded: j.awarded, total: j.total });
      } else if (j.reason === "wrong_answers") {
        setResult({ ok: false, wrongIndices: (j.meta?.wrongIndices ?? []) as number[] });
      } else if (j.reason === "max_completions_reached") {
        setResult({ ok: true, awarded: 0, total: 0 }); // already passed
      } else {
        setResult({ ok: false, wrongIndices: [] });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!questions) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <div className="h-8 w-40 rounded bg-white/5 animate-pulse" />
        <div className="mt-6 h-64 rounded-xl bg-white/5 animate-pulse" />
      </div>
    );
  }

  if (result?.ok) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-20 text-center">
        <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-400">Passed</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight">All five correct.</h1>
        {result.awarded > 0 ? (
          <p className="mt-4 text-ink-muted">+{result.awarded} points awarded. New total {result.total.toLocaleString()}.</p>
        ) : (
          <p className="mt-4 text-ink-muted">Already claimed previously.</p>
        )}
        <Link href="/tasks" className="
          mt-8 inline-flex items-center gap-2 px-5 py-3 rounded-lg
          bg-gold-400 text-bg-base font-medium hover:bg-gold-300 transition-colors
        ">
          Back to tasks →
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/90">Whitepaper quiz</p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight">5 questions, all-or-nothing</h1>
        </div>
        <a
          href="https://dogeforge.fun/TDOGEPAPER"
          target="_blank" rel="noreferrer"
          className="text-xs text-ink-muted hover:text-ink transition-colors"
        >
          Read the paper ↗
        </a>
      </div>
      {result && !result.ok && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {result.wrongIndices.length > 0
            ? `${result.wrongIndices.length} wrong (questions ${result.wrongIndices.map((i) => i + 1).join(", ")}). Re-read the paper and try again.`
            : "Submission failed. Try again."}
        </div>
      )}

      <div className="mt-8 space-y-6">
        {questions.map((q, i) => {
          const wrong = !result?.ok && (result as { wrongIndices?: number[] } | null)?.wrongIndices?.includes(i);
          return (
            <div key={i} className={`rounded-xl border p-5 ${wrong ? "border-red-500/40 bg-red-500/5" : "border-line bg-bg-surface/40"}`}>
              <div className="text-[11px] uppercase tracking-[0.25em] text-ink-faint">Q{i + 1} of {questions.length}</div>
              <div className="mt-2 font-medium text-ink">{q.q}</div>
              <ul className="mt-4 space-y-2">
                {q.options.map((opt, j) => {
                  const selected = answers[i] === j;
                  return (
                    <li key={j}>
                      <button
                        onClick={() => {
                          setAnswers((a) => { const n = [...a]; n[i] = j; return n; });
                          if (result && !result.ok) setResult(null);
                        }}
                        className={`
                          w-full text-left px-3 py-2 rounded-md text-sm transition-colors
                          border
                          ${selected
                            ? "border-gold-400/60 bg-gold-400/10 text-ink"
                            : "border-line text-ink-muted hover:border-gold-400/40 hover:text-ink hover:bg-white/5"}
                        `}
                      >
                        <span className="inline-block w-5 text-ink-faint mr-1">{String.fromCharCode(65 + j)}.</span>
                        {opt}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-3 justify-end">
        <Link href="/tasks" className="text-sm text-ink-muted hover:text-ink transition-colors">
          ← Cancel
        </Link>
        <button
          onClick={onSubmit}
          disabled={!allAnswered || submitting}
          className="
            px-5 py-2.5 rounded-md text-sm font-medium transition-colors
            bg-gold-400 text-bg-base hover:bg-gold-300
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          {submitting ? "Checking…" : "Submit answers"}
        </button>
      </div>
    </div>
  );
}
