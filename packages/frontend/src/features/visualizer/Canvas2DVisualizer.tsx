import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import type { AudioData } from "./types";
import { isDownbeatIndex } from "@shared/timing";

export interface Canvas2DVisualizerRef {
  captureScreenshot: () => string | null;
}

interface Props {
  audioData: React.MutableRefObject<AudioData>;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
  mode?:
    | "bars"
    | "mirrored-bars"
    | "segmented-led-bars"
    | "stereo-split-bars"
    | "stacked-frequency-bands"
    | "dot-peak-matrix"
    | "waveform"
    | "radial"
    | "spectrogram"
    | "lissajous"
    | "constellation"
    | "particles";
  lrcSync?: {
    currentSection: string;
    sectionProgress: number;
    isPhraseStart: boolean;
    lineProgress: number;
  } | null;
  /**
   * Per-frame live sync written by the parent's elapsed loop (see audioTiming.ts).
   * Preferred over `lrcSync` in the draw loop. Also keeps this effect from
   * re-subscribing every time the React-state snapshot identity changes.
   * Falls back to `lrcSync` when null (e.g. demo mode).
   */
  lrcSyncLive?: { current: Props["lrcSync"] };
  bgColor?: string;
  onAnalysis?: (result: { text: string; model: string; mode: string }) => void;
}

/**
 * 2026 Canvas2D Visualizer — 12 modes inspired by visual-flux (Apache-2.0) + Waviz (MIT).
 * - bars: frequency bars with LRC phrase flash + section palette lerp (Trollspace/Synthwave)
 * - mirrored-bars: symmetrical bars mirrored from center baseline with fade
 * - segmented-led-bars: horizontal LED strips with gaps, glow, and beat-driven brightness
 * - stereo-split-bars: low/mid/high frequency bands split into stacked sections
 * - stacked-frequency-bands: single composite bar split into stacked low/mid/high layers
 * - dot-peak-matrix: frequency amplitude shown as a dot matrix equalizer
 * - waveform: time-domain oscilloscope with LRC lineProgress scrub
 * - radial: circular spectrum with sectionProgress rotation
 * - spectrogram: scrolling time-frequency heatmap
 * - lissajous: X/Y frequency scatter driven by bass/mid
 * - constellation: peak-frequency scatter with beat burst
 * - particles: simple 2D particle field driven by energy/beat
 * No extra deps — Canvas2D + Web Audio API only (2026 lightweight 2D stack).
 */
/** Normalize a CSS color to 6-digit hex so an alpha suffix can be appended.
 *  Preset bgColors are usually `#rrggbb`, but `#rgb` (or a non-hex value) would
 *  have produced an invalid `fillStyle`, silently breaking the trail fade. */
