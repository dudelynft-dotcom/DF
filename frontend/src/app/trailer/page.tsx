"use client";
import { useEffect, useRef, useState } from "react";

// Standalone 20-second brand trailer. Renders to a single Canvas 2D
// surface (no DOM). MediaRecorder.captureStream() produces a
// pixel-perfect WebM, combined with a Web Audio API soundtrack
// generated live — no audio file license, no screen recording.
//
// Workflow:
//   1. Wait for brand fonts to load
//   2. Click "Record" → canvas animates 20s + audio plays +
//      MediaRecorder captures both streams at 30fps / 48kHz
//   3. Recorder stops automatically, shows download link
//   4. Convert WebM → MP4 (CloudConvert) for X upload
//
// Dimensions: 1920×1080 landscape — X's preferred video aspect
// (16:9). Mobile feeds letterbox gracefully; the centre-framed
// text stays fully visible.

const W = 1920;
const H = 1080;
const FPS = 30;
const DURATION = 20; // seconds

// Brand palette — kept local so this file is fully portable.
const BG      = "#0E0D08";
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
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [fontsReady, setFontsReady] = useState(false);
  const [mode, setMode] = useState<"idle" | "preview" | "recording" | "done">("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof document !== "undefined" && document.fonts) {
      Promise.all([
        document.fonts.load("700 160px Fraunces"),
        document.fonts.load("700 48px Inter"),
      ]).then(() => setFontsReady(true));
    } else {
      setFontsReady(true);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      recorderRef.current?.stop();
      audioCtxRef.current?.close();
    };
  }, []);

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

    // Preview also plays audio so the user hears what the final
    // recording will sound like. Plays to the default destination
    // (speakers) — not captured.
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    scheduleMusic(ctx, ctx.destination);

    startRef.current = performance.now();
    loop();
  };

  const record = async () => {
    if (!canvasRef.current) return;
    setDownloadUrl(null);
    chunksRef.current = [];
    setMode("recording");
    setProgress(0);

    // --- Audio: programmatic soundtrack routed to a MediaStreamDestination
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const audioDest = audioCtx.createMediaStreamDestination();
    // Also route to speakers so the user hears it while recording.
    scheduleMusic(audioCtx, audioDest, audioCtx.destination);

    // --- Video: canvas stream at FPS
    const videoStream = canvasRef.current.captureStream(FPS);

    // --- Combine
    const stream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ]);

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond:   192_000,
    });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setMode("done");
      audioCtx.close();
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
        20-second 16:9 brand trailer with synthesised soundtrack.
        Click <strong className="text-ink">Record</strong> → wait 20 seconds →
        download the WebM. Convert to MP4 at{" "}
        <a href="https://cloudconvert.com/webm-to-mp4" target="_blank" rel="noreferrer" className="text-gold-300 hover:text-gold-200 underline">cloudconvert.com/webm-to-mp4</a>{" "}
        before uploading to X.
      </p>

      <div className="mt-6 mx-auto" style={{ maxWidth: 900 }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="w-full rounded-xl border border-line bg-bg-base"
          style={{ aspectRatio: "16 / 9" }}
        />
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
          {mode === "preview" ? "Playing…" : "Preview (with audio)"}
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

      <p className="mt-8 text-xs text-ink-faint text-center max-w-lg mx-auto">
        1920×1080, 30 fps, 8 Mbps video + 192 kbps Opus audio.
        Music is synthesised live via Web Audio API — no license needed.
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

  // Radial vignette for depth
  const grd = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.9);
  grd.addColorStop(0, "rgba(255,255,255,0.02)");
  grd.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  if (t < 2)          sceneIntro(ctx, t);
  else if (t < 4.5)   sceneTagline(ctx, t - 2,   2.5, "Mine fDOGE.");
  else if (t < 7)     sceneTagline(ctx, t - 4.5, 2.5, "Trade on Arc.");
  else if (t < 10)    sceneTagline(ctx, t - 7,   3,   "Build your identity.");
  else if (t < 14)    sceneTriptych(ctx, t - 10, 4);
  else if (t < 17)    scenePoints(ctx, t - 14,   3);
  else                sceneOutro(ctx, t - 17,    3);

  // Persistent watermark
  ctx.font = '500 24px Inter, system-ui';
  ctx.fillStyle = "rgba(245,236,208,0.4)";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("community.dogeforge.fun", W / 2, H - 50);
}

