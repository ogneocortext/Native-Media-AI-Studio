/**
 * Per-mode render functions for the Canvas2D visualizer.
 *
 * Extracted from Canvas2DVisualizer.tsx — no logic changed. Each mode renders
 * into a shared `CanvasRenderingContext2D` using a context bundle of per-frame
 * inputs and a mutable per-mode state object.
 *
 * Modes: bars, mirrored-bars, segmented-led-bars, stereo-split-bars,
 * stacked-frequency-bands, dot-peak-matrix, waveform, radial, spectrogram,
 * lissajous, constellation, aurora.
 */
import {
  beatPhaseEnvelope,
  clamp,
  damp,
  dampDisplay,
  dampLambda,
  drawGlowSprite,
  easeOutBack,
  fbm,
  hexToRgb,
  hslToRgb,
  makeFreqMapper,
  sampleMappedBand,
  withAlpha,
  type PerceptualScale,
} from "./canvas2dHelpers";
import { updateAndDrawParticles, type Particle } from "./particles";

export interface BarModeContext {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  w: number;
  h: number;
  canvas: HTMLCanvasElement | null;
  d: {
    bass: number;
    treble: number;
    beat: boolean;
    beatPhase?: number | null;
    analyzedEnergy?: number;
    peak?: number;
    energy?: number;
    mid?: number;
  };
  syncLineProgress: number;
  sectionProgress: number;
  /** T-VIZ-21 — current lyric line for kinetic-type (null = instrumental). */
  lyric?: {
    text: string;
    start: number;
    end: number;
    section?: string;
    words?: { word: string; start: number; end: number }[];
  } | null;
  /** 0..1 progress through the current lyric line. */
  lyricProgress?: number;
  /** Current musical section label for section-aware modes. */
  sectionName?: string;
  colors: string[];
  perceptualScale: PerceptualScale | undefined;
  freq: Uint8Array | null;
  wave: Uint8Array | null;
  bg: string;
  nowMs: () => number;
  analyser: AnalyserNode | null;
  motionScale: number;
  phraseFlash: number;
  energyMod: number;
  analyzedPunch: number;
  isDownbeat: boolean;
  /** T-VIZ-16 — decaying spectral-flux onset envelope (0..1). */
  onset?: number;
  /** T-VIZ-19 — phase-locked beat envelope (0..1). */
  beatEnv?: number;
  rand: () => number;
  /** Cached gradient builder — keyed by mode + palette + height. */
  getGradients: (mode: string, cols: string[]) => CanvasGradient[];
}

export interface BarModeState {
  barVelocities: number[] | null;
  barPeaks: number[] | null;
  smoothedBars: number[] | null;
  /** T-VIZ-53 — second-stage damped display heights (normalized 0..1). */
  displayBars: number[] | null;
  /** T-VIZ-53 — damped per-layer band values for stacked mode (barCount*3). */
  displayBands: number[] | null;
  waveEnvelope: number[] | null;
  waveVelocities: number[] | null;
  smoothed: Uint8Array | null;
  particles: Particle[];
  lastMs: number | null;
  /**
   * Kinetic-type word-wrap + measureText cache. `measureText` ran per word
   * per frame (~30+ calls) even though the layout only changes when the
   * lyric line, its duration, or the font metrics change — key on those.
   */
  kineticLayout?: {
    key: string;
    spaceW: number;
    lines: {
      words: { text: string; start?: number; end?: number }[];
      widths: number[];
      fullW: number;
    }[];
  } | null;
}

const PEAK_DECAY = 0.985;

/** Shared boosted-value computation used by every bar-style mode. */
function boostedValue(rawV: number, ctx: BarModeContext): number {
  return (
    rawV +
    ctx.phraseFlash * 0.35 +
    ctx.syncLineProgress * 0.1 +
    ctx.d.bass * 0.08 +
    (ctx.d.beatPhase !== undefined && ctx.d.beatPhase !== null && ctx.d.beatPhase < 0.5
      ? (1 - ctx.d.beatPhase * 2) * 0.12
      : 0)
  );
}

/** Common per-bar preamble: compute freq, boosted target, and update smoothing state. */
function computeBarTarget(
  i: number,
  freqMap: (barIndex: number) => number,
  ctx: BarModeContext,
  state: BarModeState,
): { targetNorm: number; smoothH: number; springRising: boolean } {
  const rawV = sampleMappedBand(ctx.freq, freqMap, i) / 255;
  const boosted = boostedValue(rawV, ctx);
  const targetNorm = boosted * ctx.energyMod;
  // T-VIZ-15: `ctx.freq` arrives pre-enveloped by the shared stage, so the
  // freq component is already smooth — no per-mode spring. `smoothedBars`
  // now only remembers last frame's target for rise detection (the
  // easeOutBack overshoot in renderBars).
  const prevTarget = state.smoothedBars?.[i] ?? targetNorm;
  if (state.smoothedBars) state.smoothedBars[i] = targetNorm;
  const smoothH = targetNorm * ctx.h * 0.78;
  return { targetNorm, smoothH, springRising: targetNorm > prevTarget };
}

/**
 * Shared bar body: gradient fill + warm/cool mix overlays. Used by
 * `drawBar` (with reflection) and by mirrored-bars' upper bar, which
 * previously re-implemented this block inline — the two copies had
 * already drifted once (2026 audit).
 */
function drawBarBody(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  x: number,
  y: number,
  bw: number,
  bh: number,
  radius: number,
  gradient: CanvasGradient,
  warmMix: number,
  coolMix: number,
): void {
  ctx.fillStyle = gradient;
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
}

/** Draw a single rounded bar with gradient, warm/cool mix, and reflection. */
function drawBar(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  x: number,
  y: number,
  bw: number,
  bh: number,
  radius: number,
  gradient: CanvasGradient,
  warmMix: number,
  coolMix: number,
): void {
  drawBarBody(ctx, dpr, x, y, bw, bh, radius, gradient, warmMix, coolMix);
  if (bh > 1) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = gradient;
    // Reflection hangs below the bar's baseline (y + bh), not below the
    // canvas — the old `h + 2*dpr` origin was clipped offscreen entirely.
    const refH = bh * 0.3;
    const refY = y + bh + 2 * dpr;
    ctx.beginPath();
    ctx.roundRect(x + 1, refY, bw, refH, [0, 0, radius, radius]);
    ctx.fill();
    ctx.restore();
  }
}

/** Draw the falling peak indicator dash above a bar. */
function drawPeakIndicator(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  x: number,
  bw: number,
  baseY: number,
  peak: number,
  alpha = 0.85,
): void {
  const peakY = Math.round(baseY - peak);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fillRect(x + 1, peakY - 1 * dpr, bw, 1.5 * dpr);
}

/** Draw a beat flash on top of a bar. */
function drawBeatFlash(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  color: string,
  x: number,
  y: number,
  bw: number,
): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 1, y - 3 * dpr, bw, 3 * dpr);
  drawGlowSprite(ctx, color, x + 1 + bw / 2, y - dpr, bw + 10 * dpr, 8 * dpr, 0.7);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 1, y - 1 * dpr, bw, 1 * dpr);
}

