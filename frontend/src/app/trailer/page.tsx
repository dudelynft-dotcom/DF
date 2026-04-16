"use client";
import { useEffect, useRef, useState } from "react";

// Standalone 20-second brand trailer. Renders to a single Canvas 2D
// surface (no DOM), so MediaRecorder.captureStream() produces a
// clean, pixel-perfect WebM without any screen recording.
//
// Workflow:
//   1. Wait for brand fonts to load
//   2. Click "Record" → canvas animates 20s while MediaRecorder
//      captures the stream at 30fps
//   3. Recorder stops automatically, shows download link
//   4. User downloads the .webm, converts to .mp4 via CloudConvert
//      or similar (X doesn't accept WebM directly)
//
// Square 1080x1080 so it looks good in both X desktop (16:9 crop
// keeps the centre visible) and mobile (1:1 native).

const W = 1080;
const H = 1080;
const FPS = 30;
const DURATION = 20; // seconds

// Brand palette — kept local so this file is fully portable.
const BG      = "#0E0D08";
const SURFACE = "#17150E";
const GOLD    = "#C9A34A";
const GOLD_HI = "#F3C45A";
const CREAM   = "#F5ECD0";
const MUTED   = "rgba(245, 236, 208, 0.62)";

// ---- Easing ----
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export default function Trailer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const [fontsReady, setFontsReady] = useState(false);
  const [mode, setMode] = useState<"idle" | "preview" | "recording" | "done">("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Ensure the fonts are loaded before we draw, else first frames
    // fall back to browser default and the recording is garbage.
    if (typeof document !== "undefined" && document.fonts) {
      Promise.all([
        document.fonts.load("700 120px Fraunces"),
        document.fonts.load("700 48px Inter"),
      ]).then(() => setFontsReady(true));
    } else {
      setFontsReady(true);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      recorderRef.current?.stop();
    };
  }, []);

  // Once fonts are ready, paint a static first-frame so the user
  // sees the brand surface rather than a blank white box.
  useEffect(() => {
    if (!fontsReady) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawFrame(ctx, 0);
  }, [fontsReady]);

  const stopLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const loop = () => {
    const t = (performance.now() - startRef.current) / 1000;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (t >= DURATION) {
      drawFrame(canvas.getContext("2d")!, DURATION);
      setProgress(1);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      stopLoop();
      return;
    }
    drawFrame(canvas.getContext("2d")!, t);
    setProgress(t / DURATION);
    rafRef.current = requestAnimationFrame(loop);
  };

  const preview = () => {
    if (!canvasRef.current) return;
    setMode("preview");
    setProgress(0);
    startRef.current = performance.now();
    loop();
  };

  const record = () => {
    if (!canvasRef.current) return;
    setDownloadUrl(null);
    chunksRef.current = [];
    setMode("recording");
    setProgress(0);

    // captureStream at the canvas's redraw rate; we explicitly pass
    // FPS so the recorder samples predictably.
    const stream = canvasRef.current.captureStream(FPS);
    // vp9 gives better quality than vp8 for the same bitrate. Falls
    // back if the browser lacks it.
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000, // 8 Mbps — generous for a 20s clip
    });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setMode("done");
    };
    recorderRef.current = recorder;
    recorder.start();

    startRef.current = performance.now();
    loop();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl tracking-tight">Launch trailer</h1>
      <p className="mt-2 text-ink-muted text-sm max-w-2xl">
        Renders a 20s brand trailer directly in your browser.
        Click <strong className="text-ink">Record</strong> → wait 20 seconds →
        download the WebM. Convert to MP4 at{" "}
        <a href="https://cloudconvert.com/webm-to-mp4" target="_blank" rel="noreferrer" className="text-gold-300 hover:text-gold-200 underline">cloudconvert.com/webm-to-mp4</a>{" "}
        before uploading to X (X doesn&apos;t accept WebM).
      </p>

      <div className="mt-6 relative mx-auto" style={{ maxWidth: 540 }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="w-full aspect-square rounded-xl border border-line bg-bg-base"
        />
        {/* Progress bar */}
        {mode !== "idle" && (
          <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full bg-gold-400 transition-[width] duration-100"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3 justify-center">
        <button
          onClick={preview}
          disabled={!fontsReady || mode === "preview" || mode === "recording"}
          className="px-5 py-2.5 rounded-md border border-line text-sm hover:border-gold-400/60 disabled:opacity-50"
        >
          {mode === "preview" ? "Playing…" : "Preview (no recording)"}
        </button>
        <button
          onClick={record}
          disabled={!fontsReady || mode === "recording"}
          className="px-5 py-2.5 rounded-md bg-gold-400 text-bg-base text-sm font-medium hover:bg-gold-300 disabled:opacity-50"
        >
          {mode === "recording" ? `Recording… ${Math.floor(progress * DURATION)}s` : "Record + Download"}
        </button>
        {downloadUrl && (
          <a
            href={downloadUrl}
            download={`doge-forge-trailer-${Date.now()}.webm`}
            className="px-5 py-2.5 rounded-md border border-emerald-500/40 text-emerald-300 text-sm hover:bg-emerald-500/10"
          >
            ↓ Download .webm
          </a>
        )}
      </div>

      <p className="mt-8 text-xs text-ink-faint text-center max-w-md mx-auto">
        Canvas renders at 1080×1080, 30 fps, 8 Mbps. X reencodes on upload
        so it&apos;s fine to convert WebM → MP4 without quality tweaking.
      </p>
    </div>
  );
}

// ============================================================
//                       DRAWING
// ============================================================

function drawFrame(ctx: CanvasRenderingContext2D, t: number) {
  // Base fill
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Subtle vignette so text reads better on a flat bg
  const grd = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
  grd.addColorStop(0, "rgba(255,255,255,0.02)");
  grd.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // Scene dispatch — each scene is passed its LOCAL time (0..length).
  if (t < 2)          sceneIntro(ctx, t);
  else if (t < 4.5)   sceneTagline(ctx, t - 2,   2.5, "Mine fDOGE.");
  else if (t < 7)     sceneTagline(ctx, t - 4.5, 2.5, "Trade on Arc.");
  else if (t < 10)    sceneTagline(ctx, t - 7,   3,   "Build your identity.");
  else if (t < 14)    sceneTriptych(ctx, t - 10, 4);
  else if (t < 17)    scenePoints(ctx, t - 14,   3);
  else                sceneOutro(ctx, t - 17,    3);

  // Subtle bottom watermark present throughout — grounds the frame
  ctx.font   = '500 20px Inter, system-ui';
  ctx.fillStyle = "rgba(245,236,208,0.35)";
  ctx.textAlign    = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("community.dogeforge.fun", W / 2, H - 40);
}

// --- Scene 1: intro (0..2s) ---
function sceneIntro(ctx: CanvasRenderingContext2D, t: number) {
  // Sweep of a gold spark across centre — fades out as monogram appears
  const sweepProg = Math.min(1, t / 0.9);
  if (sweepProg < 1) {
    const x = -200 + (W + 400) * easeOutCubic(sweepProg);
    const grad = ctx.createLinearGradient(x - 200, H / 2, x + 200, H / 2);
    grad.addColorStop(0,    "rgba(201,163,74,0)");
    grad.addColorStop(0.5,  "rgba(243,196,90,0.9)");
    grad.addColorStop(1,    "rgba(201,163,74,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H / 2 - 2, W, 4);
  }

  // Monogram DF — fade + scale up after sweep
  const monoFade = Math.max(0, Math.min(1, (t - 0.6) / 0.8));
  if (monoFade > 0) {
    const scale = 0.85 + 0.15 * easeOutCubic(monoFade);
    ctx.save();
    ctx.globalAlpha = monoFade;
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);

    // Thin gold ring
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 160, 0, Math.PI * 2);
    ctx.stroke();

    // DF serif, gold gradient
    const g = ctx.createLinearGradient(0, -100, 0, 100);
    g.addColorStop(0, GOLD_HI);
    g.addColorStop(1, GOLD);
    ctx.fillStyle = g;
    ctx.font = '700 170px Fraunces, Georgia, serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("DF", 0, 8);

    ctx.restore();
  }
}

