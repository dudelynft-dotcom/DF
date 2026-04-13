"use client";
import { useEffect, useRef, useState } from "react";

let mermaidInited = false;

export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("mermaid");
        const mermaid = mod.default;
        if (!mermaidInited) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "base",
            themeVariables: {
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              primaryColor: "#1F1C12",
              primaryTextColor: "#F5ECD0",
              primaryBorderColor: "#C9A34A",
              lineColor: "#C9A34A",
              tertiaryColor: "#17150E",
              background: "#0E0D08",
              edgeLabelBackground: "#17150E",
              clusterBkg: "#17150E",
              clusterBorder: "#C9A34A40",
              titleColor: "#E8D583",
              actorBkg: "#1F1C12",
              actorBorder: "#C9A34A",
              actorTextColor: "#F5ECD0",
              actorLineColor: "#C9A34A",
              signalColor: "#F5ECD0",
              signalTextColor: "#F5ECD0",
              labelTextColor: "#F5ECD0",
              loopTextColor: "#F5ECD0",
              noteBkgColor: "#1F1C12",
              noteTextColor: "#F5ECD0",
              noteBorderColor: "#C9A34A40",
              pie1: "#C9A34A",
              pie2: "#B28A36",
              pie3: "#8B6B28",
              pie4: "#5A4A28",
            },
          });
          mermaidInited = true;
        }
        const id = "mmd-" + Math.random().toString(36).slice(2);
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) {
          // Force the SVG to be responsive: strip fixed pixel width/height and
          // let CSS size it to the container.
          const responsive = svg
            .replace(/\swidth="[^"]*"/, "")
            .replace(/\sheight="[^"]*"/, "")
            .replace(/<svg /, '<svg style="width:100%;height:auto;max-width:100%;" ');
          ref.current.innerHTML = responsive;
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <pre className="my-4 p-4 rounded-lg bg-red-500/5 border border-red-500/30 text-xs text-red-300 overflow-auto">
        Diagram error: {error}
        {"\n\n"}
        {code}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="my-6 w-full overflow-x-auto py-4 px-3 rounded-xl bg-bg-base border border-line"
    />
  );
}