function normalizeHex(hex: string): string {
  const m = /^#([0-9a-f]{3})$/i.exec(hex.trim());
  if (m) {
    const [r, g, b] = m[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(hex.trim())) return hex.trim().toLowerCase();
  return "#050505"; // non-hex background: fall back to the default canvas bg
}

function hexToRgb(hex: string): [number, number, number] {
  const m = normalizeHex(hex).slice(1);
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (
    "#" + [r, g, bl].map((x) => x.toString(16).padStart(2, "0")).join("")
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Canvas2DVisualizer = forwardRef<Canvas2DVisualizerRef, Props>(
function Canvas2DVisualizer(
  {
    audioData,
    analyserRef,
    isPlaying,
    mode = "bars",
    lrcSync,
    lrcSyncLive,
    bgColor = "#050505",
    onAnalysis,
  }: Props,
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stable holder for the live ref so the draw effect below never re-subscribes
  // on snapshot identity changes (~20 fps) — only on mode/config changes.
  const lrcSyncLiveHolder = useRef(lrcSyncLive);
  lrcSyncLiveHolder.current = lrcSyncLive;
  const lrcSyncPropHolder = useRef(lrcSync);
  lrcSyncPropHolder.current = lrcSync;

  // Smooth section palette transitions
  const currentPaletteRef = useRef<string[]>([]);
  const targetPaletteRef = useRef<string[]>([]);
  const paletteTRef = useRef(1);
  // Cache bar gradients to avoid per-frame createLinearGradient allocation.
  // Keyed by mode + palette + height so each gradient-using mode gets its own entry.
  const barGradientsCacheRef = useRef<{ key: string; gradients: CanvasGradient[] } | null>(null);
  const [analysis, setAnalysis] = useState<{ text: string; model: string; mode: string } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  useImperativeHandle(ref, () => ({
    captureScreenshot: () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      return canvas.toDataURL("image/png");
    },
  }));

  const handleAnalyze = async () => {
    const canvas = canvasRef.current;
    if (!canvas || analysisLoading) return;
    setAnalysisLoading(true);
    setAnalysis(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png");
      });
      if (!blob) throw new Error("canvas capture returned no blob");
      const file = new File([blob], `viz-${mode}-${Date.now()}.png`, { type: "image/png" });
      const { analyzeVisualizer } = await import("../../services/api");
      const result = await analyzeVisualizer(file, mode);
      setAnalysis(result);
      onAnalysis?.(result);
    } catch (e) {
      setAnalysis({ text: `Analysis failed: ${(e as Error).message}`, model: "error", mode });
    } finally {
      setAnalysisLoading(false);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let phraseFlash = 0;
    let freq: Uint8Array | null = null;
    let wave: Uint8Array | null = null;
    let smoothed: Uint8Array | null = null;
    // Falling peak indicators for bars mode
    let barPeaks: number[] | null = null;
    const PEAK_DECAY = 0.985;

    // 2026 animation state: spring-physics bar smoothing, beat vignette, radial rotation
    let barVelocities: number[] | null = null;
    let beatVignette = 0;
    // Waveform spring envelope state
    let waveEnvelope: number[] | null = null;
    let waveVelocities: number[] | null = null;

    const palettes: Record<string, string[]> = {
      INTRO: ["#6366f1", "#818cf8", "#a5b4fc"],
      VERSE: ["#06b6d4", "#22d3ee", "#67e8f9"],
      CHORUS: ["#f59e0b", "#f97316", "#fb923c"],
      BRIDGE: ["#a855f7", "#c084fc", "#d8b4fe"],
      DROP: ["#ef4444", "#ff0040", "#ff6b6b"],
      "BUILD-UP": ["#eab308", "#facc15", "#fde047"],
      OUTRO: ["#6b7280", "#9ca3af", "#d1d5db"],
    };

    // Simple 2D particle system for particles mode
    const particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      hue: number;
      size: number;
    }[] = [];
    const MAX_PARTICLES = 300;
    function spawnParticle(
      w: number,
      h: number,
      energy: number,
      beat: boolean,
    ) {
      if (particles.length >= MAX_PARTICLES) return;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 2 + energy * 3 + (beat ? 3 : 0);
      particles.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.5,
        y: h / 2 + (Math.random() - 0.5) * h * 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        hue: Math.random() * 360,
        size: 0.6 + Math.random() * 2.0,
      });
    }

    // Backing-store sizing driven by ResizeObserver: reading clientWidth /
    // clientHeight inside the 60 Hz draw loop forced a synchronous layout every
    // frame (layout thrash). `dpr` is captured here and kept in sync.
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const applySize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Min 1×1 so a hidden/collapsed canvas never gets a zero-sized backing
      // store (and the idle text below can still be drawn on reveal).
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(applySize);
      resizeObserver.observe(canvas);
    }
    applySize();

    const draw = () => {
      const analyser = analyserRef.current;
      const d = audioData.current;
      // Live per-frame sync preferred; React-state snapshot as fallback.
      const sync =
        lrcSyncLiveHolder.current?.current ?? lrcSyncPropHolder.current;
      const section = sync?.currentSection || "VERSE";
      const target = palettes[section] || palettes.VERSE;

      // Prefer blended live+analysis energy for visual punch; fall back to raw
      // analyzed energy only when the blended value is actually invalid (NaN /
      // Infinity), not when it is legitimately 0 during silence.
      const effectiveEnergy = Number.isFinite(d.energy) ? d.energy : (d.analyzedEnergy || 0);
      const energyMod = 1 + effectiveEnergy * 0.4;
      const analyzedPunch = d.analyzedEnergy || 0;

      // Lazy-size frequency/waveform buffers when the analyser config changes.
      // Always allocated (default 1024/2048) so downstream code never sees null —
      // buffers are only *filled* with real data while playing.
      if (!freq || freq.length !== (analyser?.frequencyBinCount ?? 1024)) {
        freq = new Uint8Array(analyser?.frequencyBinCount ?? 1024);
      }
      if (!wave || wave.length !== (analyser?.fftSize ?? 2048)) {
        wave = new Uint8Array(analyser?.fftSize ?? 2048);
      }
      if (!smoothed || smoothed.length !== wave.length) {
        smoothed = new Uint8Array(wave.length);
      }

      if (target.join("|") !== targetPaletteRef.current.join("|")) {
        targetPaletteRef.current = target;
        paletteTRef.current = 0;
      }

      paletteTRef.current = Math.min(1, paletteTRef.current + 0.04);
      const rawT = paletteTRef.current;
      // Ease the palette transition so section changes feel organic, not linear.
      const t = easeOutQuad(rawT);
      if (!currentPaletteRef.current.length)
        currentPaletteRef.current = [...target];
      const colors = currentPaletteRef.current.map((c, i) => {
        const tc = targetPaletteRef.current[i] || c;
        return lerpColor(c, tc, t);
      });
      if (paletteTRef.current >= 1)
        currentPaletteRef.current = [...targetPaletteRef.current];

      if (sync?.isPhraseStart) phraseFlash = 1;
      phraseFlash = Math.max(0, phraseFlash - 0.07);
      // Beat vignette pulse — subtle screen-edge darkening on transients.
      if (d.beat) beatVignette = Math.min(1, beatVignette + 0.35);
      beatVignette = Math.max(0, beatVignette - 0.06);

      // Size the backing store only when the container changes (see applySize above).
      const bg = normalizeHex(bgColor);
      const w = canvas.width;
      const h = canvas.height;

      // Cached gradient helper: keyed by mode + palette + height so each
      // gradient-using mode avoids per-frame createLinearGradient allocation.
      const getGradients = (m: string, cols: string[]): CanvasGradient[] => {
        const key = `${m}|${cols.join("|")}|${h}`;
        const cached = barGradientsCacheRef.current;
        if (cached?.key === key) return cached.gradients;
        const gradients = cols.map((c) => {
          const grad = ctx.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, c);
          grad.addColorStop(1, cols[0] + "60");
          return grad;
        });
        barGradientsCacheRef.current = { key, gradients };
        return gradients;
      };

      // Ensure particles don't survive a mode switch away from particles mode.
      if (mode !== "particles" && particles.length > 0) {
        particles.length = 0;
      }
      // Reset animation state on mode switch so bar-springs / radial rotation
      // don't carry stale velocities across unrelated modes.
      if (mode === "bars" || mode === "mirrored-bars" || mode === "stereo-split-bars" || mode === "stacked-frequency-bands" || mode === "dot-peak-matrix") {
        if (!barVelocities || barVelocities.length !== (mode === "dot-peak-matrix" ? 64 : (mode === "stereo-split-bars" || mode === "stacked-frequency-bands" ? 48 : 64))) {
          barVelocities = new Array(mode === "dot-peak-matrix" ? 64 : mode === "stereo-split-bars" || mode === "stacked-frequency-bands" ? 48 : 64).fill(0);
        }
      } else {
        barVelocities = null;
      }

      // Skip painting while the tab is hidden — the parent's analyser loop also
      // pauses, so this only saves battery; the rAF loop stays alive.
      if (typeof document !== "undefined" && document.hidden) {
        raf = requestAnimationFrame(draw);
        return;
      }
      // 2026 p5.js trail: background alpha 5-15 for ghostly persistence (visual-flux + p5js.ai 2026)
      // Each mode gets tuned alpha: bars need crisp bars (higher clear), particles need long trails
      if (isPlaying) {
        if (mode !== "spectrogram") {
          const trailAlpha =
            mode === "particles"
              ? "0A"
              : mode === "bars"
                ? "14"
                : mode === "waveform"
                  ? "12"
                  : "0F";
          ctx.fillStyle = bg + trailAlpha;
          ctx.fillRect(0, 0, w, h);
        }
      } else {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }

      if (phraseFlash > 0.05) {
        ctx.fillStyle = `rgba(255,255,255,${phraseFlash * 0.08})`;
        ctx.fillRect(0, 0, w, h);
      }
      // Beat vignette — radial gradient darkening edges on strong beats.
      if (beatVignette > 0.01) {
        const vigGrd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
        vigGrd.addColorStop(0, "rgba(0,0,0,0)");
        vigGrd.addColorStop(1, `rgba(0,0,0,${beatVignette * 0.45})`);
        ctx.fillStyle = vigGrd;
        ctx.fillRect(0, 0, w, h);
      }

      if (!analyser || !isPlaying) {
        // 2026 kinetic idle: variable-font-inspired — weight pulses with phraseFlash, not static
        const idlePulse =
          phraseFlash * 0.3 + Math.sin(performance.now() * 0.002) * 0.08;
        ctx.fillStyle = colors[0] + "60";
        ctx.font = `${24 * dpr}px monospace`;
        ctx.textAlign = "center";
        ctx.globalAlpha = 0.7 + idlePulse;
        ctx.fillText(`${section} — ${mode}`, w / 2, h / 2 - 6 * dpr);
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors[1] + "30";
        ctx.font = `${11 * dpr}px monospace`;
        ctx.fillText(
          `▶ play a track for audio-reactive`,
          w / 2,
          h / 2 + 18 * dpr,
        );
        raf = requestAnimationFrame(draw);
        return;
      }

      analyser.getByteFrequencyData(freq as Uint8Array<ArrayBuffer>);
      analyser.getByteTimeDomainData(wave as Uint8Array<ArrayBuffer>);

      if (mode === "bars") {
        const barCount = 64;
        const step = Math.floor(freq.length / barCount);
        const barW = w / barCount;
        // Lazy-init falling-peak store + spring velocities
        if (!barPeaks || barPeaks.length !== barCount) {
          barPeaks = new Array(barCount).fill(0);
        }
        if (!barVelocities || barVelocities.length !== barCount) {
          barVelocities = new Array(barCount).fill(0);
        }
        const barGradients = getGradients(mode, colors);
        const baseY = Math.round(h * 0.88);
        for (let i = 0; i < barCount; i++) {
          const rawV = freq[i * step] / 255;
          const boosted =
            rawV +
            phraseFlash * 0.35 +
            (sync?.lineProgress ?? 0) * 0.1 +
            d.bass * 0.08 +
            (d.beatPhase && d.beatPhase < 0.5 ? (1 - d.beatPhase * 2) * 0.12 : 0);
          // Spring-physics smoothing: target → velocity → position with damping.
          const targetH = boosted * h * 0.78 * energyMod;
          const springK = 0.28;
          const damping = 0.72;
          const dt = 1;
          const displacement = targetH - (barPeaks[i] || 0);
          barVelocities[i] = (barVelocities[i] + springK * displacement * dt) * damping;
          const smoothH = Math.max(0, (barPeaks[i] || 0) + barVelocities[i] * dt);
          // Ease-out-back for punchy overshoot on rising transients.
          const easeT = clamp(smoothH / Math.max(1, h * 0.78 * energyMod), 0, 1);
          const easedH = smoothH * (1 + 0.08 * easeOutBack(easeT) * (barVelocities[i] > 0 ? 1 : 0));
          barPeaks[i] = smoothH;
          const bh = easedH;
          const x = Math.round(i * barW);
          const y = Math.round(baseY - bh);
          const bw = Math.round(barW) - 2;
          const radius = Math.min(bw / 2, 3 * dpr);
          const cIdx = Math.floor((i / barCount) * colors.length);
          const warmMix = i / barCount < 0.3 ? d.bass * 0.35 : 0;
          const coolMix = i / barCount > 0.7 ? d.treble * 0.35 : 0;
          ctx.fillStyle = barGradients[cIdx % barGradients.length];
          ctx.beginPath();
          ctx.roundRect(x + 1, y, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
          ctx.fill();
          if (warmMix > 0.1) {
            ctx.fillStyle = `rgba(255,120,40,${warmMix * 0.25})`;
            ctx.beginPath();
            ctx.roundRect(x + 1, y, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
            ctx.fill();
          }
          if (coolMix > 0.1) {
            ctx.fillStyle = `rgba(60,160,255,${coolMix * 0.25})`;
            ctx.beginPath();
            ctx.roundRect(x + 1, y, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
            ctx.fill();
          }
          // Reflection below baseline
          if (bh > 1) {
            ctx.save();
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = barGradients[cIdx % barGradients.length];
            const refH = bh * 0.3;
            const refY = baseY + 2 * dpr;
            ctx.beginPath();
            ctx.roundRect(x + 1, refY, bw, refH, [0, 0, radius, radius]);
            ctx.fill();
            ctx.restore();
          }
          // Falling peak indicator
          if (bh > barPeaks[i]) barPeaks[i] = bh;
          else barPeaks[i] = Math.max(bh, barPeaks[i] * PEAK_DECAY);
          const peakY = Math.round(baseY - barPeaks[i]);
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillRect(x + 1, peakY - 1 * dpr, bw, 1.5 * dpr);
          if (d.beat && rawV > 0.55) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x + 1, y - 3 * dpr, bw, 3 * dpr);
            ctx.shadowColor = colors[cIdx % colors.length];
            ctx.shadowBlur = 6 * dpr;
            ctx.fillRect(x + 1, y - 1 * dpr, bw, 1 * dpr);
            ctx.shadowBlur = 0;
            if (isDownbeatIndex(i)) {
              ctx.fillStyle = `rgba(255,255,255,${0.85})`;
              ctx.beginPath();
              ctx.arc(
                x + barW / 2,
                y - 6 * dpr - Math.random() * 6 * dpr,
                2 * dpr,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            }
          }
        }
        // Secondary harmonic overlay
        ctx.globalAlpha = 0.22 + d.treble * 0.25;
        ctx.fillStyle = colors[2] || colors[1];
        for (let i = 0; i < barCount; i++) {
          const v2 =
            freq[
              Math.min(freq.length - 1, Math.floor((i * 1.5) % freq.length))
            ] / 255;
          if (v2 > 0.5) {
            const h2 = v2 * h * 0.18;
            ctx.fillRect(
              i * barW + barW * 0.35,
              h - h2 - 2 * dpr,
              barW * 0.3,
              h2,
            );
          }
        }
        ctx.globalAlpha = 1;
      } else if (mode === "mirrored-bars") {
        const barCount = 64;
        const step = Math.floor(freq.length / barCount);
        const barW = w / barCount;
        if (!barPeaks || barPeaks.length !== barCount) {
          barPeaks = new Array(barCount).fill(0);
        }
        if (!barVelocities || barVelocities.length !== barCount) {
          barVelocities = new Array(barCount).fill(0);
        }
        const barGradients = getGradients(mode, colors);
        const centerY = Math.round(h * 0.5);
        const maxBarH = h * 0.38;
        for (let i = 0; i < barCount; i++) {
          const v = freq[i * step] / 255;
          const boosted =
            v +
            phraseFlash * 0.35 +
            (sync?.lineProgress ?? 0) * 0.1 +
            d.bass * 0.08 +
            (d.beatPhase && d.beatPhase < 0.5 ? (1 - d.beatPhase * 2) * 0.12 : 0);
          const targetH = boosted * maxBarH * energyMod;
          const springK = 0.26;
          const damping = 0.73;
          const displacement = targetH - barPeaks[i];
          barVelocities[i] = (barVelocities[i] + springK * displacement) * damping;
          const bh = Math.max(0, barPeaks[i] + barVelocities[i]);
          if (bh > barPeaks[i]) barPeaks[i] = bh;
          else barPeaks[i] = Math.max(bh, barPeaks[i] * PEAK_DECAY);
          const x = Math.round(i * barW);
          const bw = Math.round(barW) - 2;
          const radius = Math.min(bw / 2, 3 * dpr);
          const cIdx = Math.floor((i / barCount) * colors.length);
          const warmMix = i / barCount < 0.3 ? d.bass * 0.35 : 0;
          const coolMix = i / barCount > 0.7 ? d.treble * 0.35 : 0;
          // Upper bar
          const upY = Math.round(centerY - bh);
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(x + 1 + 2 * dpr, upY + 2 * dpr, bw, bh);
          ctx.fillStyle = barGradients[cIdx % barGradients.length];
          ctx.beginPath();
          ctx.roundRect(x + 1, upY, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
          ctx.fill();
          if (warmMix > 0.1) {
            ctx.fillStyle = `rgba(255,120,40,${warmMix * 0.25})`;
            ctx.beginPath();
            ctx.roundRect(x + 1, upY, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
            ctx.fill();
          }
          if (coolMix > 0.1) {
            ctx.fillStyle = `rgba(60,160,255,${coolMix * 0.25})`;
            ctx.beginPath();
            ctx.roundRect(x + 1, upY, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
            ctx.fill();
          }
          // Lower mirrored bar
          const lowY = centerY;
          const lowH = bh * 0.6;
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = barGradients[cIdx % barGradients.length];
          ctx.beginPath();
          ctx.roundRect(x + 1, lowY, bw, lowH + 2 * dpr, [0, 0, radius, radius]);
          ctx.fill();
           ctx.restore();
           // Peak indicator (upper)
           const peakY = Math.round(centerY - barPeaks[i]);
           ctx.fillStyle = "rgba(255,255,255,0.85)";
           ctx.fillRect(x + 1, peakY - 1 * dpr, bw, 1.5 * dpr);
           // Lower mirrored peak indicator
           const lowPeakH = barPeaks[i] * 0.6;
           const lowPeakY = Math.round(centerY + lowPeakH);
           ctx.fillStyle = "rgba(255,255,255,0.55)";
           ctx.fillRect(x + 1, lowPeakY, bw, 1.5 * dpr);
          if (d.beat && v > 0.55) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x + 1, upY - 3 * dpr, bw, 3 * dpr);
            ctx.shadowColor = colors[cIdx % colors.length];
            ctx.shadowBlur = 6 * dpr;
            ctx.fillRect(x + 1, upY - 1 * dpr, bw, 1 * dpr);
            ctx.shadowBlur = 0;
          }
        }
      } else if (mode === "segmented-led-bars") {
        const barCount = 64;
        const step = Math.floor(freq.length / barCount);
        const barW = w / barCount;
        const segmentsPerBar = 10;
        const segH = 4 * dpr;
        const gap = 2 * dpr;
        const baseY = Math.round(h * 0.92);
        const barGradients = getGradients(mode, colors);
        if (!barVelocities || barVelocities.length !== barCount) {
          barVelocities = new Array(barCount).fill(0);
        }
        for (let i = 0; i < barCount; i++) {
          const v = freq[i * step] / 255;
          const boosted =
            v +
            phraseFlash * 0.35 +
            (sync?.lineProgress ?? 0) * 0.1 +
            d.bass * 0.08 +
            (d.beatPhase && d.beatPhase < 0.5 ? (1 - d.beatPhase * 2) * 0.12 : 0);
          const targetSegs = boosted * segmentsPerBar * energyMod;
          const springK = 0.24;
          const damping = 0.74;
          const displacement = targetSegs - barVelocities[i];
          barVelocities[i] = (barVelocities[i] + springK * displacement) * damping;
          const activeSegments = Math.max(0, Math.min(segmentsPerBar, Math.round(barVelocities[i])));
          const x = Math.round(i * barW);
          const bw = Math.round(barW) - 2;
          const cIdx = Math.floor((i / barCount) * colors.length);
          for (let s = 0; s < segmentsPerBar; s++) {
            const y = baseY - (s + 1) * (segH + gap);
            if (s >= activeSegments) continue;
            ctx.fillStyle = barGradients[cIdx % barGradients.length];
            ctx.beginPath();
            ctx.roundRect(x + 1, y, bw, segH, [1 * dpr, 1 * dpr, 1 * dpr, 1 * dpr]);
            ctx.fill();
            if (d.beat && s === activeSegments - 1) {
              ctx.shadowColor = colors[cIdx % colors.length];
              ctx.shadowBlur = 8 * dpr;
              ctx.fillRect(x + 1, y, bw, segH);
              ctx.shadowBlur = 0;
            }
          }
        }
      } else if (mode === "stereo-split-bars") {
        const barCount = 48;
        const step = Math.floor(freq.length / barCount);
        const barW = w / barCount;
        const bands = [
          { label: "low", start: 0, end: Math.floor(barCount * 0.25), color: colors[0] },
          { label: "mid", start: Math.floor(barCount * 0.25), end: Math.floor(barCount * 0.65), color: colors[1] },
          { label: "high", start: Math.floor(barCount * 0.65), end: barCount, color: colors[2] || colors[1] },
        ];
        const baseY = Math.round(h * 0.88);
        // Lazy-init peaks + spring velocities for stereo-split
        if (!barPeaks || barPeaks.length !== barCount) {
          barPeaks = new Array(barCount).fill(0);
        }
        if (!barVelocities || barVelocities.length !== barCount) {
          barVelocities = new Array(barCount).fill(0);
        }
        for (const band of bands) {
          ctx.fillStyle = band.color + "18";
          ctx.fillRect(0, baseY - 2 * dpr, w, 2 * dpr);
          for (let i = band.start; i < band.end; i++) {
            const v = freq[i * step] / 255;
            const boosted =
              v +
              phraseFlash * 0.35 +
              (sync?.lineProgress ?? 0) * 0.1 +
              d.bass * 0.08 +
              (d.beatPhase && d.beatPhase < 0.5 ? (1 - d.beatPhase * 2) * 0.12 : 0);
            const targetH = boosted * h * 0.65 * energyMod;
            const springK = 0.26;
            const damping = 0.73;
            const displacement = targetH - barPeaks[i];
            barVelocities[i] = (barVelocities[i] + springK * displacement) * damping;
            const bh = Math.max(0, barPeaks[i] + barVelocities[i]);
            // Update peak store separately so fallback uses the smoothed value.
            if (bh > barPeaks[i]) barPeaks[i] = bh;
            else barPeaks[i] = Math.max(bh, barPeaks[i] * PEAK_DECAY);
            const x = Math.round(i * barW);
            const y = Math.round(baseY - bh);
            const bw = Math.round(barW) - 2;
            const radius = Math.min(bw / 2, 3 * dpr);
            ctx.fillStyle = band.color;
            ctx.beginPath();
            ctx.roundRect(x + 1, y, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.fillRect(x + 1, y, bw, Math.max(1, bh * 0.25));
            const peakY = Math.round(baseY - barPeaks[i]);
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillRect(x + 1, peakY - 1 * dpr, bw, 1.5 * dpr);
            // Beat glow on active bar
            if (d.beat && v > 0.4) {
              ctx.shadowColor = band.color;
              ctx.shadowBlur = 6 * dpr;
              ctx.fillRect(x + 1, y, bw, bh + 2 * dpr);
              ctx.shadowBlur = 0;
            }
          }
        }
      } else if (mode === "stacked-frequency-bands") {
        const barCount = 48;
        const step = Math.floor(freq.length / barCount);
        const barW = w / barCount;
        const baseY = Math.round(h * 0.88);
        const layers = [
          { name: "low", start: 0, end: Math.floor(step * barCount * 0.25), color: colors[0] },
          { name: "mid", start: Math.floor(step * barCount * 0.25), end: Math.floor(step * barCount * 0.65), color: colors[1] },
          { name: "high", start: Math.floor(step * barCount * 0.65), end: Math.floor(step * barCount * 1), color: colors[2] || colors[1] },
        ];
        // Lazy-init peaks + spring velocities for stacked bands
        if (!barPeaks || barPeaks.length !== barCount) {
          barPeaks = new Array(barCount).fill(0);
        }
        if (!barVelocities || barVelocities.length !== barCount) {
          barVelocities = new Array(barCount).fill(0);
        }
        for (let i = 0; i < barCount; i++) {
          const x = Math.round(i * barW);
          const bw = Math.round(barW) - 2;
          const radius = Math.min(bw / 2, 3 * dpr);
          let layerY = baseY;
          let topY = baseY;
          let stackH = 0;
          for (const layer of layers) {
            const idx = Math.min(layer.start + i, freq.length - 1);
            const v = freq[idx] / 255;
            const boosted =
              v +
              phraseFlash * 0.35 +
              (sync?.lineProgress ?? 0) * 0.1 +
              d.bass * 0.08 +
              (d.beatPhase && d.beatPhase < 0.5 ? (1 - d.beatPhase * 2) * 0.12 : 0);
            const rawLh = boosted * h * 0.22 * energyMod;
            const ly = Math.round(layerY - rawLh);
            ctx.fillStyle = layer.color;
            ctx.beginPath();
            ctx.roundRect(x + 1, ly, bw, rawLh + 2 * dpr, [radius, radius, 0, 0]);
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.1)";
            ctx.fillRect(x + 1, ly, bw, Math.max(1, rawLh * 0.25));
            topY = ly;
            layerY = ly;
            stackH += rawLh;
          }
          // Spring-smoothed total stack height for peak tracking only.
          const springK = 0.24;
          const damping = 0.74;
          const displacement = stackH - barPeaks[i];
          barVelocities[i] = (barVelocities[i] + springK * displacement) * damping;
          const smoothStackH = Math.max(0, barPeaks[i] + barVelocities[i]);
          if (smoothStackH > barPeaks[i]) barPeaks[i] = smoothStackH;
          else barPeaks[i] = Math.max(smoothStackH, barPeaks[i] * PEAK_DECAY);
          const peakY = Math.round(baseY - barPeaks[i]);
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.fillRect(x + 1, peakY - 1 * dpr, bw, 1.5 * dpr);
          // Beat glow on top layer
          if (d.beat) {
            const topLayer = layers[layers.length - 1];
            const idx = Math.min(topLayer.start + i, freq.length - 1);
            const v = freq[idx] / 255;
            if (v > 0.35) {
              ctx.shadowColor = topLayer.color;
              ctx.shadowBlur = 6 * dpr;
              ctx.fillStyle = "rgba(255,255,255,0.15)";
              ctx.fillRect(x + 1, topY, bw, baseY - topY);
              ctx.shadowBlur = 0;
            }
          }
        }
      } else if (mode === "dot-peak-matrix") {
        const barCount = 64;
        const step = Math.floor(freq.length / barCount);
        const cols = barCount;
        const rows = 12;
        const cellW = w / cols;
        const cellH = h / rows;
        const dotR = Math.min(cellW, cellH) * 0.35;
        const barGradients = getGradients(mode, colors);
        if (!barVelocities || barVelocities.length !== barCount) {
          barVelocities = new Array(barCount).fill(0);
        }
        for (let i = 0; i < cols; i++) {
          const v = freq[i * step] / 255;
          const boosted =
            v +
            phraseFlash * 0.35 +
            (sync?.lineProgress ?? 0) * 0.1 +
            d.bass * 0.08 +
            (d.beatPhase && d.beatPhase < 0.5 ? (1 - d.beatPhase * 2) * 0.12 : 0);
          const targetRows = boosted * rows * energyMod;
          const springK = 0.22;
          const damping = 0.75;
          const displacement = targetRows - barVelocities[i];
          barVelocities[i] = (barVelocities[i] + springK * displacement) * damping;
          const activeRows = Math.max(0, Math.min(rows, Math.round(barVelocities[i])));
          const cIdx = Math.floor((i / cols) * colors.length);
          for (let r = 0; r < rows; r++) {
            const cx = Math.round(i * cellW + cellW / 2);
            const cy = Math.round(h - (r + 0.5) * cellH);
            if (r < activeRows) {
              ctx.fillStyle = barGradients[cIdx % barGradients.length];
              ctx.beginPath();
              ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
              ctx.fill();
              if (d.beat && r === activeRows - 1) {
                ctx.shadowColor = colors[cIdx % colors.length];
                ctx.shadowBlur = 6 * dpr;
                ctx.beginPath();
                ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
              }
            } else {
              ctx.fillStyle = "rgba(255,255,255,0.08)";
              ctx.beginPath();
              ctx.arc(cx, cy, dotR * 0.6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      } else if (mode === "waveform") {
        // Depth grid behind waveform (vision: "faint 3D grid behind waves")
        ctx.strokeStyle = colors[0] + "18";
        ctx.lineWidth = dpr;
        const gridStep = Math.max(1, Math.floor(w / 12));
        for (let gx = 0; gx < w; gx += gridStep) {
          ctx.beginPath();
          ctx.moveTo(gx, h * 0.2);
          ctx.lineTo(
            gx + 8 * dpr * Math.sin(performance.now() * 0.0003 + gx * 0.01),
            h * 0.8,
          );
          ctx.stroke();
        }
        for (let gy = h * 0.25; gy < h * 0.75; gy += h * 0.15) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(w, gy);
          ctx.stroke();
        }
        // 2026 smooth: 3-point Gaussian-ish moving average (Ollama fix #2) + HSB hue drift
        if (!smoothed || smoothed.length !== wave.length) {
          smoothed = new Uint8Array(wave.length);
        }
        for (let i = 0; i < wave.length; i++) {
          const prev = wave[Math.max(0, i - 1)];
          const next = wave[Math.min(wave.length - 1, i + 1)];
          smoothed[i] = prev * 0.25 + wave[i] * 0.5 + next * 0.25;
        }
        ctx.strokeStyle = colors[1];
        ctx.lineWidth = 2.2 * dpr;
        ctx.shadowColor = colors[0];
        ctx.shadowBlur =
          9 * dpr +
          phraseFlash * 14 +
          d.peak * 10 * dpr +
          effectiveEnergy * 8 * dpr;
        ctx.beginPath();
        const slice = w / smoothed.length;
        // Spring-smoothed amplitude envelope for the waveform path.
        const springK = 0.22;
        const damping = 0.75;
        if (!waveEnvelope || waveEnvelope.length !== smoothed.length) {
          waveEnvelope = new Array(smoothed.length).fill(0);
        }
        if (!waveVelocities || waveVelocities.length !== smoothed.length) {
          waveVelocities = new Array(smoothed.length).fill(0);
        }
        for (let i = 0; i < smoothed.length; i++) {
          const x = i * slice;
          const v = (smoothed[i] - 128) / 128;
          const targetAmp = v * h * 0.35 * (1 + effectiveEnergy * 0.85 + phraseFlash * 0.45 + d.bass * 0.25);
          const displacement = targetAmp - waveEnvelope[i];
          waveVelocities[i] = (waveVelocities[i] + springK * displacement) * damping;
          waveEnvelope[i] = waveEnvelope[i] + waveVelocities[i];
          const y =
            h / 2 + waveEnvelope[i];
          const xOff =
            (sync?.lineProgress ?? 0) *
            14 *
            dpr *
            Math.sin(i * 0.01 + performance.now() * 0.001);
          if (i === 0) ctx.moveTo(x + xOff, y);
          else ctx.lineTo(x + xOff, y);
        }
        ctx.stroke();
        // Secondary harmonic faint line (vision: "secondary waveform")
        ctx.strokeStyle = colors[2] + "88";
        ctx.lineWidth = 1.2 * dpr;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        for (let i = 0; i < wave.length; i += 2) {
          const x = i * slice;
          const idx2 = (i * 3) % wave.length;
          const v2 = (wave[idx2] - 128) / 128;
          const y2 = h / 2 + v2 * h * 0.18 * (1 + d.treble * 0.6) * 0.5;
          if (i === 0) ctx.moveTo(x, y2);
          else ctx.lineTo(x, y2);
        }
        ctx.stroke();
        // Peak particles — glowing dots along peaks (vision)
        ctx.shadowBlur = 8 * dpr;
        for (let i = 0; i < wave.length; i += 24) {
          const v = (wave[i] - 128) / 128;
          if (Math.abs(v) > 0.55) {
            const x = i * slice;
            const y = h / 2 + v * h * 0.35 * (1 + d.energy * 0.5);
            ctx.fillStyle = d.beat ? "#ffffff" : colors[1];
            ctx.shadowColor = colors[0];
            ctx.beginPath();
            ctx.arc(x, y, 2.5 * dpr + d.peak * 2 * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.shadowBlur = 0;
      } else if (mode === "radial") {
        const cx = w / 2,
          cy = h / 2;
        const baseR = Math.min(w, h) * 0.18;
        const sectionRot = (sync?.sectionProgress ?? 0) * Math.PI * 0.5;
        if (!barVelocities || barVelocities.length !== 64) {
          barVelocities = new Array(64).fill(0);
        }
        for (let i = 0; i < 64; i++) {
          const v = freq[Math.floor((i / 64) * freq.length * 0.6)] / 255;
          const angle = (i / 64) * Math.PI * 2 + sectionRot;
          const r0 = baseR;
          const targetR1 =
            baseR +
            v *
              baseR *
              1.2 *
              (1 + phraseFlash * 0.6 + effectiveEnergy * 0.4);
          const springK = 0.24;
          const damping = 0.74;
          const displacement = targetR1 - (barVelocities[i] || 0);
          barVelocities[i] = (barVelocities[i] + springK * displacement) * damping;
          const r1 = Math.max(r0, barVelocities[i] + r0);
          const x0 = cx + Math.cos(angle) * r0;
          const y0 = cy + Math.sin(angle) * r0;
          const x1 = cx + Math.cos(angle) * r1;
          const y1 = cy + Math.sin(angle) * r1;
          ctx.strokeStyle = colors[i % colors.length];
          ctx.lineWidth = 2 * dpr + v * 4 * dpr;
          ctx.globalAlpha = 0.7 + v * 0.3;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // Enhanced center anchor with glow and pulsing core (vision feedback)
        const coreR = baseR * 0.35 * (1 + phraseFlash * 0.5 + d.bass * 0.3);
        const glowR = coreR * 3;
        const grd = ctx.createRadialGradient(
          cx,
          cy,
          coreR * 0.2,
          cx,
          cy,
          glowR,
        );
        grd.addColorStop(0, colors[0] + "cc");
        grd.addColorStop(0.4, colors[1] + "66");
        grd.addColorStop(1, "transparent");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fill();
        // Secondary orbital ring
        ctx.strokeStyle = colors[2] + "55";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 1.8 + d.energy * 8 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        // Solid core
        ctx.fillStyle = colors[0];
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fill();
      } else if (mode === "spectrogram") {
        const specW = w;
        const specH = h;
        const sliceW = Math.max(2, Math.round(2 * dpr));
        const binCount = Math.floor(freq.length * 0.5);
        // Blit existing canvas to the left by sliceW (GPU-accelerated, replaces costly CPU getImageData)
        ctx.drawImage(
          canvas,
          sliceW,
          0,
          specW - sliceW,
          specH,
          0,
          0,
          specW - sliceW,
          specH,
        );
        // Clear rightmost strip
        ctx.fillStyle = bg;
        ctx.fillRect(specW - sliceW, 0, sliceW, specH);
        // Draw new slice on the right
        const binH = specH / binCount;
        for (let i = 0; i < binCount; i++) {
          const v = freq[i] / 255;
          if (v < 0.02) continue;
          const y = specH - (i + 1) * binH;
          const hue = (1 - v) * 240;
          const rgb = hslToRgb(hue / 360, 1, 0.5);
          ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
          ctx.fillRect(specW - sliceW, y, sliceW, Math.ceil(binH));
        }
        // Axis labels (frequency Hz on Y, time on X)
        ctx.fillStyle = colors[0] + "90";
        ctx.font = `${10 * dpr}px monospace`;
        ctx.textAlign = "right";
        const nyquist = 22050; // assume 44.1kHz sample rate
        const maxFreq = Math.floor(nyquist / 2);
        const labelCount = 5;
        for (let i = 0; i <= labelCount; i++) {
          const freqHz = Math.round((maxFreq / labelCount) * i);
          const y = specH - (specH / labelCount) * i;
          ctx.fillText(`${freqHz}Hz`, 28 * dpr, y + 3 * dpr);
          ctx.fillRect(30 * dpr, y, specW - 32 * dpr, 0.5);
        }
        ctx.textAlign = "center";
        ctx.fillText("Time →", specW / 2, specH - 4 * dpr);
        if (phraseFlash > 0.05) {
          ctx.fillStyle = `rgba(255,255,255,${phraseFlash * 0.1})`;
          ctx.fillRect(0, 0, w, h);
        }
      } else if (mode === "lissajous") {
        const cx = w / 2,
          cy = h / 2;
        const bassIdx = Math.floor(freq.length * 0.1);
        const midIdx = Math.floor(freq.length * 0.4);
        const bassV =
          freq.slice(0, bassIdx).reduce((a, b) => a + b, 0) /
          (bassIdx * 255 || 1);
        const midV =
          freq.slice(bassIdx, midIdx).reduce((a, b) => a + b, 0) /
          ((midIdx - bassIdx) * 255 || 1);
        const ampX =
          w * 0.35 * (1 + bassV * 0.6 + effectiveEnergy * 0.3);
        const ampY =
          h * 0.35 * (1 + midV * 0.6 + effectiveEnergy * 0.3);
        const t = performance.now() * 0.001;
        ctx.strokeStyle = colors[1];
        ctx.lineWidth = 2 * dpr;
        ctx.shadowColor = colors[0];
        ctx.shadowBlur = 6 * dpr + phraseFlash * 10;
        ctx.beginPath();
        const steps = 256;
        for (let i = 0; i < steps; i++) {
          const frac = i / steps;
          const angle = frac * Math.PI * 2 + t * (1 + d.bass);
          const x = cx + Math.sin(angle * (1 + bassV * 3)) * ampX;
          const y = cy + Math.cos(angle * (1 + midV * 2)) * ampY;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Draw current-point glow (must match the loop's angle math above)
        const curAngle = t * (1 + d.bass);
        const curX = cx + Math.sin(curAngle * (1 + bassV * 3)) * ampX;
        const curY = cy + Math.cos(curAngle * (1 + midV * 2)) * ampY;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(curX, curY, 4 * dpr + phraseFlash * 6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      } else if (mode === "constellation") {
        const points: { x: number; y: number; v: number }[] = [];
        const step = 8;
        for (let i = 0; i < freq.length; i += step) {
          const v = freq[i] / 255;
          if (v > 0.18) {
            const x = (i / freq.length) * w;
            const y = h - v * h * 0.85;
            points.push({ x, y, v });
            if (points.length >= 64) break;
          }
        }
        // Draw connections - optimized: spatial partition to reduce O(n²) complexity
        ctx.strokeStyle = colors[0] + "30";
        ctx.lineWidth = dpr;
        const maxPoints = points.length;
        const gridStep = 60 * dpr;
        // Use spatial grid to limit distance checks
        const grid = new Map<string, number[]>();
        for (let i = 0; i < maxPoints; i++) {
          const p = points[i];
          const gx = Math.floor(p.x / gridStep);
          const gy = Math.floor(p.y / gridStep);
          const key = `${gx},${gy}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key)!.push(i);
        }
        for (let i = 0; i < maxPoints; i++) {
          const p = points[i];
          const gx = Math.floor(p.x / gridStep);
          const gy = Math.floor(p.y / gridStep);
          // Check only neighboring grid cells
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const neighborKey = `${gx + dx},${gy + dy}`;
              const neighbors = grid.get(neighborKey);
              if (neighbors) {
                for (const j of neighbors) {
                  if (j <= i) continue; // Avoid duplicate checks
                  const other = points[j];
                  const dist = Math.hypot(p.x - other.x, p.y - other.y);
                  if (dist < gridStep) {
                    ctx.globalAlpha = (1 - dist / gridStep) * 0.4;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(other.x, other.y);
                    ctx.stroke();
                  }
                }
              }
            }
          }
        }
        ctx.globalAlpha = 1;
        // Draw nodes with spring-smoothed radius per point.
        const constellationSpringK = 0.22;
        const constellationDamping = 0.75;
        const pointVelocities = new Array(maxPoints).fill(0);
        const pointRadii = new Array(maxPoints).fill(0);
        for (let i = 0; i < maxPoints; i++) {
          const p = points[i];
          const targetR =
            2 * dpr +
            p.v * 5 * dpr +
            (d.beat && p.v > 0.7 ? 3 * dpr : 0) +
            analyzedPunch * 3 * dpr;
          const displacement = targetR - pointRadii[i];
          pointVelocities[i] = (pointVelocities[i] + constellationSpringK * displacement) * constellationDamping;
          pointRadii[i] = Math.max(0, pointRadii[i] + pointVelocities[i]);
          const r = pointRadii[i];
          ctx.fillStyle =
            colors[Math.floor(p.v * colors.length) % colors.length];
          ctx.shadowColor = colors[0];
          ctx.shadowBlur =
            4 * dpr + p.v * 8 * dpr + analyzedPunch * 6 * dpr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      } else if (mode === "particles") {
        const energy = effectiveEnergy;
        const beat = d.beat;
        const spawnCount = Math.floor(
          energy * 6 + analyzedPunch * 8 + (beat ? 14 : 0),
        );
        for (let i = 0; i < spawnCount; i++) spawnParticle(w, h, energy, beat);
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          // Audio-reactive velocity: particles accelerate outward on beat/energy
          const accel =
            1 + energy * 0.5 + analyzedPunch * 0.6 + (beat ? 1.5 : 0);
          p.vx *= accel;
          p.vy *= accel;
          // Slight drag to prevent runaway speeds
          p.vx *= 0.995;
          p.vy *= 0.995;
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.012 + energy * 0.01;
          if (p.life <= 0 || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
            particles.splice(i, 1);
            continue;
          }
          const alpha = p.life * 0.8;
          const rgb = hslToRgb(p.hue / 360, 1, 0.5 + energy * 0.3);
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
          ctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha * 0.8})`;
          ctx.shadowBlur =
            6 * dpr + d.bass * 8 * dpr + analyzedPunch * 6 * dpr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * dpr + d.bass * 2 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        // Center glow
        const grd = ctx.createRadialGradient(
          w / 2,
          h / 2,
          0,
          w / 2,
          h / 2,
          Math.min(w, h) * 0.3,
        );
        grd.addColorStop(
          0,
          colors[0] +
            Math.floor(phraseFlash * 40 + d.bass * 60)
              .toString(16)
              .padStart(2, "0"),
        );
        grd.addColorStop(1, "transparent");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
    };
  }, [isPlaying, mode, bgColor, analyserRef, audioData]);

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ background: bgColor }}
      />
      <div className="absolute top-2 right-2 flex flex-col gap-2 z-10">
        <button
          onClick={handleAnalyze}
          disabled={analysisLoading}
          className="px-2 py-1 text-xs bg-black/50 hover:bg-black/70 text-white/80 rounded backdrop-blur-sm transition-colors disabled:opacity-50"
          title="Analyze this visualizer frame with Ollama"
        >
          {analysisLoading ? "Analyzing..." : "Analyze"}
        </button>
      </div>
      {analysis && (
        <div className="absolute bottom-2 left-2 right-2 z-10 max-h-48 overflow-y-auto bg-gray-900/95 backdrop-blur-sm rounded-lg border border-white/10 shadow-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-white/60 font-medium">Vision feedback — {analysis.mode}</span>
            <span className="text-[10px] text-white/40">{analysis.model}</span>
          </div>
          <pre className="text-xs text-white/80 whitespace-pre-wrap font-mono leading-relaxed">{analysis.text}</pre>
        </div>
      )}
    </div>
  );
});

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// ============================================================================
// Animation helpers (2026 2D visualizer improvements)
// ============================================================================

/** Ease-out with a subtle overshoot for punchy bar transitions. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  return 1 + (c2 + 1) * Math.pow(t - 1, 3) + c2 * Math.pow(t - 1, 2);
}

/** Quadratic ease-out for smooth palette/section transitions. */
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Clamp a value into [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