/** Draw a downbeat dot above a bar. */
function drawDownbeatDot(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  x: number,
  y: number,
  barW: number,
  rand: () => number,
): void {
  ctx.fillStyle = `rgba(255,255,255,${0.85})`;
  ctx.beginPath();
  ctx.arc(x + barW / 2, y - 6 * dpr - rand() * 6 * dpr, 2 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

export function renderBars(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const barCount = 64;
  const barW = w / barCount;

  if (state.barPeaks?.length !== barCount) {
    state.barPeaks = new Array(barCount).fill(0);
  }
  if (state.smoothedBars?.length !== barCount) {
    state.smoothedBars = new Array(barCount).fill(0);
  }
  if (state.displayBars?.length !== barCount) {
    state.displayBars = new Array(barCount).fill(0);
  }

  // T-VIZ-53: second-stage display damp. The shared envelope smooths the
  // FFT data, but bar HEIGHT still tracks it nearly 1:1 — on dense mixes
  // the columns step between frames. Damping the rendered height (not the
  // analysis) adds the "fluid" tier the scorecard flagged as missing.
  state.lastMs ??= modeCtx.nowMs();
  const frameNow = modeCtx.nowMs();
  const frameDt = Math.min(0.1, Math.max(0, frameNow - state.lastMs) / 1000);
  state.lastMs = frameNow;
  const dispLambda = dampLambda(0.35);

  const freqLen = modeCtx.freq?.length ?? 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context.sampleRate,
  );

  const barGradients = modeCtx.getGradients("bars", modeCtx.colors);
  const baseY = Math.round(h * 0.88);

  // Subtle baseline — grounds the bars so they don't float on void.
  modeCtx.ctx.fillStyle = `rgba(255,255,255,${0.05 + modeCtx.d.bass * 0.05})`;
  modeCtx.ctx.fillRect(0, baseY, w, Math.max(1, dpr));

  // T-VIZ-53 ambient glow — the "ambient glow" layer from the proven
  // 2026 layering formula (music-viz-trends-2026.md). Bass+energy drive
  // intensity so quiet sections recede and drops bloom; additive sprite
  // keeps it cheap (cached canvas, no per-frame gradient alloc).
  const glowI = clamp(
    modeCtx.d.bass * 0.9 + (modeCtx.d.energy ?? modeCtx.d.analyzedEnergy ?? 0) * 0.35,
    0,
    1,
  );
  if (glowI > 0.02) {
    drawGlowSprite(
      modeCtx.ctx,
      modeCtx.colors[1] || modeCtx.colors[0],
      w / 2,
      h * 0.72,
      w * 1.15,
      h * 0.95,
      glowI * 0.32,
    );
  }

  for (let i = 0; i < barCount; i++) {
    const { smoothH, springRising } = computeBarTarget(i, freqMap, modeCtx, state);
    const easeT = clamp(smoothH / Math.max(1, h * 0.78 * modeCtx.energyMod), 0, 1);
    const easedH = smoothH * (1 + 0.08 * easeOutBack(easeT) * (springRising ? 1 : 0));
    const dispTarget = clamp(easedH / Math.max(1, h * 0.78), 0, 1.2);
    const disp = damp(state.displayBars[i], dispTarget, dispLambda, frameDt);
    state.displayBars[i] = disp;
    const bh = disp * h * 0.78;
    const x = Math.round(i * barW);
    const y = Math.round(baseY - bh);
    const bw = Math.round(barW) - 2;
    const radius = Math.min(bw / 2, 3 * dpr);
    const cIdx = Math.floor((i / barCount) * modeCtx.colors.length);
    const warmMix = i / barCount < 0.3 ? modeCtx.d.bass * 0.35 : 0;
    const coolMix = i / barCount > 0.7 ? modeCtx.d.treble * 0.35 : 0;

    drawBar(
      modeCtx.ctx,
      dpr,
      x,
      y,
      bw,
      bh,
      radius,
      barGradients[cIdx % barGradients.length],
      warmMix,
      coolMix,
    );

    // Falling peak indicator
    if (bh > state.barPeaks[i]) state.barPeaks[i] = bh;
    else state.barPeaks[i] = Math.max(bh, state.barPeaks[i] * PEAK_DECAY);
    drawPeakIndicator(modeCtx.ctx, dpr, x, bw, baseY, state.barPeaks[i], 0.45);

    if (modeCtx.d.beat && sampleMappedBand(modeCtx.freq, freqMap, i) / 255 > 0.55) {
      drawBeatFlash(modeCtx.ctx, dpr, modeCtx.colors[cIdx % modeCtx.colors.length], x, y, bw);
      if (modeCtx.isDownbeat) {
        drawDownbeatDot(modeCtx.ctx, dpr, x, y, barW, modeCtx.rand);
      }
    }
  }

  // Secondary harmonic overlay — one octave above each bar's mapped bin.
  // (The old code fed a raw bin index into freqMap as if it were a bar
  // index; t ≈ 8 pushed every sample to the top FFT bin, so the overlay
  // was a flat shimmer instead of per-bar harmonics.)
  modeCtx.ctx.globalAlpha = 0.22 + modeCtx.d.treble * 0.25;
  modeCtx.ctx.fillStyle = modeCtx.colors[2] || modeCtx.colors[1];
  for (let i = 0; i < barCount; i++) {
    const idx = Math.min(freqLen - 1, Math.floor(freqMap(i) * 2));
    const v2 = (modeCtx.freq?.[idx] ?? 0) / 255;
    if (v2 > 0.5) {
      const h2 = v2 * h * 0.18;
      modeCtx.ctx.fillRect(i * barW + barW * 0.35, h - h2 - 2 * dpr, barW * 0.3, h2);
    }
  }
  modeCtx.ctx.globalAlpha = 1;
}

export function renderMirroredBars(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const barCount = 64;
  const barW = w / barCount;

  if (state.barPeaks?.length !== barCount) {
    state.barPeaks = new Array(barCount).fill(0);
  }
  // T-VIZ-53 second-stage damp, same as renderBars — mirrored heights were
  // tracked 1:1 with the enveloped spectrum, which read as stepped on
  // dense mixes. displayBars is shared with bars (same 64 length); the -1
  // sentinel makes frame 0 snap instead of ramping from zero.
  if (state.displayBars?.length !== barCount) {
    state.displayBars = new Array(barCount).fill(-1);
  }
  state.lastMs ??= modeCtx.nowMs();
  const frameNow = modeCtx.nowMs();
  const frameDt = Math.min(0.1, Math.max(0, frameNow - state.lastMs) / 1000);
  state.lastMs = frameNow;
  const dispLambda = dampLambda(0.35);

  const barGradients = modeCtx.getGradients("mirrored-bars", modeCtx.colors);
  const centerY = Math.round(h * 0.5);
  const maxBarH = h * 0.38;
  const freqLen = modeCtx.freq?.length ?? 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context.sampleRate,
  );

  for (let i = 0; i < barCount; i++) {
    const rawV = sampleMappedBand(modeCtx.freq, freqMap, i) / 255;
    const boosted = boostedValue(rawV, modeCtx);
    const dispTarget = clamp(boosted * modeCtx.energyMod, 0, 1.2);
    const disp = dampDisplay(state.displayBars[i], dispTarget, dispLambda, frameDt);
    state.displayBars[i] = disp;
    const bh = Math.max(0, disp * maxBarH);
    // Falling peak: hold the high-water mark, decay slowly toward the bar.
    if (bh > state.barPeaks[i]) state.barPeaks[i] = bh;
    else state.barPeaks[i] = Math.max(bh, state.barPeaks[i] * PEAK_DECAY);
    const x = Math.round(i * barW);
    const bw = Math.round(barW) - 2;
    const radius = Math.min(bw / 2, 3 * dpr);
    const cIdx = Math.floor((i / barCount) * modeCtx.colors.length);
    const warmMix = i / barCount < 0.3 ? modeCtx.d.bass * 0.35 : 0;
    const coolMix = i / barCount > 0.7 ? modeCtx.d.treble * 0.35 : 0;

    // Upper bar — shared body keeps gradient + warm/cool overlays in one place.
    const upY = Math.round(centerY - bh);
    modeCtx.ctx.fillStyle = "rgba(0,0,0,0.25)";
    modeCtx.ctx.fillRect(x + 1 + 2 * dpr, upY + 2 * dpr, bw, bh);
    drawBarBody(
      modeCtx.ctx,
      dpr,
      x,
      upY,
      bw,
      bh,
      radius,
      barGradients[cIdx % barGradients.length],
      warmMix,
      coolMix,
    );
    // Lower mirrored bar
    const lowY = centerY;
    const lowH = bh * 0.6;
    modeCtx.ctx.save();
    modeCtx.ctx.globalAlpha = 0.35;
    modeCtx.ctx.fillStyle = barGradients[cIdx % barGradients.length];
    modeCtx.ctx.beginPath();
    modeCtx.ctx.roundRect(x + 1, lowY, bw, lowH + 2 * dpr, [0, 0, radius, radius]);
    modeCtx.ctx.fill();
    modeCtx.ctx.restore();
    // Peak indicator (upper)
    const peakY = Math.round(centerY - state.barPeaks[i]);
    modeCtx.ctx.fillStyle = "rgba(255,255,255,0.85)";
    modeCtx.ctx.fillRect(x + 1, peakY - 1 * dpr, bw, 1.5 * dpr);
    // Lower mirrored peak indicator
    const lowPeakH = state.barPeaks[i] * 0.6;
    const lowPeakY = Math.round(centerY + lowPeakH);
    modeCtx.ctx.fillStyle = "rgba(255,255,255,0.55)";
    modeCtx.ctx.fillRect(x + 1, lowPeakY, bw, 1.5 * dpr);
    if (modeCtx.d.beat && rawV > 0.55) {
      drawBeatFlash(modeCtx.ctx, dpr, modeCtx.colors[cIdx % modeCtx.colors.length], x, upY, bw);
    }
  }
}

