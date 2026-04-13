"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mermaid } from "./Mermaid";

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose-tdoge max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl tracking-tightest mt-10 sm:mt-12 mb-4 sm:mb-6 text-ink break-words" {...p} />,
          h2: (p) => <h2 className="font-display text-2xl sm:text-3xl tracking-tight mt-10 sm:mt-12 mb-3 sm:mb-4 text-ink border-b border-line pb-2 break-words" {...p} />,
          h3: (p) => <h3 className="font-display text-lg sm:text-xl tracking-tight mt-6 sm:mt-8 mb-2 sm:mb-3 text-gold-300 break-words" {...p} />,
          h4: (p) => <h4 className="font-display text-base sm:text-lg mt-5 sm:mt-6 mb-2 text-ink" {...p} />,
          p: (p) => <p className="leading-relaxed my-4 text-ink-muted" {...p} />,
          a: (p) => <a className="text-gold-300 hover:text-gold-200 underline underline-offset-2" {...p} />,
          strong: (p) => <strong className="text-ink font-semibold" {...p} />,
          em: (p) => <em className="text-ink-muted italic" {...p} />,
          ul: (p) => <ul className="list-disc list-outside ml-6 my-4 space-y-1 text-ink-muted" {...p} />,
          ol: (p) => <ol className="list-decimal list-outside ml-6 my-4 space-y-1 text-ink-muted" {...p} />,
          li: (p) => <li className="leading-relaxed" {...p} />,
          blockquote: (p) => (
            <blockquote className="my-6 pl-4 border-l-2 border-gold-400/60 text-ink-muted italic" {...p} />
          ),
          hr: () => <div className="my-12 hairline" />,
          table: (p) => (
            <div className="my-6 overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-bg-raised text-ink-faint" {...p} />,
          th: (p) => <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] font-medium" {...p} />,
          td: (p) => <td className="px-4 py-3 border-t border-line text-ink-muted" {...p} />,
          pre: (p) => (
            <pre
              className="my-4 p-4 rounded-lg bg-bg-base border border-line overflow-x-auto max-w-full text-[11px] sm:text-[12px] tabular text-ink whitespace-pre"
              {...p}
            />
          ),
          code: ({ className, children, ...rest }) => {
            const lang = /language-(\w+)/.exec(className || "")?.[1];
            const text = String(children ?? "").replace(/\n$/, "");
            if (lang === "mermaid") {
              return <Mermaid code={text} />;
            }
            // Block code: react-markdown wraps it in <pre>, so it carries a className
            // OR the content spans multiple lines. In that case render plain <code> and
            // let the <pre> override above provide the scroll container + styling.
            const isBlock = !!className || text.includes("\n");
            if (isBlock) {
              return <code className={className} {...rest}>{children}</code>;
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded bg-bg-base border border-line text-[12px] tabular text-gold-200 break-words"
                style={{ wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "normal" }}
                {...rest}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
