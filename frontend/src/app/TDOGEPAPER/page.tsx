import fs from "node:fs/promises";
import path from "node:path";
import { Markdown } from "@/components/Markdown";

// Always render server-side; the file lives outside `frontend/`.
export const dynamic = "force-static";
export const revalidate = 60; // re-read every minute in dev

export const metadata = {
  title: "DOGE FORGE Whitepaper",
  description: "fDOGE protocol design, mechanics, security, and economics.",
};

async function loadWhitepaper(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), "..", "WHITEPAPER.md"),
    path.join(process.cwd(), "WHITEPAPER.md"),
  ];
  for (const p of candidates) {
    try {
      return await fs.readFile(p, "utf8");
    } catch {
      // try next
    }
  }
  return "# Whitepaper not found\n\nPlace `WHITEPAPER.md` at the repository root.";
}

export default async function TdogePaperPage() {
  const source = await loadWhitepaper();
  return (
    <article className="max-w-3xl mx-auto pb-24 overflow-x-hidden">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold-400/80">Document</p>
        <h1 className="font-display text-4xl sm:text-5xl tracking-tightest mt-3">fDOGE Paper</h1>
        <p className="text-ink-muted mt-3 text-sm max-w-xl">
          Full protocol specification. Architecture, tokenomics, mining, liquidity,
          identity, and security model. Updated alongside the codebase.
        </p>
      </div>
      <Markdown source={source} />
    </article>
  );
}