export function renderSegmentedLedBars(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const barCount = 64;
  const barW = w / barCount;
  const segmentsPerBar = 10;
  const segH = 4 * dpr;
  const gap = 2 * dpr;
  const baseY = Math.round(h * 0.92);
  const barGradients = modeCtx.getGradients("segmented-led-bars", modeCtx.colors);

  // 2026: the old `state.barVelocities[i] = targetSegs` store was dead —
  // written every frame, never read (and re-allocated every frame because
  // the mode is not in the component's barVelocities sizing list). Replaced
  // by the shared displayBars damp: segment count now eases instead of
  // stepping, which was the scored "lack of visible motion".
  if (state.displayBars?.length !== barCount) {
    state.displayBars = new Array(barCount).fill(-1);
  }
  state.lastMs ??= modeCtx.nowMs();
  const frameNow = modeCtx.nowMs();
  const frameDt = Math.min(0.1, Math.max(0, frameNow - state.lastMs) / 1000);
  state.lastMs = frameNow;
  const dispLambda = dampLambda(0.35);
  // Phase-locked beat envelope — falls back to the flux onset envelope
  // (beatEnv) when no beat grid is analysed.
  const beatPulse = beatPhaseEnvelope(modeCtx.d.beatPhase) ?? modeCtx.beatEnv ?? 0;

  const freqLen = modeCtx.freq?.length ?? 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context.sampleRate,
  );

  for (let i = 0; i < barCount; i++) {
    const v = sampleMappedBand(modeCtx.freq, freqMap, i) / 255;
    const boosted = boostedValue(v, modeCtx);
    const dispTarget = clamp(boosted * modeCtx.energyMod, 0, 1.2);
    const disp = dampDisplay(state.displayBars[i], dispTarget, dispLambda, frameDt);
    state.displayBars[i] = disp;
    // Fractional lit height: full segments plus a partial top segment, so
    // the column grows continuously instead of jumping a whole LED at once.
    const segFloat = disp * segmentsPerBar;
    const fullSegs = Math.min(segmentsPerBar, Math.floor(segFloat));
    const topFrac = Math.min(1, segFloat - fullSegs);
    const litTop = Math.min(segmentsPerBar, fullSegs + (topFrac > 0.04 ? 1 : 0));
    const x = Math.round(i * barW);
    const bw = Math.round(barW) - 2;
    const cIdx = Math.floor((i / barCount) * modeCtx.colors.length);
    const segColor = barGradients[cIdx % barGradients.length];
    const segColorName = modeCtx.colors[cIdx % modeCtx.colors.length];
    if (litTop === 0) continue; // dark column — nothing to save/restore for
    modeCtx.ctx.save();
    for (let s = 0; s < litTop; s++) {
      // Per-segment gradation: the lit stack brightens toward the top LED
      // (classic VU/LED-meter falloff) instead of one flat color.
      const coverage = s < fullSegs ? 1 : topFrac;
      const heightFrac = litTop > 1 ? (s + 1) / litTop : 1;
      const isPeakSeg = s === litTop - 1;
      // Beat response: the peak segment flares on the beat grid, not just
      // on the boolean `beat` frame.
      const beatBoost = isPeakSeg ? beatPulse * 0.45 + (modeCtx.d.beat ? 0.25 : 0) : 0;
      modeCtx.ctx.globalAlpha = clamp((0.3 + 0.7 * heightFrac) * coverage + beatBoost, 0, 1);
      const y = baseY - (s + 1) * (segH + gap);
      modeCtx.ctx.fillStyle = segColor;
      modeCtx.ctx.beginPath();
      modeCtx.ctx.roundRect(x + 1, y, bw, segH, [1 * dpr, 1 * dpr, 1 * dpr, 1 * dpr]);
      modeCtx.ctx.fill();
      if (isPeakSeg && (modeCtx.d.beat || beatPulse > 0.3)) {
        drawGlowSprite(
          modeCtx.ctx,
          segColorName,
          x + 1 + bw / 2,
          y + segH / 2,
          bw + 14 * dpr,
          segH + 14 * dpr,
          clamp(0.3 + beatPulse * 0.4, 0, 0.8),
        );
      }
    }
    modeCtx.ctx.restore();
  }
}

export function renderStereoSplitBars(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const barCount = 48;
  const barW = w / barCount;
  const bands = [
    { label: "low", start: 0, end: Math.floor(barCount * 0.25), color: modeCtx.colors[0] },
    {
      label: "mid",
      start: Math.floor(barCount * 0.25),
      end: Math.floor(barCount * 0.65),
      color: modeCtx.colors[1],
    },
    {
      label: "high",
      start: Math.floor(barCount * 0.65),
      end: barCount,
      color: modeCtx.colors[2] || modeCtx.colors[1],
    },
  ];
  const baseY = Math.round(h * 0.88);

  if (state.barPeaks?.length !== barCount) {
    state.barPeaks = new Array(barCount).fill(0);
  }

  const freqLen = modeCtx.freq?.length ?? 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context.sampleRate,
  );

  for (const band of bands) {
    modeCtx.ctx.fillStyle = withAlpha(band.color, "18");
    modeCtx.ctx.fillRect(0, baseY - 2 * dpr, w, 2 * dpr);
    for (let i = band.start; i < band.end; i++) {
      const v = sampleMappedBand(modeCtx.freq, freqMap, i) / 255;
      const boosted = boostedValue(v, modeCtx);
      const targetH = boosted * h * 0.65 * modeCtx.energyMod;
      // T-VIZ-15: freq arrives pre-enveloped — no per-mode spring.
      const bh = Math.max(0, targetH);
      if (bh > state.barPeaks[i]) state.barPeaks[i] = bh;
      else state.barPeaks[i] = Math.max(bh, state.barPeaks[i] * PEAK_DECAY);
      const x = Math.round(i * barW);
      const y = Math.round(baseY - bh);
      const bw = Math.round(barW) - 2;
      const radius = Math.min(bw / 2, 3 * dpr);
      modeCtx.ctx.fillStyle = band.color;
      modeCtx.ctx.beginPath();
      modeCtx.ctx.roundRect(x + 1, y, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
      modeCtx.ctx.fill();
      modeCtx.ctx.fillStyle = "rgba(255,255,255,0.12)";
      modeCtx.ctx.fillRect(x + 1, y, bw, Math.max(1, bh * 0.25));
      const peakY = Math.round(baseY - state.barPeaks[i]);
      modeCtx.ctx.fillStyle = "rgba(255,255,255,0.7)";
      modeCtx.ctx.fillRect(x + 1, peakY - 1 * dpr, bw, 1.5 * dpr);
      if (modeCtx.d.beat && v > 0.4) {
        drawGlowSprite(
          modeCtx.ctx,
          band.color,
          x + 1 + bw / 2,
          y + bh / 2,
          bw + 12 * dpr,
          Math.min(bh + 12 * dpr, h * 0.5),
          0.5,
        );
      }
    }
  }
}