// Helper: shrink font until the string fits maxWidth.
function fitText(ctx: CanvasRenderingContext2D, text: string, desiredPx: number, maxWidth: number, family: string) {
  let size = desiredPx;
  ctx.font = `700 ${size}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && size > 24) {
    size -= 4;
    ctx.font = `700 ${size}px ${family}`;
  }
  return size;
}

function sceneIntro(ctx: CanvasRenderingContext2D, t: number) {
  // Sweep of a gold spark across centre
  const sweepProg = Math.min(1, t / 0.9);
  if (sweepProg < 1) {
    const x = -200 + (W + 400) * easeOutCubic(sweepProg);
    const grad = ctx.createLinearGradient(x - 300, H / 2, x + 300, H / 2);
    grad.addColorStop(0,    "rgba(201,163,74,0)");
    grad.addColorStop(0.5,  "rgba(243,196,90,0.95)");
    grad.addColorStop(1,    "rgba(201,163,74,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H / 2 - 3, W, 6);
  }

  // Monogram DF — fade + scale up after sweep
  const monoFade = Math.max(0, Math.min(1, (t - 0.6) / 0.8));
  if (monoFade > 0) {
    const scale = 0.85 + 0.15 * easeOutCubic(monoFade);
    ctx.save();
    ctx.globalAlpha = monoFade;
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);

    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 180, 0, Math.PI * 2);
    ctx.stroke();

    const g = ctx.createLinearGradient(0, -120, 0, 120);
    g.addColorStop(0, GOLD_HI);
    g.addColorStop(1, GOLD);
    ctx.fillStyle = g;
    ctx.font = '700 200px Fraunces, Georgia, serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("DF", 0, 10);

    ctx.restore();
  }
}

function sceneTagline(ctx: CanvasRenderingContext2D, t: number, len: number, text: string) {
  const enter = Math.min(1, t / 0.5);
  const exit  = Math.max(0, Math.min(1, (len - t) / 0.4));
  const alpha = Math.min(enter, exit);
  const yOffset = (1 - easeOutCubic(enter)) * 60;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Eyebrow
  ctx.font = '500 28px Inter, system-ui';
  ctx.fillStyle = "rgba(201,163,74,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Manual letter-spacing by drawing wide-kerned.
  const eyebrow = "DOGE FORGE  ·  SEASON 1";
  ctx.fillText(eyebrow, W / 2, H / 2 - 160 + yOffset);

  // Big tagline — auto-fit to width (leave generous side padding)
  const maxWidth = W - 280;
  const size = fitText(ctx, text, 160, maxWidth, "Fraunces, Georgia, serif");
  ctx.font = `700 ${size}px Fraunces, Georgia, serif`;
  ctx.fillStyle = CREAM;
  ctx.fillText(text, W / 2, H / 2 + yOffset);

  // Hairline
  ctx.strokeStyle = `rgba(201,163,74,${0.6 * alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 160, H / 2 + size * 0.65 + yOffset);
  ctx.lineTo(W / 2 + 160, H / 2 + size * 0.65 + yOffset);
  ctx.stroke();

  ctx.restore();
}

function sceneTriptych(ctx: CanvasRenderingContext2D, t: number, len: number) {
  const enter = Math.min(1, t / 0.6);
  const exit  = Math.max(0, Math.min(1, (len - t) / 0.4));
  const alpha = Math.min(enter, exit);

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.font = '500 28px Inter, system-ui';
  ctx.fillStyle = "rgba(201,163,74,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("WHAT YOU CAN DO", W / 2, 200);

  const cols = ["Mine", "Trade", ".fdoge"];
  const subs = ["Earn fDOGE", "On Arc DEX", "Your identity"];
  const colW = W / 3;

  cols.forEach((label, i) => {
    const colEnter = Math.min(1, Math.max(0, (t - 0.2 * i) / 0.7));
    const yShift   = (1 - easeOutCubic(colEnter)) * 80;
    const colAlpha = easeOutCubic(colEnter) * alpha;

    ctx.save();
    ctx.globalAlpha = colAlpha;
    const cx = colW * i + colW / 2;
    const cy = H / 2 + yShift - 20;

    // Badge
    ctx.fillStyle = "rgba(201,163,74,0.08)";
    ctx.beginPath();
    ctx.arc(cx, cy - 30, 100, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = GOLD_HI;
    ctx.font = '700 90px Fraunces, Georgia, serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), cx, cy - 30);

    ctx.fillStyle = CREAM;
    ctx.font = '700 64px Fraunces, Georgia, serif';
    ctx.fillText(label, cx, cy + 130);

    ctx.fillStyle = MUTED;
    ctx.font = '500 28px Inter, system-ui';
    ctx.fillText(subs[i], cx, cy + 180);

    ctx.restore();
  });

  ctx.restore();
}

function scenePoints(ctx: CanvasRenderingContext2D, t: number, len: number) {
  const enter = Math.min(1, t / 0.4);
  const exit  = Math.max(0, Math.min(1, (len - t) / 0.4));
  const alpha = Math.min(enter, exit);

  const countT = Math.max(0, Math.min(1, (t - 0.2) / Math.max(0.1, len - 0.6)));
  const n = Math.floor(easeInOutCubic(countT) * 10_000);

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.font = '500 28px Inter, system-ui';
  ctx.fillStyle = "rgba(201,163,74,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("EARN SEASON 1 POINTS", W / 2, H / 2 - 220);

  const grd = ctx.createLinearGradient(0, H / 2 - 100, 0, H / 2 + 100);
  grd.addColorStop(0, GOLD_HI);
  grd.addColorStop(1, GOLD);
  ctx.fillStyle = grd;
  ctx.font = '700 320px Fraunces, Georgia, serif';
  ctx.fillText(n.toLocaleString(), W / 2, H / 2);

  ctx.fillStyle = CREAM;
  ctx.font = '500 40px Inter, system-ui';
  ctx.fillText("points and climbing", W / 2, H / 2 + 200);

  ctx.fillStyle = MUTED;
  ctx.font = '500 24px Inter, system-ui';
  ctx.fillText("cDOGE on mainnet — possible, not promised.", W / 2, H / 2 + 270);

  ctx.restore();
}

function sceneOutro(ctx: CanvasRenderingContext2D, t: number, len: number) {
  void len;
  const enter = Math.min(1, t / 0.5);
  const alpha = easeOutCubic(enter);
  const scale = 0.9 + 0.1 * alpha;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H / 2 - 60);
  ctx.scale(scale, scale);

  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 180, 0, Math.PI * 2);
  ctx.stroke();

  const g = ctx.createLinearGradient(0, -120, 0, 120);
  g.addColorStop(0, GOLD_HI);
  g.addColorStop(1, GOLD);
  ctx.fillStyle = g;
  ctx.font = '700 200px Fraunces, Georgia, serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DF", 0, 10);

  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '700 72px Fraunces, Georgia, serif';
  ctx.fillStyle = CREAM;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DOGE FORGE", W / 2, H / 2 + 210);

  ctx.font = '500 32px Inter, system-ui';
  ctx.fillStyle = GOLD;
  ctx.fillText("Season 1 is live.", W / 2, H / 2 + 270);
  ctx.restore();
}

