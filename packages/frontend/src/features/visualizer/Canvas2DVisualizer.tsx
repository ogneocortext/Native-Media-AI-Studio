/**
 * Canvas2DVisualizer — Canvas2D lane of the visualizer (bars / waveform / radial).
 *
 * Purpose: the 2D half of the visualizer. Renders audio-reactive bars,
 * waveform, and radial visuals from analyzed audio data (energy curve,
 * spectral centroid/rolloff/bandwidth, zero-crossing rate), driven frame by
 * frame via an rAF loop. Exposes Canvas2DFrameAccurateApi (Plan 2.9) so the
 * frame-accurate exporter can drive time synchronously — each call renders
 * exactly one frame, and readiness() tells the exporter whether there is
 * analyzed data to render from (a 300-frame MP4 of a blank canvas would look
 * like a successful export otherwise).
 *
 * Module split (AGENTS.md D14): Canvas2DVisualizer.tsx used to be a 1,560-line
 * monolith. Pure helpers (easing, color math, frequency mapping) were extracted
 * to canvas2dHelpers; per-mode effect budgets live in canvas2dModeBudget;
 * audio-frame derivation lives in services/analysisAudioFrame; the
 * frame-accurate render API surface lives in services/frameAccurateExport.
 * Keep new helpers in the matching module rather than here.
 *
 * Audio-library rule (D16): this component receives its audio data as props;
 * it does not read the library itself. The caller (Visualizer) uses
 * useAudioLibrary() only — not listAudioFiles().
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  easeOutQuad,
  lerpColor,
  normalizeHex,
  usesAsymmetricSmoothing,
  type PerceptualScale,
} from "./canvas2dHelpers";
import {
  allowsEffect,
  getModeBudget,
  resolveActiveEffects,
  VIGNETTE_ALPHA_CEILING,
  type Canvas2DMode,
} from "./canvas2dModeBudget";
import {
  type Shockwave,
  drawShockwaves,
  spawnShockwave,
  updateShockwaves,
} from "./shockwaves";
import {
  type IdleParticle,
  drawIdleParticles,
  updateIdleParticles,
} from "./idleParticles";
import { type Particle } from "./particles";
import { getVisualizerMode, type VisualizerModeRenderContext, type VisualizerModeState } from "./visualizerModeRegistry";
import { renderMode } from "./canvas2dModes";
import { FrameAccurateCanvas2D } from "./services/frameAccurateCanvas2d";
import type { FrameAccurateRenderApi } from "./services/frameAccurateExport";
import { useSpectralTimeline } from "./useSpectralTimeline";
import type { AudioAnalysisData, AudioData } from "./types";
import { HtmlCanvasRenderer } from "./HtmlCanvasRenderer";

export interface Canvas2DVisualizerRef {
  captureScreenshot: () => string | null;
}

/**
 * Plan 2.9 — deterministic render API published by the 2D lane for
 * frame-accurate export. The exporter (not the rAF loop) drives time; each
 * call renders exactly one frame synchronously.
 *
 * `readiness` is the 2D lane's extension of `FrameAccurateRenderApi`: the
 * shader lane can always render (its virtual frame is motion plus the
 * timeline), but a 2D frame is built from analyzed data, and a 300-frame MP4
 * of a blank canvas would look exactly like a successful export. The exporter
 * asks first and refuses with `reason` when there is nothing to render from.
 */
export interface Canvas2DFrameAccurateApi extends FrameAccurateRenderApi {
  readiness: () => { ok: boolean; reason?: string };
}