export function renderStackedFrequencyBands(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const barCount = 48;
  const freqLen = Math.max(1, modeCtx.freq?.length ?? 1024);
  const step = Math.max(1, Math.floor(freqLen / barCount));
  // Layer start/end are expressed in "step units" (~freqLen total). The old
  // code fed `layer.start + i` — a bin-space offset plus a bar index — into
  // freqMap as if it were a bar index (domain 0..barCount-1). Values of
  // ~150-1000 produced mapper outputs far past the top bin, so every layer
  // sampled the same clamped bin and the three bands drew identically.
  // Instead, sweep each layer's spectrum fraction with the column position
  // and let the perceptual mapper place it — p*barCount stays in domain.
  const spectrumSpan = Math.max(1, step * barCount);
  const barW = w / barCount;
  const baseY = Math.round(h * 0.88);
  const layers = [
    { name: "low", start: 0, end: Math.floor(step * barCount * 0.25), color: modeCtx.colors[0] },
    {
      name: "mid",
      start: Math.floor(step * barCount * 0.25),
      end: Math.floor(step * barCount * 0.65),
      color: modeCtx.colors[1],
    },
    {
      name: "high",
      start: Math.floor(step * barCount * 0.65),
      end: Math.floor(step * barCount * 1),
      color: modeCtx.colors[2] || modeCtx.colors[1],
    },
  ];

  if (state.barPeaks?.length !== barCount) {
    state.barPeaks = new Array(barCount).fill(0);
  }
  if (state.displayBands?.length !== barCount * layers.length) {
    state.displayBands = new Array(barCount * layers.length).fill(0);
  }

  // T-VIZ-53: same second-stage damp as renderBars — the scorecard flagged
  // this mode's columns as stepped/jittery despite the shared envelope.
  state.lastMs ??= modeCtx.nowMs();
  const frameNow = modeCtx.nowMs();
  const frameDt = Math.min(0.1, Math.max(0, frameNow - state.lastMs) / 1000);
  state.lastMs = frameNow;
  const dispLambda = dampLambda(0.35);

  // T-VIZ-53 ambient glow layer — same treatment as renderBars, plus the
  // baseline rule the bars mode already had.
  modeCtx.ctx.fillStyle = `rgba(255,255,255,${0.05 + modeCtx.d.bass * 0.05})`;
  modeCtx.ctx.fillRect(0, baseY, w, Math.max(1, dpr));
  const glowI = clamp(
    modeCtx.d.bass * 0.9 + (modeCtx.d.energy ?? modeCtx.d.analyzedEnergy ?? 0) * 0.35,
    0,
    1,
  );
  if (glowI > 0.02) {
    drawGlowSprite(
      modeCtx.ctx,
      modeCtx.colors[1] || modeCtx.colors[0],
      w / 2,
      h * 0.72,
      w * 1.15,
      h * 0.95,
      glowI * 0.32,
    );
  }

  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context.sampleRate,
  );

  for (let i = 0; i < barCount; i++) {
    const x = Math.round(i * barW);
    const bw = Math.round(barW) - 2;
    const radius = Math.min(bw / 2, 3 * dpr);
    let layerY = baseY;
    let topY = baseY;
    let stackH = 0;
    const layerVs: number[] = [];
    for (const layer of layers) {
      const fracStart = layer.start / spectrumSpan;
      const fracEnd = layer.end / spectrumSpan;
      const p = fracStart + ((i + 0.5) / barCount) * (fracEnd - fracStart);
      const binIdx = clamp(Math.floor(freqMap(p * barCount)), 0, freqLen - 1);
      const v = (modeCtx.freq?.[binIdx] ?? 0) / 255;
      layerVs.push(v);
      const dIdx = i * layers.length + layerVs.length - 1;
      const dispV = damp(state.displayBands[dIdx], clamp(v, 0, 1), dispLambda, frameDt);
      state.displayBands[dIdx] = dispV;
      const boosted = boostedValue(dispV, modeCtx);
      // T-VIZ-15: freq arrives pre-enveloped — no per-mode spring.
      const lh = boosted * h * 0.22 * modeCtx.energyMod;
      const ly = Math.round(layerY - lh);
      modeCtx.ctx.fillStyle = layer.color;
      modeCtx.ctx.beginPath();
      modeCtx.ctx.roundRect(x + 1, ly, bw, lh + 2 * dpr, [radius, radius, 0, 0]);
      modeCtx.ctx.fill();
      // T-VIZ-53: inner depth — dark seat at the layer's base, light crown
      // on top. Flat single-fill stacks read as "demo" on the scorecard.
      if (lh > 4 * dpr) {
        modeCtx.ctx.fillStyle = "rgba(0,0,0,0.22)";
        modeCtx.ctx.fillRect(x + 1, ly + lh - 3 * dpr, bw, 3 * dpr);
      }
      modeCtx.ctx.fillStyle = "rgba(255,255,255,0.1)";
      modeCtx.ctx.fillRect(x + 1, ly, bw, Math.max(1, lh * 0.25));
      topY = ly;
      layerY = ly;
      stackH += lh;
    }
    // Peak-indicator envelope — the freq component is already smoothed by
    // the shared stage, so stackH is used directly.
    const smoothStackH = stackH;
    if (smoothStackH > state.barPeaks[i]) state.barPeaks[i] = smoothStackH;
    else state.barPeaks[i] = Math.max(smoothStackH, state.barPeaks[i] * PEAK_DECAY);
    const peakY = Math.round(baseY - state.barPeaks[i]);
    // T-VIZ-53: tick takes the top layer's color instead of white — 48
    // white dashes read as unexplained clutter on the scorecard.
    modeCtx.ctx.save();
    modeCtx.ctx.globalAlpha = 0.6;
    modeCtx.ctx.fillStyle = layers[layers.length - 1].color;
    modeCtx.ctx.fillRect(x + 1, peakY - 0.5 * dpr, bw, 1 * dpr);
    modeCtx.ctx.restore();
    // Beat glow on top layer — reuse the value already sampled for it.
    if (modeCtx.d.beat) {
      const topLayer = layers[layers.length - 1];
      const v = layerVs[layerVs.length - 1] ?? 0;
      if (v > 0.35) {
        drawGlowSprite(
          modeCtx.ctx,
          topLayer.color,
          x + 1 + bw / 2,
          (topY + baseY) / 2,
          bw + 12 * dpr,
          baseY - topY + 12 * dpr,
          0.5,
        );
        modeCtx.ctx.fillStyle = "rgba(255,255,255,0.15)";
        modeCtx.ctx.fillRect(x + 1, topY, bw, baseY - topY);
      }
    }
  }
}

export function renderDotPeakMatrix(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  void dpr; // dot/grid metrics are canvas-relative; glow sprite needs no dpr
  const barCount = 64;
  const cols = barCount;
  const rows = 12;
  const cellW = w / cols;
  const cellH = h / rows;
  const dotR = Math.min(cellW, cellH) * 0.35;
  const barGradients = modeCtx.getGradients("dot-peak-matrix", modeCtx.colors);

  const freqLen = modeCtx.freq?.length ?? 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context.sampleRate,
  );

  // 2026: damped display rows (was a dead barVelocities store + binary
  // on/off quantization). Coverage alpha gives each dot a fractional
  // brightness, so columns grow smoothly instead of stepping a whole row.
  if (state.displayBars?.length !== cols) {
    state.displayBars = new Array(cols).fill(-1);
  }
  state.lastMs ??= modeCtx.nowMs();
  const frameNow = modeCtx.nowMs();
  const frameDt = Math.min(0.1, Math.max(0, frameNow - state.lastMs) / 1000);
  state.lastMs = frameNow;
  const dispLambda = dampLambda(0.35);
  const beatPulse = beatPhaseEnvelope(modeCtx.d.beatPhase) ?? modeCtx.beatEnv ?? 0;

  // Inactive dots all share one style — batch them into a single path so
  // the ~700 dark dots don't each pay a fillStyle+fill per frame.
  const dimPath = new Path2D();

  for (let i = 0; i < cols; i++) {
    const v = sampleMappedBand(modeCtx.freq, freqMap, i) / 255;
    const boosted = boostedValue(v, modeCtx);
    const targetRows = boosted * rows * modeCtx.energyMod;
    const disp = dampDisplay(
      state.displayBars[i],
      clamp(targetRows, 0, rows),
      dispLambda,
      frameDt,
    );
    state.displayBars[i] = disp;
    const litTop = Math.min(rows, Math.max(0, Math.ceil(disp - 0.001)));
    const cIdx = Math.floor((i / cols) * modeCtx.colors.length);
    const litColor = barGradients[cIdx % barGradients.length];
    for (let r = 0; r < rows; r++) {
      const cx = Math.round(i * cellW + cellW / 2);
      const cy = Math.round(h - (r + 0.5) * cellH);
      const coverage = clamp(disp - r, 0, 1);
      if (coverage <= 0.02) {
        dimPath.arc(cx, cy, dotR * 0.6, 0, Math.PI * 2);
        continue;
      }
      // Gradation: the fractional top dot dims toward its coverage and lit
      // dots sit a touch brighter near the peak row.
      const peakBoost = r === litTop - 1 ? 0.15 : 0;
      modeCtx.ctx.globalAlpha = clamp(0.3 + 0.7 * coverage + peakBoost, 0, 1);
      modeCtx.ctx.fillStyle = litColor;
      modeCtx.ctx.beginPath();
      modeCtx.ctx.arc(cx, cy, dotR * (0.75 + 0.25 * coverage), 0, Math.PI * 2);
      modeCtx.ctx.fill();
      // Beat emphasis on the peak dot — continuous via beatPhaseEnvelope,
      // not only the single boolean beat frame.
      if (r === litTop - 1 && (modeCtx.d.beat || beatPulse > 0.25)) {
        drawGlowSprite(
          modeCtx.ctx,
          modeCtx.colors[cIdx % modeCtx.colors.length],
          cx,
          cy,
          dotR * 5,
          dotR * 5,
          clamp(0.3 + beatPulse * 0.45, 0, 0.85),
        );
      }
    }
  }
  modeCtx.ctx.globalAlpha = 1;
  modeCtx.ctx.fillStyle = "rgba(255,255,255,0.08)";
  modeCtx.ctx.fill(dimPath);
}