// ============================================================
//                       AUDIO
// ============================================================
// Programmatic soundtrack. 20 seconds, dark synth, brand-aligned:
//   0–2s   sub boom → atmospheric pad fades in
//   2–10s  pad sustains, soft arpeggio on each tagline (at 2, 4.5, 7)
//   10–14s triptych hits — three short bass hits staggered
//   14–17s rising tension — slow upward glide
//   17–20s impact hit + long tail
//
// All nodes are scheduled against audioCtx.currentTime so timing is
// sample-accurate. Routed to ALL provided destinations so the user
// hears preview AND the stream captures the same signal.

function scheduleMusic(ctx: AudioContext, ...dests: AudioNode[]) {
  const t0 = ctx.currentTime + 0.05; // tiny pre-roll so RAF aligns

  // A helper that multicasts a node into every destination.
  const out = ctx.createGain();
  out.gain.value = 1;
  dests.forEach((d) => out.connect(d));

  // ---------- Master: gentle low-pass + soft compressor ----------
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 6500;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 20;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  master.connect(lpf); lpf.connect(comp); comp.connect(out);

  // ---------- Pad: two detuned sawtooths, 110Hz root ----------
  const padRoot = 110; // A2
  const pad = ctx.createGain();
  pad.gain.setValueAtTime(0, t0);
  pad.gain.linearRampToValueAtTime(0.22, t0 + 1.5);
  pad.gain.linearRampToValueAtTime(0.18, t0 + 14);
  pad.gain.linearRampToValueAtTime(0.05, t0 + 17);
  pad.gain.linearRampToValueAtTime(0,    t0 + DURATION);
  pad.connect(master);
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.setValueAtTime(800, t0);
  padFilter.frequency.linearRampToValueAtTime(1800, t0 + 14);
  padFilter.frequency.linearRampToValueAtTime(400,  t0 + DURATION);
  padFilter.Q.value = 1.2;
  padFilter.connect(pad);
  [padRoot, padRoot * 1.5, padRoot * 2].forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = f + (i - 1) * 0.4; // mild detune
    const g = ctx.createGain();
    g.gain.value = i === 0 ? 0.5 : i === 1 ? 0.3 : 0.2;
    osc.connect(g); g.connect(padFilter);
    osc.start(t0);
    osc.stop(t0 + DURATION + 0.1);
  });

  // ---------- Boom at scene transitions ----------
  const bigBoomTimes = [0, 2, 4.5, 7, 10, 14, 17];
  bigBoomTimes.forEach((bt) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(80, t0 + bt);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + bt + 0.45);
    const g = ctx.createGain();
    const amp = bt === 0 || bt === 17 ? 0.7 : 0.35;
    g.gain.setValueAtTime(0, t0 + bt);
    g.gain.linearRampToValueAtTime(amp, t0 + bt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + bt + 0.9);
    osc.connect(g); g.connect(master);
    osc.start(t0 + bt);
    osc.stop(t0 + bt + 1);
  });

  // ---------- Arpeggio ticks during tagline scenes ----------
  // Four 16th notes per tagline, on a pentatonic E-minor voicing.
  const arpNotes = [329.63, 392.00, 440.00, 523.25]; // E4 G4 A4 C5
  const arpStarts = [2, 4.5, 7];
  arpStarts.forEach((s) => {
    arpNotes.forEach((freq, i) => {
      const at = t0 + s + 0.3 + i * 0.45;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.10, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
      osc.connect(g); g.connect(master);
      osc.start(at);
      osc.stop(at + 0.5);
    });
  });

  // ---------- Triptych hits (10..14s) — three bass plucks ----------
  [10.3, 11.3, 12.3].forEach((s) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(73.42, t0 + s); // D2
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0 + s);
    g.gain.linearRampToValueAtTime(0.28, t0 + s + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + s + 0.35);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 900;
    osc.connect(f); f.connect(g); g.connect(master);
    osc.start(t0 + s);
    osc.stop(t0 + s + 0.4);
  });

  // ---------- Rising tension 14–17s — slow upward glide ----------
  const rise = ctx.createOscillator();
  rise.type = "sawtooth";
  rise.frequency.setValueAtTime(110, t0 + 14);
  rise.frequency.exponentialRampToValueAtTime(440, t0 + 17);
  const riseG = ctx.createGain();
  riseG.gain.setValueAtTime(0, t0 + 14);
  riseG.gain.linearRampToValueAtTime(0.12, t0 + 14.3);
  riseG.gain.linearRampToValueAtTime(0.22, t0 + 16.9);
  riseG.gain.exponentialRampToValueAtTime(0.001, t0 + 17.2);
  const riseF = ctx.createBiquadFilter();
  riseF.type = "bandpass"; riseF.frequency.value = 1200; riseF.Q.value = 2;
  rise.connect(riseF); riseF.connect(riseG); riseG.connect(master);
  rise.start(t0 + 14);
  rise.stop(t0 + 17.3);

  // ---------- Final impact + long tail ----------
  const impact = ctx.createOscillator();
  impact.type = "sine";
  impact.frequency.setValueAtTime(55, t0 + 17);
  impact.frequency.exponentialRampToValueAtTime(30, t0 + 19.8);
  const impactG = ctx.createGain();
  impactG.gain.setValueAtTime(0, t0 + 17);
  impactG.gain.linearRampToValueAtTime(0.6, t0 + 17.02);
  impactG.gain.exponentialRampToValueAtTime(0.001, t0 + DURATION);
  impact.connect(impactG); impactG.connect(master);
  impact.start(t0 + 17);
  impact.stop(t0 + DURATION + 0.1);

  // A high shimmer tail for the outro
  const shimmer = ctx.createOscillator();
  shimmer.type = "sine";
  shimmer.frequency.value = 880; // A5
  const shimmerG = ctx.createGain();
  shimmerG.gain.setValueAtTime(0, t0 + 17);
  shimmerG.gain.linearRampToValueAtTime(0.07, t0 + 17.5);
  shimmerG.gain.exponentialRampToValueAtTime(0.001, t0 + DURATION);
  shimmer.connect(shimmerG); shimmerG.connect(master);
  shimmer.start(t0 + 17);
  shimmer.stop(t0 + DURATION + 0.1);
}