interface Props {
  audioData: React.MutableRefObject<AudioData>;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
  mode?: Canvas2DMode;
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
  /**
   * Plan 2.9 — deterministic LRC state at a virtual time. The live
   * `lrcSyncLive` snapshot describes *now*, which would make an exported
   * frame depend on when the export ran; this one is a function of time
   * alone. Optional: without it, virtual frames hold phrase flash at 0.
   */
  lrcSyncAt?: (tSec: number) => Props["lrcSync"];
  /** Backend analysis for the selected track, used only by virtual frames. */
  analysisData?: AudioAnalysisData | null;
  /** Raw library filename — the key the spectral timeline is fetched by. */
  trackFile?: string | null;
  bgColor?: string;
  onAnalysis?: (result: { text: string; model: string; mode: string }) => void;
  /** Honor OS reduced-motion preference — scales down phraseFlash, beat vignette, and trail persistence. */
  prefersReducedMotion?: boolean;
  /** Perceptual frequency scale for bar mapping (2026 research: bark/erb/mel for better human pitch perception). */
  perceptualScale?: PerceptualScale;
  /**
   * Plan 2.9 — frame-accurate export. When provided, the component publishes
   * its deterministic render API here after mount, and the exporter drives
   * frames manually at 1/fps steps. Meaningful in 2D mode, the same way the
   * shader lane's ref is meaningful in shader mode.
   */
  frameAccurateApiRef?: React.MutableRefObject<Canvas2DFrameAccurateApi | null>;
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
      lrcSyncAt,
      analysisData,
      trackFile,
      bgColor = "#050505",
      onAnalysis,
      prefersReducedMotion = false,
      perceptualScale = "log",
      frameAccurateApiRef,
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
    // Plan 2.9 — holders for the virtual-frame sources, so the draw effect
    // stays subscribed once (its deps are playback/mode/config, not data).
    const analysisHolder = useRef(analysisData);
    analysisHolder.current = analysisData;
    const lrcSyncAtHolder = useRef(lrcSyncAt);
    lrcSyncAtHolder.current = lrcSyncAt;
    // Measured per-frame band energies, from the same endpoint the shader lane
    // reads; null on tracks without a spectral timeline (the modelled tier).
    const { sampleAtTime: sampleSpectralTimeline, loading: spectralLoading } =
      useSpectralTimeline(trackFile ?? null, 24);

    // Smooth section palette transitions
    const currentPaletteRef = useRef<string[]>([]);
    const targetPaletteRef = useRef<string[]>([]);
    const paletteTRef = useRef(1);
    // Cache bar gradients to avoid per-frame createLinearGradient allocation.
    // Keyed by mode + palette + height so each gradient-using mode gets its own entry.
    const barGradientsCacheRef = useRef<{ key: string; gradients: CanvasGradient[] } | null>(null);
    const [analysis, setAnalysis] = useState<{ text: string; model: string; mode: string } | null>(
      null,
    );
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