/**
 * Waveform mode — smooth 3-point Gaussian-ish moving average waveform with
 * spring-smoothed amplitude envelope, gradient fill, secondary harmonic line,
 * and peak particles.
 */
export function renderWaveform(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const { ctx, colors, wave, syncLineProgress, phraseFlash, energyMod, nowMs } = modeCtx;
  if (!wave) return;

  // Depth grid behind waveform
  ctx.strokeStyle = withAlpha(colors[0], "18");
  ctx.lineWidth = dpr;
  const gridStep = Math.max(1, Math.floor(w / 12));
  for (let gx = 0; gx < w; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, h * 0.2);
    ctx.lineTo(gx + 8 * dpr * Math.sin(nowMs() * 0.0003 + gx * 0.01), h * 0.8);
    ctx.stroke();
  }
  for (let gy = h * 0.25; gy < h * 0.75; gy += h * 0.15) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  // 2026 smooth: 3-point Gaussian-ish moving average + HSB hue drift
  if (state.smoothed?.length !== wave.length) {
    state.smoothed = new Uint8Array(wave.length);
  }
  for (let i = 0; i < wave.length; i++) {
    const prev = wave[Math.max(0, i - 1)];
    const next = wave[Math.min(wave.length - 1, i + 1)];
    state.smoothed[i] = prev * 0.25 + wave[i] * 0.5 + next * 0.25;
  }

  state.lastMs ??= modeCtx.nowMs();
  const now = modeCtx.nowMs();
  const dt = Math.max(0, now - state.lastMs) / 1000;
  state.lastMs = now;

  if (state.waveEnvelope?.length !== state.smoothed.length) {
    state.waveEnvelope = new Array(state.smoothed.length).fill(0);
  }

  ctx.strokeStyle = colors[1];
  ctx.lineWidth = 2.2 * dpr;
  const glowPx =
    9 * dpr + phraseFlash * 14 + (modeCtx.d.peak ?? 0) * 10 * dpr + energyMod * 8 * dpr;
  ctx.beginPath();
  const slice = w / state.smoothed.length;

  // Frame-rate-independent exponential smoothing of the amplitude envelope.
  // lambda = -60 * ln(1 - k) where k = springK * damping at 60 Hz.
  const lambda = dampLambda(0.22 * 0.75);
  const d = modeCtx.d;
  for (let i = 0; i < state.smoothed.length; i++) {
    const x = i * slice;
    const v = (state.smoothed[i] - 128) / 128;
    const beatPhaseAnt =
      d.beatPhase !== undefined && d.beatPhase !== null && d.beatPhase < 0.5
        ? (1 - d.beatPhase * 2) * 0.15
        : 0;
    const targetAmp =
      v * h * 0.35 * (1 + energyMod * 0.85 + phraseFlash * 0.45 + d.bass * 0.25 + beatPhaseAnt);
    const prev = state.waveEnvelope[i];
    // 2026: signed damp — the old Math.max(0, ...) half-wave rectified the
    // trace, so only the positive half of the waveform ever rendered.
    state.waveEnvelope[i] = damp(prev, targetAmp, lambda, dt);
    const y = h / 2 + state.waveEnvelope[i];
    const xOff = syncLineProgress * 14 * dpr * Math.sin(i * 0.01 + nowMs() * 0.001);
    if (i === 0) ctx.moveTo(x + xOff, y);
    else ctx.lineTo(x + xOff, y);
  }
  // T-VIZ-17: two-pass glow — wide low-alpha additive stroke under the
  // crisp core, replacing the per-frame shadow blur rasterization.
  const prevCO = ctx.globalCompositeOperation;
  const prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = colors[0];
  ctx.lineWidth = 2.2 * dpr + glowPx * 1.6;
  ctx.stroke();
  ctx.globalCompositeOperation = prevCO;
  ctx.globalAlpha = prevA;
  ctx.strokeStyle = colors[1];
  ctx.lineWidth = 2.2 * dpr;
  ctx.stroke();

  // Subtle gradient fill under the primary waveform for depth. The gradient
  // is now symmetric about the midline so the (previously clamped-away)
  // negative half of the signed trace gets the same soft fill.
  ctx.globalAlpha = 0.12 + energyMod * 0.08;
  const waveGrad = ctx.createLinearGradient(0, h * 0.1, 0, h * 0.9);
  waveGrad.addColorStop(0, withAlpha(colors[1], "00"));
  waveGrad.addColorStop(0.5, withAlpha(colors[1], "44"));
  waveGrad.addColorStop(1, withAlpha(colors[1], "00"));
  ctx.fillStyle = waveGrad;
  ctx.beginPath();
  for (let i = 0; i < state.smoothed.length; i++) {
    const x = i * slice;
    const y = h / 2 + state.waveEnvelope[i];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h / 2);
  ctx.lineTo(0, h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Secondary harmonic faint line — sampled through the same smoothed
  // buffer and damped with the same lambda (was raw `wave[]` unsmoothed,
  // which made the overlay shimmer independently of the primary trace).
  // waveVelocities stores the damped harmonic amplitude per sample slot.
  if (state.waveVelocities?.length !== wave.length) {
    state.waveVelocities = new Array(wave.length).fill(0);
  }
  ctx.strokeStyle = withAlpha(colors[2], "88");
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  for (let i = 0; i < wave.length; i += 2) {
    const x = i * slice;
    const idx2 = (i * 3) % wave.length;
    const hv = (state.smoothed[idx2] - 128) / 128;
    const hTarget = hv * h * 0.18 * (1 + d.treble * 0.6) * 0.5;
    const hPrev = state.waveVelocities[i];
    const hAmp = damp(hPrev, hTarget, lambda, dt);
    state.waveVelocities[i] = hAmp;
    const y2 = h / 2 + hAmp;
    if (i === 0) ctx.moveTo(x, y2);
    else ctx.lineTo(x, y2);
  }
  ctx.stroke();

  // Peak particles — glowing dots along peaks (sprite glow, T-VIZ-17)
  for (let i = 0; i < wave.length; i += 24) {
    const v = (wave[i] - 128) / 128;
    if (Math.abs(v) > 0.55) {
      const x = i * slice;
      const y = h / 2 + v * h * 0.35 * (1 + (modeCtx.d.energy ?? 0) * 0.5);
      const pr = 2.5 * dpr + (modeCtx.d.peak ?? 0) * 2 * dpr;
      drawGlowSprite(ctx, colors[0], x, y, pr * 6, pr * 6, 0.5);
      ctx.fillStyle = d.beat ? "#ffffff" : colors[1];
      ctx.beginPath();
      ctx.arc(x, y, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Radial mode — audio-reactive radial bars rotating around center, with
 * glowing core and orbital ring.
 */
export function renderRadial(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const { ctx, colors, freq, sectionProgress, phraseFlash, energyMod } = modeCtx;
  const cx = w / 2;
  const cy = h / 2;
  const baseR = Math.min(w, h) * 0.18;
  const sectionRot = sectionProgress * Math.PI * 0.5;

  const freqLen = freq?.length ?? 1024;
  if (!freq) return;
  // 2026: perceptual spoke sampling — the old `freq[floor(i/64*freqLen*0.6)]`
  // ignored perceptualScale AND discarded the top 40% of the spectrum
  // (treble spokes never moved). Same mapper the bar modes use now.
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    64,
    freqLen,
    modeCtx.analyser?.context.sampleRate,
  );
  // Second-stage display damp (T-VIZ-53 pattern from renderBars) — spoke
  // lengths ease instead of tracking the enveloped spectrum 1:1.
  if (state.displayBars?.length !== 64) {
    state.displayBars = new Array(64).fill(-1);
  }
  state.lastMs ??= modeCtx.nowMs();
  const frameNow = modeCtx.nowMs();
  const frameDt = Math.min(0.1, Math.max(0, frameNow - state.lastMs) / 1000);
  state.lastMs = frameNow;
  const dispLambda = dampLambda(0.35);
  const d = modeCtx.d;
  // Phase-locked beat pulse (falls back to the flux onset envelope) — the
  // old code pulsed only on phraseFlash, so radial ignored the beat grid.
  const beatPulse = beatPhaseEnvelope(d.beatPhase) ?? modeCtx.beatEnv ?? 0;

  for (let i = 0; i < 64; i++) {
    const v = sampleMappedBand(freq, freqMap, i) / 255;
    const boosted = boostedValue(v, modeCtx);
    const dispTarget = clamp(boosted * modeCtx.energyMod, 0, 1.2);
    const disp = dampDisplay(state.displayBars[i], dispTarget, dispLambda, frameDt);
    state.displayBars[i] = disp;
    const angle = (i / 64) * Math.PI * 2 + sectionRot;
    const r0 = baseR;
    const targetR1 =
      baseR +
      disp * baseR * 1.2 * (1 + phraseFlash * 0.4 + energyMod * 0.3 + beatPulse * 0.45);
    const r1 = Math.max(r0, targetR1);
    const x0 = cx + Math.cos(angle) * r0;
    const y0 = cy + Math.sin(angle) * r0;
    const x1 = cx + Math.cos(angle) * r1;
    const y1 = cy + Math.sin(angle) * r1;
    ctx.strokeStyle = colors[i % colors.length];
    ctx.lineWidth = 2 * dpr + v * 4 * dpr + beatPulse * 2 * dpr;
    ctx.globalAlpha = 0.7 + v * 0.3 + beatPulse * 0.2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Enhanced center anchor with glow and pulsing core
  const coreR = baseR * 0.35 * (1 + phraseFlash * 0.5 + d.bass * 0.3 + beatPulse * 0.4);
  const glowR = coreR * 3;
  const grd = ctx.createRadialGradient(cx, cy, coreR * 0.2, cx, cy, glowR);
  grd.addColorStop(0, withAlpha(colors[0], "cc"));
  grd.addColorStop(0.4, withAlpha(colors[1], "66"));
  grd.addColorStop(1, "transparent");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
  ctx.fill();

  // Secondary orbital ring
  ctx.strokeStyle = withAlpha(colors[2], "55");
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 1.8 + (d.energy ?? 0) * 8 * dpr, 0, Math.PI * 2);
  ctx.stroke();

  // Solid core
  ctx.fillStyle = colors[0];
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Spectrogram mode — scrolling log-frequency spectrogram with beat flash
 * and axis labels.
 */
export function renderSpectrogram(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  void state;
  const { ctx, canvas, bg, colors, freq, phraseFlash } = modeCtx;
  const specW = w;
  const specH = h;
  const sliceW = Math.max(2, Math.round(2 * dpr));

  // Blit existing canvas to the left by sliceW
  if (canvas) {
    ctx.drawImage(canvas, sliceW, 0, specW - sliceW, specH, 0, 0, specW - sliceW, specH);
  }
  // Clear rightmost strip
  ctx.fillStyle = bg;
  ctx.fillRect(specW - sliceW, 0, sliceW, specH);

  // Draw new slice on the right — perceptual (log) frequency mapping
  const freqLen = freq?.length ?? 1024;
  // Palette RGB decoded once per frame — was hexToRgb per pixel per row.
  const paletteRgb = colors.map((c) => hexToRgb(c));
  for (let py = 0; py < specH; py++) {
    const t = py / specH; // 1 at top (high freq), 0 at bottom (low freq)
    const minLog = Math.log(1);
    const maxLog = Math.log(freqLen);
    const logT = minLog + t * (maxLog - minLog);
    const linearT = (Math.exp(logT) - 1) / (freqLen - 1);
    const binIdx = Math.min(freqLen - 1, Math.max(0, Math.floor(linearT * freqLen)));
    const v = (freq?.[binIdx] ?? 0) / 255;
    if (v < 0.02) continue;
    const colorIdx = clamp(v * (colors.length - 1), 0, colors.length - 1);
    const ci = Math.floor(colorIdx);
    const cf = colorIdx - ci;
    const c1 = paletteRgb[ci % paletteRgb.length];
    const c2 = paletteRgb[(ci + 1) % paletteRgb.length];
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * cf);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * cf);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * cf);
    const alpha = clamp(0.3 + v * 0.7, 0, 1);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.fillRect(specW - sliceW, py, sliceW, 1);
  }

  // Beat-reactive flash overlay on the new slice
  const d = modeCtx.d;
  if (d.beat && (d.bass || 0) > 0.4) {
    ctx.fillStyle = `rgba(255,255,255,${clamp((d.bass || 0) * 0.2, 0, 0.3)})`;
    ctx.fillRect(specW - sliceW, 0, sliceW, specH);
  }

  // Axis labels (frequency Hz on Y, time on X)
  ctx.fillStyle = withAlpha(colors[0], "90");
  ctx.font = `${10 * dpr}px monospace`;
  ctx.textAlign = "right";
  // 2026: Nyquist comes from the live AudioContext — the old hardcoded
  // 22050/2 capped the axis at 11 kHz and ignored the real sample rate
  // (48 kHz devices were mislabeled by ~8%).
  const nyquist = (modeCtx.analyser?.context.sampleRate ?? 44100) / 2;
  const maxFreq = Math.floor(nyquist);
  const labelCount = 5;
  for (let i = 0; i <= labelCount; i++) {
    const freqHz = Math.round((maxFreq / labelCount) * i);
    const logHz = Math.log(1 + freqHz / 20);
    const logMax = Math.log(1 + maxFreq / 20);
    const y = specH - (logHz / logMax) * specH;
    ctx.fillText(`${freqHz}Hz`, 28 * dpr, y + 3 * dpr);
    ctx.fillRect(30 * dpr, y, specW - 32 * dpr, 0.5);
  }
  ctx.textAlign = "center";
  ctx.fillText("Time →", specW / 2, specH - 4 * dpr);
  if (phraseFlash > 0.05) {
    ctx.fillStyle = `rgba(255,255,255,${phraseFlash * 0.1})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/**
 * Lissajous mode — parametric curve driven by bass/mid energy with
 * current-point glow.
 */
export function renderLissajous(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  void state;
  const { ctx, colors, freq, phraseFlash, energyMod, nowMs } = modeCtx;
  const freqLen = freq?.length ?? 1024;
  const cx = w / 2;
  const cy = h / 2;
  // 2026: band edges derived from Hz (250 Hz / 4 kHz — the same splits the
  // shared envelope stage uses) instead of fixed 10%/40% bin fractions,
  // and the two per-frame freq.slice() allocations are gone. On a 44.1 kHz
  // /1024-bin analyser this narrows "bass" to true bass rather than the
  // old ~2.2 kHz lump.
  const sampleRate = modeCtx.analyser?.context.sampleRate ?? 44100;
  const nyquist = sampleRate / 2;
  const bassEnd = clamp(Math.floor((250 / nyquist) * freqLen), 1, freqLen - 1);
  const midEnd = clamp(Math.floor((4000 / nyquist) * freqLen), bassEnd + 1, freqLen);
  const bandAvg = (from: number, to: number): number => {
    if (!freq) return 0;
    let sum = 0;
    for (let i = from; i < to; i++) sum += freq[i];
    return sum / ((to - from) * 255 || 1);
  };
  const bassV = bandAvg(0, bassEnd);
  const midV = bandAvg(bassEnd, midEnd);
  const ampX = w * 0.35 * (1 + bassV * 0.6 + energyMod * 0.3);
  const ampY = h * 0.35 * (1 + midV * 0.6 + energyMod * 0.3);
  const t = nowMs() * 0.001;
  const d = modeCtx.d;

  ctx.strokeStyle = colors[1];
  ctx.lineWidth = 2 * dpr;
  const lissGlowPx = 6 * dpr + phraseFlash * 10;
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
  // T-VIZ-17: two-pass glow stroke replacing shadow blur.
  const prevCO = ctx.globalCompositeOperation;
  const prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = colors[0];
  ctx.lineWidth = 2 * dpr + lissGlowPx * 1.6;
  ctx.stroke();
  ctx.globalCompositeOperation = prevCO;
  ctx.globalAlpha = prevA;
  ctx.strokeStyle = colors[1];
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();

  // Draw current-point glow
  const curAngle = t * (1 + d.bass);
  const curX = cx + Math.sin(curAngle * (1 + bassV * 3)) * ampX;
  const curY = cy + Math.cos(curAngle * (1 + midV * 2)) * ampY;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(curX, curY, 4 * dpr + phraseFlash * 6 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Constellation mode — frequency points connected by spatial-grid-optimized
 * lines, with spring-smoothed node radii.
 */
export function renderConstellation(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  void state;
  const { ctx, colors, freq, analyzedPunch } = modeCtx;
  const points: { x: number; y: number; v: number }[] = [];
  const freqLen = freq?.length ?? 1024;
  if (!freq) return;
  // 2026: scan through the perceptual mapper instead of a raw `i += 8`
  // linear bin walk — nodes now spread across the audible spectrum the
  // same way the bar modes do, and treble peaks are no longer starved.
  const SCAN_BARS = 256;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    SCAN_BARS,
    freqLen,
    modeCtx.analyser?.context.sampleRate,
  );
  for (let k = 0; k < SCAN_BARS; k++) {
    const bin = Math.floor(freqMap(k));
    if (bin < 0 || bin >= freqLen) continue;
    const v = freq[bin] / 255;
    if (v > 0.18) {
      const x = (k / SCAN_BARS) * w;
      const y = h - v * h * 0.85;
      points.push({ x, y, v });
      if (points.length >= 64) break;
    }
  }

  // Draw connections — ≤64 points, so a plain O(n²) pass with an early
  // distance reject is cheaper than the old per-frame spatial Map (string
  // keys + array buckets allocated every frame for ~2k comparisons).
  ctx.strokeStyle = withAlpha(colors[0], "30");
  ctx.lineWidth = dpr;
  const maxPoints = points.length;
  const gridStep = 60 * dpr;
  for (let i = 0; i < maxPoints; i++) {
    const p = points[i];
    for (let j = i + 1; j < maxPoints; j++) {
      const other = points[j];
      const dx = p.x - other.x;
      const dy = p.y - other.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= gridStep * gridStep) continue;
      const dist = Math.sqrt(distSq);
      ctx.globalAlpha = (1 - dist / gridStep) * 0.4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(other.x, other.y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Draw nodes — radius follows the (already-enveloped) band value plus
  // beat/punch boosts; no per-mode spring (T-VIZ-15).
  const d = modeCtx.d;
  for (let i = 0; i < maxPoints; i++) {
    const p = points[i];
    const r =
      2 * dpr + p.v * 5 * dpr + (d.beat && p.v > 0.7 ? 3 * dpr : 0) + analyzedPunch * 3 * dpr;
    ctx.fillStyle = colors[Math.floor(p.v * colors.length) % colors.length];
    const nodeGlow = 4 * dpr + p.v * 8 * dpr + analyzedPunch * 6 * dpr;
    drawGlowSprite(ctx, colors[0], p.x, p.y, r * 2 + nodeGlow * 2, r * 2 + nodeGlow * 2, 0.5);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Aurora mode — domain-warped FBM aurora curtains with audio-reactive
 * brightness/height and slow horizontal drift, plus top vignette.
 */
export function renderAurora(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  void dpr;
  void state;
  const { ctx, colors, bg, freq, phraseFlash, energyMod, nowMs, perceptualScale } = modeCtx;
  const t = nowMs() * 0.0003;
  const bandCount = 5;
  const bandW = w / bandCount;
  const d = modeCtx.d;
  const bassEnergy = d.bass || 0;
  const midEnergy = d.mid ?? 0;
  const energy = energyMod;

  // 2026: spectral reactivity — the mode never read `freq`, so it scored
  // react=3 (beat flash only). Three band energies through the shared
  // perceptual mapper: lows drive curtain height/base glow, mids drive
  // brightness, highs drive wave speed + shimmer detail.
  let lowE = 0;
  let midE = 0;
  let highE = 0;
  if (freq && freq.length > 0) {
    const freqMap = makeFreqMapper(
      perceptualScale,
      24,
      freq.length,
      modeCtx.analyser?.context.sampleRate,
    );
    const bandAvg = (from: number, to: number): number => {
      let sum = 0;
      for (let k = from; k < to; k++) sum += sampleMappedBand(freq, freqMap, k);
      return sum / ((to - from) * 255 || 1);
    };
    lowE = bandAvg(0, 8);
    midE = bandAvg(8, 16);
    highE = bandAvg(16, 24);
  }
  const specEnergy = (lowE + midE + highE) / 3;
  // Phase-locked beat pulse for the core (was phraseFlash only).
  const beatPulse = beatPhaseEnvelope(d.beatPhase) ?? modeCtx.beatEnv ?? 0;

  for (let b = 0; b < bandCount; b++) {
    const bx = b * bandW;
    // Highs hurry the curtains; energy keeps a floor on the drift.
    const warpX = b * 0.37 + t * (0.4 + highE * 0.7 + energy * 0.25);
    const hue = (b / bandCount + t * 0.05) % 1;
    const sat = clamp(0.55 + bassEnergy * 0.4 + lowE * 0.2, 0, 1);
    const lightBase = clamp(0.25 + midEnergy * 0.35 + midE * 0.25, 0, 1);
    const rgb = hslToRgb(hue, sat, lightBase);
    const steps = Math.max(1, Math.floor(bandW));
    for (let s = 0; s < steps; s++) {
      const x = bx + (s / steps) * bandW;
      const nx = x / w;
      const warp = fbm(nx * 3 + warpX, b * 0.5, t, 4);
      // Lows lift the curtain height and base glow; overall spectrum energy
      // adds a little amplitude on top of the energyMod term.
      const curtainY =
        h * 0.15 + warp * h * 0.55 * (1 + energy * 0.6 + lowE * 0.9 + specEnergy * 0.3);
      // Highs add a fast shimmer term so the top of the spectrum reads as
      // detail rather than just louder curtains.
      const shimmer = highE * 0.16 * Math.sin(nx * 42 + t * 7 + b);
      const alpha = 0.12 + warp * 0.25 + energy * 0.15 + shimmer + highE * warp * 0.12;
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(alpha, 0, 0.7)})`;
      ctx.fillRect(x, curtainY, Math.ceil(bandW / steps), h - curtainY);
    }
    // Beat flash
    if (d.beat && bassEnergy > 0.35) {
      const flashAlpha = 0.15 + bassEnergy * 0.2;
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(flashAlpha, 0, 0.5)})`;
      ctx.fillRect(bx, 0, bandW, h);
    }
  }

  // Top vignette fade for cinematic aurora look
  const topGrd = ctx.createLinearGradient(0, 0, 0, h * 0.3);
  topGrd.addColorStop(0, withAlpha(bg, "AA"));
  topGrd.addColorStop(1, withAlpha(bg, "00"));
  ctx.fillStyle = topGrd;
  ctx.fillRect(0, 0, w, h * 0.3);

  // Enhanced center anchor with glow and pulsing core — beat grid pulse
  // added (was phraseFlash only, so the core ignored the analysed beat).
  const baseR = Math.min(w, h) * 0.18;
  const coreR =
    baseR * 0.35 * (1 + phraseFlash * 0.5 + modeCtx.d.bass * 0.3 + beatPulse * 0.45 + lowE * 0.3);
  const glowR = coreR * 3;
  const grd = ctx.createRadialGradient(w / 2, h / 2, coreR * 0.2, w / 2, h / 2, glowR);
  grd.addColorStop(0, withAlpha(colors[0], "cc"));
  grd.addColorStop(0.4, withAlpha(colors[1], "66"));
  grd.addColorStop(1, "transparent");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, glowR, 0, Math.PI * 2);
  ctx.fill();

  // Secondary orbital ring
  ctx.strokeStyle = withAlpha(colors[2], "55");
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, coreR * 1.8 + (modeCtx.d.energy ?? 0) * 8 * dpr, 0, Math.PI * 2);
  ctx.stroke();

  // Solid core
  ctx.fillStyle = colors[0];
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, coreR, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Particles mode — delegates to updateAndDrawParticles from particles.ts.
 */
export function renderParticles(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const { ctx, colors, phraseFlash, energyMod, analyzedPunch, rand } = modeCtx;
  const { particles } = state;
  state.lastMs ??= modeCtx.nowMs();
  const now = modeCtx.nowMs();
  const dt = Math.max(0, now - state.lastMs) / 1000;
  state.lastMs = now;
  updateAndDrawParticles(
    ctx,
    particles,
    w,
    h,
    dpr,
    energyMod,
    analyzedPunch,
    modeCtx.d.beat,
    modeCtx.d.bass,
    colors,
    phraseFlash,
    rand,
    dt,
  );
}

/**
 * Dispatch to the correct mode render function.
 * Unknown modes are a no-op (consistent with Canvas2DVisualizer's `else if` chain).
 */
/**
 * Kinetic Typography (T-VIZ-21) — the lyric line IS the scene.
 *
 * Deadpan register per the mode-research spec: restrained palette, no bouncy
 * easing, minimal reactive ground (a thin mirrored spectrum baseline). The
 * current line enters on its LRC start (scale+fade over the first ~12% of the
 * line), exits by decay over the last ~10%, and hook sections (CHORUS/DROP)
 * get a slightly larger cut with a beat-phase pulse. Word-level LRC reveals
 * the current word; instrumental passages fall back to a section card so the
 * mode never sits empty. `motionScale` (reduced-motion) collapses all
 * choreography to fades.
 */
export function renderKineticType(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const {
    ctx,
    bg,
    colors,
    freq,
    lyric,
    lyricProgress = 0,
    sectionName,
    motionScale,
    beatEnv,
    energyMod,
    nowMs,
    perceptualScale,
  } = modeCtx;
  const d = modeCtx.d;
  const vocalEnergy = ((d.mid ?? 0) + d.treble) / 2;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // ── Minimal reactive ground: thin mirrored spectrum baseline ──────────
  // 2026: perceptual mapper + single-bin samples (was a linear i*step bin
  // walk that ignored perceptualScale), plus a beatEnv lift so the ground
  // moves on the beat grid even mid-verse.
  const groundY = h * 0.8;
  const bars = 48;
  const barW = w / bars;
  ctx.fillStyle = withAlpha(colors[1], "33");
  if (freq) {
    const freqMap = makeFreqMapper(
      perceptualScale,
      bars,
      freq.length,
      modeCtx.analyser?.context.sampleRate,
    );
    const groundLift = 0.5 + vocalEnergy + (beatEnv ?? 0) * 0.5;
    for (let i = 0; i < bars; i++) {
      const v = (sampleMappedBand(freq, freqMap, i) / 255) * h * 0.06 * groundLift;
      if (v > 0.5) ctx.fillRect(i * barW + 1, groundY - v, barW - 2, v);
    }
  }
  ctx.fillStyle = withAlpha(colors[1], "55");
  ctx.fillRect(0, groundY, w, Math.max(1, dpr));

  const isHook = sectionName === "CHORUS" || sectionName === "DROP" || sectionName === "PRE-CHORUS";
  const beatPulse = (beatEnv ?? 0) * 0.02 * motionScale;

  // ── Instrumental fallback: section card, never an empty frame ─────────
  if (!lyric) {
    const label = (sectionName ?? "").toLowerCase();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 2026: the card used to sit perfectly static for whole instrumental
    // passages (the scored "dead mode" capture). Slow breathe + beat-grid
    // lift + a few px of drift keep it alive without breaking the
    // deadpan register; motionScale still collapses it under
    // prefers-reduced-motion.
    const idleT = nowMs() * 0.001 * motionScale;
    const idlePulse =
      0.72 +
      0.18 * Math.sin(idleT * 0.9) +
      0.18 * Math.sin(idleT * 0.37 + 1.7) +
      (beatEnv ?? 0) * 0.35 * motionScale;
    const driftY = Math.sin(idleT * 0.5) * h * 0.006 * motionScale;
    ctx.globalAlpha = clamp(idlePulse, 0.3, 1);
    ctx.fillStyle = withAlpha(colors[0], "aa");
    ctx.font = `600 ${Math.round(h * 0.045 * dpr)}px system-ui, sans-serif`;
    const card = label ? label.toUpperCase() : "INSTRUMENTAL";
    ctx.fillText(card, w / 2, h * 0.42 + driftY);
    ctx.globalAlpha = clamp(idlePulse * 0.85, 0.15, 1);
    ctx.fillStyle = withAlpha(colors[1], "66");
    ctx.font = `500 ${Math.round(h * 0.02 * dpr)}px system-ui, sans-serif`;
    ctx.fillText("— instrumental —", w / 2, h * 0.42 + h * 0.07 * dpr + driftY);
    ctx.globalAlpha = 1;
    return;
  }

  // ── Entry / exit envelopes (fractions of the line's own duration) ──────
  const entryT = Math.min(1, lyricProgress / 0.12);
  const exitT = lyricProgress > 0.9 ? (lyricProgress - 0.9) / 0.1 : 0;
  const ease = 1 - Math.pow(1 - entryT, 3);
  const entryScale = 0.94 + 0.06 * ease * motionScale + beatPulse;
  const alpha =
    (0.35 + 0.65 * ease) * (1 - exitT * 0.6 * motionScale) * Math.min(1, 0.4 + energyMod * 0.6);

  // ── Word-level timing: approximate audio position inside the line ──────
  const lineDur = Math.max(0.001, lyric.end - lyric.start);
  const approxTime = lyric.start + lyricProgress * lineDur;
  const words = lyric.words ?? [];
  const useWords = words.length > 0;

  // ── Layout: wrap to lines, then draw centred ───────────────────────────
  const maxW = w * 0.86;
  const baseSize = Math.round(clamp(Math.min(w / 15, h / 6.5), 26, 92) * dpr * (isHook ? 1.08 : 1));
  ctx.font = `${isHook ? 700 : 600} ${baseSize}px system-ui, sans-serif`;

  // Word-wrap preserving per-word identity for highlight.
  const units = useWords
    ? words.map((wd) => ({ text: wd.word, start: wd.start, end: wd.end }))
    : lyric.text
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => ({ text: t }));

  // 2026: full layout cache — word-wrap AND per-word widths were re-measured
  // every frame (~40+ canvas measureText calls/frame). Everything the layout
  // depends on (lyric line, timing, canvas size, dpr, font metrics, hook
  // weight) is captured in cacheKey, so a lyric line pays the measure cost
  // exactly once.
  const cacheKey = `${lyric.start}|${lyric.end}|${lyric.text}|${w}x${h}x${dpr}|${baseSize}|${isHook ? 1 : 0}`;
  let layout = state.kineticLayout;
  if (layout?.key !== cacheKey) {
    const wrapped: { words: { text: string; start?: number; end?: number }[] }[] = [];
    let cur: typeof units = [];
    let curW = 0;
    for (const u of units) {
      const uw = ctx.measureText(u.text + " ").width;
      if (curW + uw > maxW && cur.length > 0) {
        wrapped.push({ words: cur });
        cur = [];
        curW = 0;
      }
      cur.push(u);
      curW += uw;
    }
    if (cur.length) wrapped.push({ words: cur });
    const spaceW = ctx.measureText(" ").width;
    layout = {
      key: cacheKey,
      spaceW,
      lines: wrapped.map((ln) => {
        const widths = ln.words.map((wd) => ctx.measureText(wd.text).width);
        const fullW =
          widths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, ln.words.length - 1);
        return { words: ln.words, widths, fullW };
      }),
    };
    state.kineticLayout = layout;
  }
  const lay = layout;
  const lineH = baseSize * 1.22;
  const blockH = lay.lines.length * lineH;
  const top = h * 0.5 - blockH / 2 + lineH * 0.5;

  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.translate(w / 2, top);
  ctx.scale(entryScale * (1 + vocalEnergy * 0.02 * motionScale), entryScale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  lay.lines.forEach((ln, li) => {
    const y = li * lineH - blockH / 2 + lineH / 2;
    let x = -ln.fullW / 2;
    ln.words.forEach((wd, wi) => {
      const ww = ln.widths[wi];
      let fill = colors[0];
      let wordAlpha = 1;
      if (useWords && wd.start !== undefined && wd.end !== undefined) {
        if (approxTime < wd.start) {
          wordAlpha = 0.45; // sung — recede (deadpan: no bounce, just dim)
        } else if (approxTime < wd.end) {
          fill = colors[1]; // current word lifts
        } else {
          wordAlpha = 0.8;
        }
      }
      ctx.globalAlpha = clamp(alpha * wordAlpha, 0, 1);
      ctx.fillStyle = fill;
      ctx.fillText(wd.text, x + ww / 2, y);
      x += ww + lay.spaceW;
    });
  });
  ctx.restore();
}

export function renderMode(
  mode: string,
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  switch (mode) {
    case "bars":
      renderBars(dpr, w, h, modeCtx, state);
      break;
    case "mirrored-bars":
      renderMirroredBars(dpr, w, h, modeCtx, state);
      break;
    case "segmented-led-bars":
      renderSegmentedLedBars(dpr, w, h, modeCtx, state);
      break;
    case "stereo-split-bars":
      renderStereoSplitBars(dpr, w, h, modeCtx, state);
      break;
    case "stacked-frequency-bands":
      renderStackedFrequencyBands(dpr, w, h, modeCtx, state);
      break;
    case "dot-peak-matrix":
      renderDotPeakMatrix(dpr, w, h, modeCtx, state);
      break;
    case "particles":
      renderParticles(dpr, w, h, modeCtx, state);
      break;
    case "waveform":
      renderWaveform(dpr, w, h, modeCtx, state);
      break;
    case "radial":
      renderRadial(dpr, w, h, modeCtx, state);
      break;
    case "spectrogram":
      renderSpectrogram(dpr, w, h, modeCtx, state);
      break;
    case "lissajous":
      renderLissajous(dpr, w, h, modeCtx, state);
      break;
    case "constellation":
      renderConstellation(dpr, w, h, modeCtx, state);
      break;
    case "aurora":
      renderAurora(dpr, w, h, modeCtx, state);
      break;
    case "kinetic-type":
      renderKineticType(dpr, w, h, modeCtx, state);
      break;
  }
}