// --- Scenes 2,3,4: tagline (each ~2.5s) ---
function sceneTagline(ctx: CanvasRenderingContext2D, t: number, len: number, text: string) {
  // Eyebrow + big serif tagline. Each word slides up from bottom
  // over the first ~500ms, holds ~1.5s, fades out in last 500ms.
  const enter = Math.min(1, t / 0.5);
  const exit  = Math.max(0, Math.min(1, (len - t) / 0.4));
  const alpha = Math.min(enter, exit);
  const yOffset = (1 - easeOutCubic(enter)) * 60;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Eyebrow
  ctx.font = '500 22px Inter, system-ui';
  ctx.fillStyle = "rgba(201,163,74,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DOGE FORGE · SEASON 1", W / 2, H / 2 - 140 + yOffset);

  // Big tagline
  ctx.font   = '700 120px Fraunces, Georgia, serif';
  ctx.fillStyle = CREAM;
  ctx.fillText(text, W / 2, H / 2 + yOffset);

  // Thin hairline underscore
  ctx.strokeStyle = `rgba(201,163,74,${0.6 * alpha})`;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 120, H / 2 + 90 + yOffset);
  ctx.lineTo(W / 2 + 120, H / 2 + 90 + yOffset);
  ctx.stroke();

  ctx.restore();
}

