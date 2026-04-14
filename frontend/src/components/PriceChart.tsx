"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";

type Candle = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  trades: number;
};

type Props = {
  /// Pair contract address the backend is indexing. Omit to show the empty state.
  pair?: `0x${string}`;
  /// Candle interval (1m, 5m, 15m, 1h, 4h, 1d). Default 1h.
  interval?: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  className?: string;
};

export function PriceChart({ pair, interval = "1h", className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "empty" | "ok">("idle");

  // Create the chart once. Re-create on theme / container resize not required
  // because lightweight-charts handles its own canvas invalidation.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { color: "transparent" },
        textColor:  "#a09682",
        // Hide the "TV" attribution logo introduced in v5.
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1b1b1d" },
        horzLines: { color: "#1b1b1d" },
      },
      rightPriceScale: { borderColor: "#2a2a2e" },
      timeScale:       { borderColor: "#2a2a2e", timeVisible: true, secondsVisible: false },
      crosshair:       { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor:       "#86efac",
      downColor:     "#f87171",
      borderUpColor: "#86efac",
      borderDownColor: "#f87171",
      wickUpColor:   "#86efac",
      wickDownColor: "#f87171",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.resize(
        containerRef.current.clientWidth,
        containerRef.current.clientHeight,
      );
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Fetch candles when pair / interval changes, and poll every 30s.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!pair) {
      series.setData([]);
      // Reset autoscale so next token starts fresh instead of inheriting the
      // previous token's price range.
      chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
      chartRef.current?.timeScale().resetTimeScale();
      setState("idle");
      return;
    }
    const base = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!base) { setState("empty"); return; }
    let cancelled = false;

    async function fetchCandles() {
      try {
        setState((s) => s === "ok" ? s : "loading");
        const r = await fetch(`${base}/prices/${pair}?interval=${interval}&limit=300`);
        if (!r.ok) { setState("empty"); return; }
        const j = await r.json() as { candles: Candle[] };
        if (cancelled) return;
        if (!j.candles || j.candles.length === 0) {
          series!.setData([]);
          setState("empty");
          return;
        }
        series!.setData(
          j.candles.map((c) => ({
            time:  c.time as UTCTimestamp,
            open:  c.open,
            high:  c.high,
            low:   c.low,
            close: c.close,
          })),
        );
        chartRef.current?.timeScale().fitContent();
        setState("ok");
      } catch {
        if (!cancelled) setState("empty");
      }
    }

    fetchCandles();
    const id = setInterval(fetchCandles, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pair, interval]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {state !== "ok" && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-faint text-xs pointer-events-none">
          {state === "loading" ? "Loading chart…"
            : state === "empty" ? "No swap history yet for this market."
            : "Chart not available for this market."}
        </div>
      )}
    </div>
  );
}