    // Keyboard shortcut for analyze (Ctrl+Shift+A)
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a") {
          e.preventDefault();
          handleAnalyze();
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [handleAnalyze, mode]);

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

      // Plan 2.9 — deterministic export state, owned by FrameAccurateCanvas2D.
      // The draw loop reads isExportActive/virtualTimeSec/virtualRand/
      // virtualAudioData/virtualFreqBuffer/virtualWaveBuffer from the API
      // instance; beginDeterministicRun/resetState/clearPools reset shared
      // state so frame 0 starts clean.
      let api: FrameAccurateCanvas2D | null = null;

      /** Random for the frame being drawn: seeded during export, live otherwise. */
      const rand = (): number => api!.virtualRand?.() ?? Math.random();
      /** Wall clock for the frame being drawn: virtual time during export. */
      const nowMs = (): number =>
        api!.virtualTimeSec !== null ? api!.virtualTimeSec * 1000 : performance.now();

      // 2026 animation state: spring-physics bar smoothing, beat vignette, radial rotation
      let barVelocities: number[] | null = null;
      // Plan 2.1: asymmetric (0.8 attack / 0.12 release) envelope state for the
      // modes listed in ASYMMETRIC_SMOOTHING_MODES; null everywhere else.
      let smoothedBars: number[] | null = null;
      // Consecutive all-silent frequency frames; used to detect a track switch
      // (see the reset in the draw loop). Not per-mode state.
      let silentFrames = 0;
      let beatVignette = 0;
      // Waveform spring envelope state

      const shockwaves: Shockwave[] = [];

      // Idle ambient particles — subtle floating motes when no track is playing
      const idleParticles: IdleParticle[] = [];
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
      const particles: Particle[] = [];

      // Plan 2.9 — callbacks that reset shared state so frame 0 starts clean.
      // Called by FrameAccurateCanvas2D.beginDeterministicRun before the first
      // virtual frame renders.
      const resetState = () => {
        barVelocities = null;
        smoothedBars = null;

        phraseFlash = 0;
        beatVignette = 0;
        silentFrames = 0;
      };
      const clearPools = () => {
        particles.length = 0;
        idleParticles.length = 0;
        shockwaves.length = 0;
      };

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
        // Plan 2.9 — while a deterministic export drives frames manually, the
        // rAF loop stays alive but renders nothing. A live frame would advance
        // particle/spring state between captures and make two runs diverge;
        // virtual frames run the same code path with `virtualTime` set.
        if (api?.isExportActive && api?.virtualTimeSec === null) {
          raf = requestAnimationFrame(draw);
          return;
        }
        const vTime = api?.virtualTimeSec;
        const isVirtual = vTime !== null;
        const analyser = analyserRef.current;
        const d = api?.virtualAudioData ?? audioData.current;
        // Live per-frame sync preferred; React-state snapshot as fallback.
        // Virtual frames read the *deterministic* sampler: the live snapshot
        // describes now, so using it would tie an exported frame to when the
        // export happened to run. (Checked on `vTime` directly, not on
        // `isVirtual`, so TypeScript narrows the argument to a number.)
        const sync =
          vTime != null
            ? (lrcSyncAtHolder.current?.(vTime) ?? null)
            : (lrcSyncLiveHolder.current?.current ?? lrcSyncPropHolder.current);
        const section = sync?.currentSection || "VERSE";
        const target = palettes[section] || palettes.VERSE;

        // Prefer blended live+analysis energy for visual punch; fall back to raw
        // analyzed energy only when the blended value is actually invalid (NaN /
        // Infinity), not when it is legitimately 0 during silence.
        const effectiveEnergy = Number.isFinite(d.energy) ? d.energy : d.analyzedEnergy || 0;
        const energyMod = 1 + effectiveEnergy * 0.4;
        const analyzedPunch = d.analyzedEnergy || 0;

        // Reduce motion when the user or OS requests it — scales down phraseFlash,
        // beat vignette, and trail persistence without disabling the visualizer.
        const motionScale = prefersReducedMotion ? 0.35 : 1;

        // Lazy-size frequency/waveform buffers when the analyser config changes.
        // Always allocated (default 1024/2048) so downstream code never sees null —
        // buffers are only *filled* with real data while playing. A virtual
        // frame swaps in its synthesized buffers instead (see the API below).
        if (!freq || freq.length !== (analyser?.frequencyBinCount ?? 1024)) {
          freq = new Uint8Array(analyser?.frequencyBinCount ?? 1024);
        }
        if (!wave || wave.length !== (analyser?.fftSize ?? 2048)) {
          wave = new Uint8Array(analyser?.fftSize ?? 2048);
        }
        if (isVirtual && api?.virtualFreqBuffer && api?.virtualWaveBuffer) {
          freq = api.virtualFreqBuffer;
          wave = api.virtualWaveBuffer;
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
        if (!currentPaletteRef.current.length) currentPaletteRef.current = [...target];
        const colors = currentPaletteRef.current.map((c, i) => {
          const tc = targetPaletteRef.current[i] || c;
          return lerpColor(c, tc, t);
        });
        if (paletteTRef.current >= 1) currentPaletteRef.current = [...targetPaletteRef.current];

        if (sync?.isPhraseStart) phraseFlash = 1;
        phraseFlash = Math.max(0, phraseFlash - 0.07 * motionScale);
        // Beat vignette pulse — subtle screen-edge darkening on transients.
        if (d.beat) beatVignette = Math.min(1, beatVignette + 0.35 * motionScale);
        beatVignette = Math.max(0, beatVignette - 0.06 * motionScale);

        // Size the backing store only when the container changes (see applySize above).
        const bg = normalizeHex(bgColor);
        const w = canvas.width;
        const h = canvas.height;
        // Drum-type shockwaves — expanding rings color-coded by transient class.
        // Gated on the mode budget: spawning rings a mode will not draw leaks
        // them into the next beat's frame (and fills the 8-ring pool), so a
        // mode-switch away from `bars`/`radial` would show phantom rings.
        if (d.beat && allowsEffect(mode, "shockwaves")) {
          spawnShockwave(shockwaves, w, h, d.drumType ?? undefined, rand);
        }
        updateShockwaves(shockwaves, motionScale);

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
        if (
          mode === "bars" ||
          mode === "mirrored-bars" ||
          mode === "stereo-split-bars" ||
          mode === "stacked-frequency-bands" ||
          mode === "dot-peak-matrix"
        ) {
          if (
            !barVelocities ||
            barVelocities.length !==
              (mode === "dot-peak-matrix"
                ? 64
                : mode === "stereo-split-bars" || mode === "stacked-frequency-bands"
                  ? 48
                  : 64)
          ) {
            barVelocities = new Array(
              mode === "dot-peak-matrix"
                ? 64
                : mode === "stereo-split-bars" || mode === "stacked-frequency-bands"
                  ? 48
                  : 64,
            ).fill(0);
          }
        } else {
          barVelocities = null;
        }

        // Skip painting while the tab is hidden — the parent's analyser loop also
        // pauses, so this only saves battery; the rAF loop stays alive.
        // A virtual frame is not a live paint, so the hidden-tab skip must not
        // swallow it: the export loop is exactly what keeps running when the
        // user switches away mid-export (plan 2.9's "drops nothing" clause).
        if (!isVirtual && typeof document !== "undefined" && document.hidden) {
          raf = requestAnimationFrame(draw);
          return;
        }
        // -----------------------------------------------------------------------
        // Global effect stack — now budgeted per mode.
        //
        // Previously all four of these drew on every frame in every mode, before the
        // mode's own rendering: trail/ghost fill, phrase flash, beat vignette and drum
        // shockwaves. That 5-7 simultaneous large-area effects with no focal point is
        // the "visual noise" failure in
        // docs/knowledge/canvas2d-visualizer-diagnosis-2026-10-02/README.md.
        // The budget (canvas2dModeBudget.ts) decides which of them may draw this
        // frame, and caps it at two.
        // -----------------------------------------------------------------------
        const budget = getModeBudget(mode);
        // An LRC track is loaded iff we have a live sync snapshot with a section.
        // (`sync` already merges lrcSyncLive and lrcSync via the holder above.)
        const hasLyrics = Boolean(sync?.currentSection);
        const active = resolveActiveEffects(mode, {
          hasLyrics,
          beatActive: beatVignette > 0.01 || d.beat,
          phraseActive: phraseFlash > 0.05,
        });

        // 2026 p5.js trail: background alpha 5-15 for ghostly persistence
        // (visual-flux + p5js.ai 2026). Alpha now comes from the mode budget
        // rather than a 4-level nested ternary with duplicated reduced-motion
        // branches. A mode with no trails clears fully each frame, which is what
        // `spectrogram` was already special-casing for itself.
        if (isPlaying || isVirtual) {
          const trailAlpha = prefersReducedMotion ? budget.trailAlphaReduced : budget.trailAlpha;
          if (active.has("trails") && trailAlpha !== null) {
            ctx.fillStyle = bg + trailAlpha.toString(16).padStart(2, "0").toUpperCase();
            ctx.fillRect(0, 0, w, h);
          } else {
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);
          }
        } else {
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
        }

        if (active.has("phraseFlash") && phraseFlash > 0.05) {
          ctx.fillStyle = `rgba(255,255,255,${phraseFlash * 0.08})`;
          ctx.fillRect(0, 0, w, h);
        }
        // Beat vignette — radial edge darkening, alpha ceiling halved per the
        // diagnosis doc ("halve the alpha ceiling globally, then re-evaluate").
        if (active.has("beatVignette") && beatVignette > 0.01) {
          const vigGrd = ctx.createRadialGradient(
            w / 2,
            h / 2,
            Math.min(w, h) * 0.35,
            w / 2,
            h / 2,
            Math.max(w, h) * 0.72,
          );
          vigGrd.addColorStop(0, "rgba(0,0,0,0)");
          vigGrd.addColorStop(1, `rgba(0,0,0,${beatVignette * VIGNETTE_ALPHA_CEILING})`);
          ctx.fillStyle = vigGrd;
          ctx.fillRect(0, 0, w, h);
        }
        // Drum shockwaves — expanding rings, only on modes whose budget allows
        // them *this frame* (they are spawned further up, before this block).
        if (active.has("shockwaves")) {
          drawShockwaves(ctx, shockwaves, dpr);
        }

        // The idle branch fires when there is nothing to react to. A virtual
        // frame always has something (its synthesized buffers), even when the
        // user never pressed play — so it takes the live path instead of the
        // "drop a track" placeholder.
        if (!isVirtual && (!analyser || !isPlaying)) {
          // 2026 kinetic idle: variable-font-inspired — weight pulses with phraseFlash, not static
          // Ambient particle layer — soft floating motes that keep the canvas feeling alive
          updateIdleParticles(idleParticles, w, h, motionScale, rand);
          drawIdleParticles(ctx, idleParticles, dpr);
          const idlePulse =
            phraseFlash * 0.3 +
            Math.sin(nowMs() * 0.002 * motionScale) * 0.08 * motionScale;
          const t = nowMs() * 0.001;
          const breathe = 0.55 + Math.sin(t * 0.8) * 0.15;
          ctx.textAlign = "center";
          // Soft glow behind the text so it reads over the particle field.
          ctx.shadowColor = colors[0] + "80";
          ctx.shadowBlur = 18 * dpr;
          ctx.fillStyle = colors[0];
          ctx.globalAlpha = breathe;
          ctx.font = `600 ${22 * dpr}px system-ui, sans-serif`;
          ctx.fillText("Drop a track to see it move", w / 2, h / 2 - 4 * dpr);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.45 + idlePulse * 0.5;
          ctx.fillStyle = colors[1] || "#a5b4fc";
          ctx.font = `${12 * dpr}px system-ui, sans-serif`;
          ctx.fillText("pick a track above — visuals react to the beat", w / 2, h / 2 + 20 * dpr);
          ctx.globalAlpha = 1;
          raf = requestAnimationFrame(draw);
          return;
        }

        if (isVirtual) {
          // The synthesized buffers are already in `freq`/`wave` — do not
          // overwrite them from the analyser (which is frozen or null).
        } else if (analyser) {
          analyser.getByteFrequencyData(freq as Uint8Array<ArrayBuffer>);
          analyser.getByteTimeDomainData(wave as Uint8Array<ArrayBuffer>);
        }

        // Plan 2.1: per-mode smoothing decision as data (canvas2dHelpers).
        const asymmetric = usesAsymmetricSmoothing(mode);

        // Reset the envelope when the new track opens in silence.
        //
        // The draw loop is NOT torn down on a track switch: `audioData` is a
        // useRef, so its identity never changes and it cannot retrigger this
        // effect (the deps are isPlaying/mode/bgColor/analyserRef). Every
        // `let` above therefore survives the switch, and with release=0.15 a
        // loud track A leaves ~19 frames (~320 ms) of phantom bars decaying over
        // the first moments of a silent track B.
        //
        // Silence is the reliable signal: a track that has just started, or is
        // between selections, reads all-zero frequency data. Two consecutive
        // silent frames avoids resetting on a single dropped buffer between beats.
        if (asymmetric && smoothedBars) {
          let isSilent = true;
          for (let i = 0; i < freq.length; i += 16) {
            if (freq[i] !== 0) {
              isSilent = false;
              break;
            }
          }
          if (isSilent) {
            if (++silentFrames >= 2) {
              smoothedBars = null;
              barVelocities = null;
            }
          } else {
            silentFrames = 0;
          }
        }

        // Render via registry (Chrome 157+ HTML-in-Canvas compatible). Looks up
        // the mode render function from the registry; falls back to legacy
        // renderMode for any mode not yet registered there.
        const modeDef = getVisualizerMode(mode);
        const modeRenderFn = modeDef
          ? modeDef.render
          : ((ctx2: CanvasRenderingContext2D, ctxInfo2: VisualizerModeRenderContext, state2: VisualizerModeState) =>
              renderMode(mode, ctxInfo2.dpr, ctxInfo2.w, ctxInfo2.h, ctx2 as any, state2 as any));
        modeRenderFn(ctx, {
          ctx,
          dpr,
          w,
          h,
          canvas: canvasRef.current,
          d,
          syncLineProgress: sync?.lineProgress ?? 0,
          sectionProgress: sync?.sectionProgress ?? 0,
          colors,
          perceptualScale: perceptualScale as "bark" | "erb" | "mel" | "linear",
          freq,
          wave,
          bg: bgColor,
          nowMs,
          analyser: analyserRef.current,
          motionScale,
          phraseFlash,
          energyMod,
          analyzedPunch,
          isDownbeat: audioData.current.isDownbeat ?? false,
          rand,
          getGradients,
          asymmetric,
        }, {
          smoothed,
          particles: particles as unknown as VisualizerModeState["particles"],
        });

        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);

      // Publish the deterministic render API. Re-published on every effect
      // run so the closure always sees the current `draw` and `api`.
      api = new FrameAccurateCanvas2D({
        sampleSpectralTimeline,
        spectralLoading,
        analysisHolder,
        analyserRef,
        canvasRef,
        draw,
        resetState,
        clearPools,
      });

      if (frameAccurateApiRef) {
        frameAccurateApiRef.current = api;
      }

      return () => {
        cancelAnimationFrame(raf);
        resizeObserver?.disconnect();
        // A torn-down component must not leave an API pointing at its closures.
        if (frameAccurateApiRef) frameAccurateApiRef.current = null;
      };
    }, [isPlaying, mode, bgColor, analyserRef, audioData, frameAccurateApiRef, sampleSpectralTimeline]);

    return (
      <div
        className="absolute inset-0"
        role="application"
        aria-label={`2D visualizer — ${mode} mode`}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ background: bgColor }}
        />
        {/* HTML-in-Canvas rendered content when Chrome 157+, DOM overlay fallback when Chrome 156 */}
        <HtmlCanvasRenderer canvas={canvasRef.current} x={0} y={0}>
          <div className="text-white/80 text-[24px] font-semibold leading-tight text-center w-full">
            <span className="block mb-2">{lrcSyncLive?.current?.currentSection?.toUpperCase() || "—"}</span>
            <span className="block text-[18px]">{lrcSyncLive?.current?.sectionProgress}</span>
          </div>
        </HtmlCanvasRenderer>
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
              <span className="text-xs text-white/60 font-medium">
                Vision feedback — {analysis.mode}
              </span>
              <span className="text-[10px] text-white/40">{analysis.model}</span>
            </div>
            <pre className="text-xs text-white/80 whitespace-pre-wrap font-mono leading-relaxed">
              {analysis.text}
            </pre>
          </div>
        )}
      </div>
    );
  },
);