// --- Scene 5: triptych (10..14s) ---
function sceneTriptych(ctx: CanvasRenderingContext2D, t: number, len: number) {
  const enter = Math.min(1, t / 0.6);
  const exit  = Math.max(0, Math.min(1, (len - t) / 0.4));
  const alpha = Math.min(enter, exit);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Section label up top
  ctx.font = '500 22px Inter, system-ui';
  ctx.fillStyle = "rgba(201,163,74,0.9)";
  ctx.textAlign = "center";
  ctx.fillText("WHAT YOU CAN DO", W / 2, 200);

  // Three columns: Mine / Trade / Identity
  const cols = ["Mine", "Trade", ".fdoge"];
  const subs = ["Earn fDOGE", "Arc DEX", "Your name"];
  const colW = W / 3;

  cols.forEach((label, i) => {
    const colEnter = Math.min(1, Math.max(0, (t - 0.2 * i) / 0.7));
    const yShift   = (1 - easeOutCubic(colEnter)) * 80;
    const colAlpha = easeOutCubic(colEnter) * alpha;

    ctx.save();
    ctx.globalAlpha = colAlpha;
    const cx = colW * i + colW / 2;
    const cy = H / 2 + yShift;

    // Gold circle badge behind each label
    ctx.fillStyle = "rgba(201,163,74,0.08)";
    ctx.beginPath();
    ctx.arc(cx, cy - 20, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Number inside badge
    ctx.fillStyle = GOLD_HI;
    ctx.font = '700 70px Fraunces, Georgia, serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), cx, cy - 20);

    // Label under badge
    ctx.fillStyle = CREAM;
    ctx.font = '700 48px Fraunces, Georgia, serif';
    ctx.fillText(label, cx, cy + 100);

    // Sublabel
    ctx.fillStyle = MUTED;
    ctx.font = '500 24px Inter, system-ui';
    ctx.fillText(subs[i], cx, cy + 150);

    ctx.restore();
  });

  ctx.restore();
}

// --- Scene 6: points counter (14..17s) ---
function scenePoints(ctx: CanvasRenderingContext2D, t: number, len: number) {
  const enter = Math.min(1, t / 0.4);
  const exit  = Math.max(0, Math.min(1, (len - t) / 0.4));
  const alpha = Math.min(enter, exit);

  // Count up 0 → 10 000 across the middle 2s
  const countT = Math.max(0, Math.min(1, (t - 0.2) / Math.max(0.1, len - 0.6)));
  const n = Math.floor(easeInOutCubic(countT) * 10_000);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Eyebrow
  ctx.font = '500 22px Inter, system-ui';
  ctx.fillStyle = "rgba(201,163,74,0.9)";
  ctx.textAlign = "center";
  ctx.fillText("EARN SEASON 1 POINTS", W / 2, H / 2 - 180);

  // Huge number, gold
  const grd = ctx.createLinearGradient(0, H / 2 - 80, 0, H / 2 + 80);
  grd.addColorStop(0, GOLD_HI);
  grd.addColorStop(1, GOLD);
  ctx.fillStyle = grd;
  ctx.font = '700 260px Fraunces, Georgia, serif';
  ctx.textBaseline = "middle";
  ctx.fillText(n.toLocaleString(), W / 2, H / 2);

  // Label
  ctx.fillStyle = CREAM;
  ctx.font = '500 34px Inter, system-ui';
  ctx.fillText("points and climbing", W / 2, H / 2 + 160);

  // Disclaimer — small, muted
  ctx.fillStyle = MUTED;
  ctx.font = '500 20px Inter, system-ui';
  ctx.fillText("cDOGE on mainnet — possible, not promised.", W / 2, H / 2 + 240);

  ctx.restore();
}

// --- Scene 7: outro (17..20s) ---
function sceneOutro(ctx: CanvasRenderingContext2D, t: number, len: number) {
  const enter = Math.min(1, t / 0.5);
  const alpha = easeOutCubic(enter);
  const scale = 0.9 + 0.1 * alpha;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H / 2 - 40);
  ctx.scale(scale, scale);

  // Ring
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 160, 0, Math.PI * 2);
  ctx.stroke();

  // DF monogram
  const g = ctx.createLinearGradient(0, -100, 0, 100);
  g.addColorStop(0, GOLD_HI);
  g.addColorStop(1, GOLD);
  ctx.fillStyle = g;
  ctx.font = '700 170px Fraunces, Georgia, serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DF", 0, 8);

  ctx.restore();

  // Tagline under logo
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '700 56px Fraunces, Georgia, serif';
  ctx.fillStyle = CREAM;
  ctx.textAlign = "center";
  ctx.fillText("DOGE FORGE", W / 2, H / 2 + 190);

  ctx.font = '500 26px Inter, system-ui';
  ctx.fillStyle = GOLD;
  ctx.fillText("Season 1 is live.", W / 2, H / 2 + 240);
  ctx.restore();
}
