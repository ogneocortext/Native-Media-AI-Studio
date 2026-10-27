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
  asymmetricSmoothStep,
  clamp,
  easeOutBack,
  fbm,
  hexToRgb,
  hslToRgb,
  makeFreqMapper,
  sampleMappedBand,
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
  rand: () => number;
  /** Cached gradient builder — keyed by mode + palette + height. */
  getGradients: (mode: string, cols: string[]) => CanvasGradient[];
  asymmetric: boolean;
}

export interface BarModeState {
  barVelocities: number[] | null;
  barPeaks: number[] | null;
  smoothedBars: number[] | null;
  smoothedStack: number[] | null;
  waveEnvelope: number[] | null;
  waveVelocities: number[] | null;
  smoothed: Uint8Array | null;
  particles: Particle[];
}

const PEAK_DECAY = 0.985;

/** Shared boosted-value computation used by every bar-style mode. */
function boostedValue(
  rawV: number,
  ctx: BarModeContext,
): number {
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

/** Common per-bar preamble: compute freq, boosted target, and update spring state. */
function computeBarTarget(
  i: number,
  freqMap: (barIndex: number) => number,
  ctx: BarModeContext,
  state: BarModeState,
): { targetNorm: number; smoothH: number; springRising: boolean } {
  const rawV = sampleMappedBand(ctx.freq, freqMap, i) / 255;
  const boosted = boostedValue(rawV, ctx);
  const targetNorm = boosted * ctx.energyMod;
  let smoothH: number;
  let springRising = false;

  if (ctx.asymmetric) {
    const prev = state.smoothedBars?.[i] ?? 0;
    state.smoothedBars![i] = asymmetricSmoothStep(prev, targetNorm);
    smoothH = state.smoothedBars![i] * ctx.h * 0.78;
  } else {
    const prev = state.barPeaks?.[i] ?? 0;
    const targetH = targetNorm * ctx.h * 0.78;
    const springK = 0.28;
    const displacement = targetH - prev;
    state.barVelocities![i] = (state.barVelocities![i] + springK * displacement) * 0.72;
    smoothH = Math.max(0, prev + state.barVelocities![i]);
    springRising = state.barVelocities![i] > 0;
  }
  return { targetNorm, smoothH, springRising };
}

/** Draw a single rounded bar with gradient, warm/cool mix, and reflection. */
function drawBar(
  ctx: CanvasRenderingContext2D,
  h: number,
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
  if (bh > 1) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = gradient;
    const refH = bh * 0.3;
    const refY = h + 2 * dpr;
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
): void {
  const peakY = Math.round(baseY - peak);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
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
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 * dpr;
  ctx.fillRect(x + 1, y - 1 * dpr, bw, 1 * dpr);
  ctx.shadowBlur = 0;
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
  ctx.arc(
    x + barW / 2,
    y - 6 * dpr - rand() * 6 * dpr,
    2 * dpr,
    0,
    Math.PI * 2,
  );
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

  if (!state.barPeaks || state.barPeaks.length !== barCount) {
    state.barPeaks = new Array(barCount).fill(0);
  }
  if (!state.barVelocities || state.barVelocities.length !== barCount) {
    state.barVelocities = new Array(barCount).fill(0);
  }
  if (!state.smoothedBars || state.smoothedBars.length !== barCount) {
    state.smoothedBars = new Array(barCount).fill(0);
  }

  const barGradients = modeCtx.getGradients("bars", modeCtx.colors);
  const baseY = Math.round(h * 0.88);
  const freqLen = modeCtx.freq?.length || 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context?.sampleRate,
  );

  for (let i = 0; i < barCount; i++) {
    const { smoothH, springRising } = computeBarTarget(i, freqMap, modeCtx, state);
    const easeT = clamp(smoothH / Math.max(1, h * 0.78 * modeCtx.energyMod), 0, 1);
    const easedH = modeCtx.asymmetric
      ? smoothH
      : smoothH * (1 + 0.08 * easeOutBack(easeT) * (springRising ? 1 : 0));
    state.barPeaks[i] = easedH;
    const bh = easedH;
    const x = Math.round(i * barW);
    const y = Math.round(baseY - bh);
    const bw = Math.round(barW) - 2;
    const radius = Math.min(bw / 2, 3 * dpr);
    const cIdx = Math.floor((i / barCount) * modeCtx.colors.length);
    const warmMix = i / barCount < 0.3 ? modeCtx.d.bass * 0.35 : 0;
    const coolMix = i / barCount > 0.7 ? modeCtx.d.treble * 0.35 : 0;

    drawBar(
      modeCtx.ctx, h, dpr, x, y, bw, bh, radius,
      barGradients[cIdx % barGradients.length],
      warmMix, coolMix,
    );

    // Falling peak indicator
    if (bh > state.barPeaks[i]) state.barPeaks[i] = bh;
    else state.barPeaks[i] = Math.max(bh, state.barPeaks[i] * PEAK_DECAY);
    drawPeakIndicator(modeCtx.ctx, dpr, x, bw, baseY, state.barPeaks[i]);

    if (modeCtx.d.beat && sampleMappedBand(modeCtx.freq, freqMap, i) / 255 > 0.55) {
      drawBeatFlash(
        modeCtx.ctx, dpr,
        modeCtx.colors[cIdx % modeCtx.colors.length],
        x, y, bw,
      );
            if (modeCtx.isDownbeat) {
        drawDownbeatDot(modeCtx.ctx, dpr, x, y, barW, modeCtx.rand);
      }
    }
  }

  // Secondary harmonic overlay
  modeCtx.ctx.globalAlpha = 0.22 + modeCtx.d.treble * 0.25;
  modeCtx.ctx.fillStyle = modeCtx.colors[2] || modeCtx.colors[1];
  for (let i = 0; i < barCount; i++) {
    const v2 = sampleMappedBand(modeCtx.freq, freqMap, Math.min(freqLen - 1, Math.floor((i * 1.5) % freqLen))) / 255;
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

  if (!state.barPeaks || state.barPeaks.length !== barCount) {
    state.barPeaks = new Array(barCount).fill(0);
  }
  if (!state.barVelocities || state.barVelocities.length !== barCount) {
    state.barVelocities = new Array(barCount).fill(0);
  }

  const barGradients = modeCtx.getGradients("mirrored-bars", modeCtx.colors);
  const centerY = Math.round(h * 0.5);
  const maxBarH = h * 0.38;
  const freqLen = modeCtx.freq?.length || 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context?.sampleRate,
  );

  for (let i = 0; i < barCount; i++) {
    const rawV = sampleMappedBand(modeCtx.freq, freqMap, i) / 255;
    const boosted = boostedValue(rawV, modeCtx);
    const targetH = boosted * maxBarH * modeCtx.energyMod;
    const springK = 0.26;
    const damping = 0.73;
    const displacement = targetH - (state.barPeaks[i] ?? 0);
    state.barVelocities[i] = (state.barVelocities[i] + springK * displacement) * damping;
    const bh = Math.max(0, (state.barPeaks[i] ?? 0) + state.barVelocities[i]);
    if (bh > state.barPeaks[i]) state.barPeaks[i] = bh;
    else state.barPeaks[i] = Math.max(bh, state.barPeaks[i] * PEAK_DECAY);
    const x = Math.round(i * barW);
    const bw = Math.round(barW) - 2;
    const radius = Math.min(bw / 2, 3 * dpr);
    const cIdx = Math.floor((i / barCount) * modeCtx.colors.length);
    const warmMix = i / barCount < 0.3 ? modeCtx.d.bass * 0.35 : 0;
    const coolMix = i / barCount > 0.7 ? modeCtx.d.treble * 0.35 : 0;

    // Upper bar
    const upY = Math.round(centerY - bh);
    modeCtx.ctx.fillStyle = "rgba(0,0,0,0.25)";
    modeCtx.ctx.fillRect(x + 1 + 2 * dpr, upY + 2 * dpr, bw, bh);
    modeCtx.ctx.fillStyle = barGradients[cIdx % barGradients.length];
    modeCtx.ctx.beginPath();
    modeCtx.ctx.roundRect(x + 1, upY, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
    modeCtx.ctx.fill();
    if (warmMix > 0.1) {
      modeCtx.ctx.fillStyle = `rgba(255,120,40,${warmMix * 0.25})`;
      modeCtx.ctx.beginPath();
      modeCtx.ctx.roundRect(x + 1, upY, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
      modeCtx.ctx.fill();
    }
    if (coolMix > 0.1) {
      modeCtx.ctx.fillStyle = `rgba(60,160,255,${coolMix * 0.25})`;
      modeCtx.ctx.beginPath();
      modeCtx.ctx.roundRect(x + 1, upY, bw, bh + 2 * dpr, [radius, radius, 0, 0]);
      modeCtx.ctx.fill();
    }
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
      drawBeatFlash(
        modeCtx.ctx, dpr,
        modeCtx.colors[cIdx % modeCtx.colors.length],
        x, upY, bw,
      );
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

  if (!state.barVelocities || state.barVelocities.length !== barCount) {
    state.barVelocities = new Array(barCount).fill(0);
  }

  const freqLen = modeCtx.freq?.length || 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context?.sampleRate,
  );

  for (let i = 0; i < barCount; i++) {
    const v = sampleMappedBand(modeCtx.freq, freqMap, i) / 255;
    const boosted = boostedValue(v, modeCtx);
    const targetSegs = boosted * segmentsPerBar * modeCtx.energyMod;
    const springK = 0.24;
    const damping = 0.74;
    const displacement = targetSegs - state.barVelocities[i];
    state.barVelocities[i] = (state.barVelocities[i] + springK * displacement) * damping;
    const activeSegments = Math.max(
      0,
      Math.min(segmentsPerBar, Math.round(state.barVelocities[i])),
    );
    const x = Math.round(i * barW);
    const bw = Math.round(barW) - 2;
    const cIdx = Math.floor((i / barCount) * modeCtx.colors.length);
    for (let s = 0; s < segmentsPerBar; s++) {
      const y = baseY - (s + 1) * (segH + gap);
      if (s >= activeSegments) continue;
      modeCtx.ctx.fillStyle = barGradients[cIdx % barGradients.length];
      modeCtx.ctx.beginPath();
      modeCtx.ctx.roundRect(x + 1, y, bw, segH, [1 * dpr, 1 * dpr, 1 * dpr, 1 * dpr]);
      modeCtx.ctx.fill();
      if (modeCtx.d.beat && s === activeSegments - 1) {
        modeCtx.ctx.shadowColor = modeCtx.colors[cIdx % modeCtx.colors.length];
        modeCtx.ctx.shadowBlur = 8 * dpr;
        modeCtx.ctx.fillRect(x + 1, y, bw, segH);
        modeCtx.ctx.shadowBlur = 0;
      }
    }
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

  if (!state.barPeaks || state.barPeaks.length !== barCount) {
    state.barPeaks = new Array(barCount).fill(0);
  }
  if (!state.barVelocities || state.barVelocities.length !== barCount) {
    state.barVelocities = new Array(barCount).fill(0);
  }

  const freqLen = modeCtx.freq?.length || 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context?.sampleRate,
  );

  for (const band of bands) {
    modeCtx.ctx.fillStyle = band.color + "18";
    modeCtx.ctx.fillRect(0, baseY - 2 * dpr, w, 2 * dpr);
    for (let i = band.start; i < band.end; i++) {
      const v = sampleMappedBand(modeCtx.freq, freqMap, i) / 255;
      const boosted = boostedValue(v, modeCtx);
      const targetH = boosted * h * 0.65 * modeCtx.energyMod;
      const springK = 0.26;
      const damping = 0.73;
      const displacement = targetH - (state.barPeaks[i] ?? 0);
      state.barVelocities[i] = (state.barVelocities[i] + springK * displacement) * damping;
      const bh = Math.max(0, (state.barPeaks[i] ?? 0) + state.barVelocities[i]);
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
        modeCtx.ctx.shadowColor = band.color;
        modeCtx.ctx.shadowBlur = 6 * dpr;
        modeCtx.ctx.fillRect(x + 1, y, bw, bh + 2 * dpr);
        modeCtx.ctx.shadowBlur = 0;
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
  const step = Math.floor((modeCtx.freq?.length || 1024) / barCount);
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

  if (!state.barPeaks || state.barPeaks.length !== barCount) {
    state.barPeaks = new Array(barCount).fill(0);
  }
  if (!state.barVelocities || state.barVelocities.length !== barCount) {
    state.barVelocities = new Array(barCount).fill(0);
  }
  if (!state.smoothedStack || state.smoothedStack.length !== barCount * layers.length) {
    state.smoothedStack = new Array(barCount * layers.length).fill(0);
  }

  const freqLen = modeCtx.freq?.length || 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context?.sampleRate,
  );

  for (let i = 0; i < barCount; i++) {
    const x = Math.round(i * barW);
    const bw = Math.round(barW) - 2;
    const radius = Math.min(bw / 2, 3 * dpr);
    let layerY = baseY;
    let topY = baseY;
    let stackH = 0;
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const idx = Math.min(layer.start + i, freqLen - 1);
      const logIdx = Math.min(freqLen - 1, Math.floor(freqMap(idx)));
      const v = (modeCtx.freq?.[logIdx] || 0) / 255;
      const boosted = boostedValue(v, modeCtx);
      let lh = boosted * h * 0.22 * modeCtx.energyMod;
      if (modeCtx.asymmetric) {
        const si = i * layers.length + li;
        state.smoothedStack[si] = asymmetricSmoothStep(
          state.smoothedStack[si],
          boosted * modeCtx.energyMod,
        );
        lh = state.smoothedStack[si] * h * 0.22;
      }
      const ly = Math.round(layerY - lh);
      modeCtx.ctx.fillStyle = layer.color;
      modeCtx.ctx.beginPath();
      modeCtx.ctx.roundRect(x + 1, ly, bw, lh + 2 * dpr, [radius, radius, 0, 0]);
      modeCtx.ctx.fill();
      modeCtx.ctx.fillStyle = "rgba(255,255,255,0.1)";
      modeCtx.ctx.fillRect(x + 1, ly, bw, Math.max(1, lh * 0.25));
      topY = ly;
      layerY = ly;
      stackH += lh;
    }
    // Envelope for the white peak-indicator dash.
    let smoothStackH: number;
    if (modeCtx.asymmetric) {
      smoothStackH = stackH;
    } else {
      const springK = 0.24;
      const damping = 0.74;
      const displacement = stackH - (state.barPeaks[i] ?? 0);
      state.barVelocities[i] = (state.barVelocities[i] + springK * displacement) * damping;
      smoothStackH = Math.max(0, (state.barPeaks[i] ?? 0) + state.barVelocities[i]);
    }
    if (smoothStackH > state.barPeaks[i]) state.barPeaks[i] = smoothStackH;
    else state.barPeaks[i] = Math.max(smoothStackH, state.barPeaks[i] * PEAK_DECAY);
    const peakY = Math.round(baseY - state.barPeaks[i]);
    modeCtx.ctx.fillStyle = "rgba(255,255,255,0.7)";
    modeCtx.ctx.fillRect(x + 1, peakY - 1 * dpr, bw, 1.5 * dpr);
    // Beat glow on top layer
    if (modeCtx.d.beat) {
      const topLayer = layers[layers.length - 1];
      const idx = Math.min(topLayer.start + i, freqLen - 1);
      const v = (modeCtx.freq?.[idx] || 0) / 255;
      if (v > 0.35) {
        modeCtx.ctx.shadowColor = topLayer.color;
        modeCtx.ctx.shadowBlur = 6 * dpr;
        modeCtx.ctx.fillStyle = "rgba(255,255,255,0.15)";
        modeCtx.ctx.fillRect(x + 1, topY, bw, baseY - topY);
        modeCtx.ctx.shadowBlur = 0;
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
  const barCount = 64;
  const cols = barCount;
  const rows = 12;
  const cellW = w / cols;
  const cellH = h / rows;
  const dotR = Math.min(cellW, cellH) * 0.35;
  const barGradients = modeCtx.getGradients("dot-peak-matrix", modeCtx.colors);

  if (!state.barVelocities || state.barVelocities.length !== barCount) {
    state.barVelocities = new Array(barCount).fill(0);
  }

  const freqLen = modeCtx.freq?.length || 1024;
  const freqMap = makeFreqMapper(
    modeCtx.perceptualScale,
    barCount,
    freqLen,
    modeCtx.analyser?.context?.sampleRate,
  );

  for (let i = 0; i < cols; i++) {
    const v = sampleMappedBand(modeCtx.freq, freqMap, i) / 255;
    const boosted = boostedValue(v, modeCtx);
    const targetRows = boosted * rows * modeCtx.energyMod;
    const springK = 0.22;
    const damping = 0.75;
    const displacement = targetRows - state.barVelocities[i];
    state.barVelocities[i] = (state.barVelocities[i] + springK * displacement) * damping;
    const activeRows = Math.max(0, Math.min(rows, Math.round(state.barVelocities[i])));
    const cIdx = Math.floor((i / cols) * modeCtx.colors.length);
    for (let r = 0; r < rows; r++) {
      const cx = Math.round(i * cellW + cellW / 2);
      const cy = Math.round(h - (r + 0.5) * cellH);
      if (r < activeRows) {
        modeCtx.ctx.fillStyle = barGradients[cIdx % barGradients.length];
        modeCtx.ctx.beginPath();
        modeCtx.ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        modeCtx.ctx.fill();
        if (modeCtx.d.beat && r === activeRows - 1) {
          modeCtx.ctx.shadowColor = modeCtx.colors[cIdx % modeCtx.colors.length];
          modeCtx.ctx.shadowBlur = 6 * dpr;
          modeCtx.ctx.beginPath();
          modeCtx.ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
          modeCtx.ctx.fill();
          modeCtx.ctx.shadowBlur = 0;
        }
      } else {
        modeCtx.ctx.fillStyle = "rgba(255,255,255,0.08)";
        modeCtx.ctx.beginPath();
        modeCtx.ctx.arc(cx, cy, dotR * 0.6, 0, Math.PI * 2);
        modeCtx.ctx.fill();
      }
    }
  }
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
  ctx.strokeStyle = colors[0] + "18";
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
  if (!state.smoothed || state.smoothed.length !== wave.length) {
    state.smoothed = new Uint8Array(wave.length);
  }
  for (let i = 0; i < wave.length; i++) {
    const prev = wave[Math.max(0, i - 1)];
    const next = wave[Math.min(wave.length - 1, i + 1)];
    state.smoothed[i] = prev * 0.25 + wave[i] * 0.5 + next * 0.25;
  }

  ctx.strokeStyle = colors[1];
  ctx.lineWidth = 2.2 * dpr;
  ctx.shadowColor = colors[0];
  ctx.shadowBlur =
    9 * dpr + phraseFlash * 14 + (modeCtx.d.peak || 0) * 10 * dpr + energyMod * 8 * dpr;
  ctx.beginPath();
  const slice = w / state.smoothed.length;

  // Spring-smoothed amplitude envelope for the waveform path.
  const springK = 0.22;
  const damping = 0.75;
  if (!state.waveEnvelope || state.waveEnvelope.length !== state.smoothed.length) {
    state.waveEnvelope = new Array(state.smoothed.length).fill(0);
  }
  if (!state.waveVelocities || state.waveVelocities.length !== state.smoothed.length) {
    state.waveVelocities = new Array(state.smoothed.length).fill(0);
  }
  const d = modeCtx.d;
  for (let i = 0; i < state.smoothed.length; i++) {
    const x = i * slice;
    const v = (state.smoothed[i] - 128) / 128;
    const beatPhaseAnt =
      d.beatPhase !== undefined && d.beatPhase !== null && d.beatPhase < 0.5
        ? (1 - d.beatPhase * 2) * 0.15
        : 0;
    const targetAmp =
      v *
      h *
      0.35 *
      (1 + energyMod * 0.85 + phraseFlash * 0.45 + d.bass * 0.25 + beatPhaseAnt);
    const displacement = targetAmp - state.waveEnvelope[i];
    state.waveVelocities[i] = (state.waveVelocities[i] + springK * displacement) * damping;
    state.waveEnvelope[i] = state.waveEnvelope[i] + state.waveVelocities[i];
    const y = h / 2 + state.waveEnvelope[i];
    const xOff =
      syncLineProgress * 14 * dpr * Math.sin(i * 0.01 + nowMs() * 0.001);
    if (i === 0) ctx.moveTo(x + xOff, y);
    else ctx.lineTo(x + xOff, y);
  }
  ctx.stroke();

  // Subtle gradient fill under the primary waveform for depth
  ctx.globalAlpha = 0.12 + energyMod * 0.08;
  const waveGrad = ctx.createLinearGradient(0, h / 2, 0, h);
  waveGrad.addColorStop(0, colors[1] + "00");
  waveGrad.addColorStop(0.5, colors[1] + "44");
  waveGrad.addColorStop(1, colors[1] + "00");
  ctx.fillStyle = waveGrad;
  ctx.beginPath();
  for (let i = 0; i < state.smoothed.length; i++) {
    const x = i * slice;
    const y = h / 2 + state.waveEnvelope![i];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h / 2);
  ctx.lineTo(0, h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Secondary harmonic faint line
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

  // Peak particles — glowing dots along peaks
  ctx.shadowBlur = 8 * dpr;
  for (let i = 0; i < wave.length; i += 24) {
    const v = (wave[i] - 128) / 128;
    if (Math.abs(v) > 0.55) {
      const x = i * slice;
      const y = h / 2 + v * h * 0.35 * (1 + (modeCtx.d.energy || 0) * 0.5);
      ctx.fillStyle = d.beat ? "#ffffff" : colors[1];
      ctx.shadowColor = colors[0];
      ctx.beginPath();
      ctx.arc(x, y, 2.5 * dpr + (modeCtx.d.peak || 0) * 2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
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

  if (!state.barVelocities || state.barVelocities.length !== 64) {
    state.barVelocities = new Array(64).fill(0);
  }

  const freqLen = freq?.length || 1024;
  if (!freq) return;
  for (let i = 0; i < 64; i++) {
    const v = freq[Math.floor((i / 64) * freqLen * 0.6)] / 255;
    const angle = (i / 64) * Math.PI * 2 + sectionRot;
    const r0 = baseR;
    const d = modeCtx.d;
    const beatPhaseAnt =
      d.beatPhase !== undefined && d.beatPhase !== null && d.beatPhase < 0.5
        ? (1 - d.beatPhase * 2) * 0.12
        : 0;
    const targetR1 =
      baseR +
      v * baseR * 1.2 * (1 + phraseFlash * 0.6 + energyMod * 0.4 + beatPhaseAnt);
    const springK = 0.24;
    const damping = 0.74;
    const displacement = targetR1 - (state.barVelocities[i] || 0);
    state.barVelocities[i] = (state.barVelocities[i] + springK * displacement) * damping;
    const r1 = Math.max(r0, state.barVelocities[i] + r0);
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

  // Enhanced center anchor with glow and pulsing core
  const d = modeCtx.d;
  const coreR = baseR * 0.35 * (1 + phraseFlash * 0.5 + d.bass * 0.3);
  const glowR = coreR * 3;
  const grd = ctx.createRadialGradient(cx, cy, coreR * 0.2, cx, cy, glowR);
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
  ctx.arc(cx, cy, coreR * 1.8 + (d.energy || 0) * 8 * dpr, 0, Math.PI * 2);
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
  const freqLen = freq?.length || 1024;
  for (let py = 0; py < specH; py++) {
    const t = py / specH; // 1 at top (high freq), 0 at bottom (low freq)
    const minLog = Math.log(1);
    const maxLog = Math.log(freqLen);
    const logT = minLog + t * (maxLog - minLog);
    const linearT = (Math.exp(logT) - 1) / (freqLen - 1);
    const binIdx = Math.min(freqLen - 1, Math.max(0, Math.floor(linearT * freqLen)));
    const v = (freq?.[binIdx] || 0) / 255;
    if (v < 0.02) continue;
    const colorIdx = clamp(v * (colors.length - 1), 0, colors.length - 1);
    const ci = Math.floor(colorIdx);
    const cf = colorIdx - ci;
    const c1 = hexToRgb(colors[ci % colors.length]);
    const c2 = hexToRgb(colors[(ci + 1) % colors.length]);
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
  ctx.fillStyle = colors[0] + "90";
  ctx.font = `${10 * dpr}px monospace`;
  ctx.textAlign = "right";
  const nyquist = 22050; // assume 44.1kHz sample rate
  const maxFreq = Math.floor(nyquist / 2);
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
  const freqLen = freq?.length || 1024;
  const cx = w / 2;
  const cy = h / 2;
  const bassIdx = Math.floor(freqLen * 0.1);
  const midIdx = Math.floor(freqLen * 0.4);
  const bassV = freq
    ? freq.slice(0, bassIdx).reduce((a, b) => a + b, 0) / (bassIdx * 255 || 1)
    : 0;
  const midV = freq
    ? freq.slice(bassIdx, midIdx).reduce((a, b) => a + b, 0) /
      ((midIdx - bassIdx) * 255 || 1)
    : 0;
  const ampX = w * 0.35 * (1 + bassV * 0.6 + energyMod * 0.3);
  const ampY = h * 0.35 * (1 + midV * 0.6 + energyMod * 0.3);
  const t = nowMs() * 0.001;
  const d = modeCtx.d;

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
  const step = 8;
  const freqLen = freq?.length || 1024;
  if (!freq) return;
  for (let i = 0; i < freqLen; i += step) {
    const v = freq[i] / 255;
    if (v > 0.18) {
      const x = (i / freqLen) * w;
      const y = h - v * h * 0.85;
      points.push({ x, y, v });
      if (points.length >= 64) break;
    }
  }

  // Draw connections — spatial partition to reduce O(n²) complexity
  ctx.strokeStyle = colors[0] + "30";
  ctx.lineWidth = dpr;
  const maxPoints = points.length;
  const gridStep = 60 * dpr;
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
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighborKey = `${gx + dx},${gy + dy}`;
        const neighbors = grid.get(neighborKey);
        if (neighbors) {
          for (const j of neighbors) {
            if (j <= i) continue;
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

  // Draw nodes with spring-smoothed radius per point
  const constellationSpringK = 0.22;
  const constellationDamping = 0.75;
  const pointVelocities = new Array(maxPoints).fill(0);
  const pointRadii = new Array(maxPoints).fill(0);
  const d = modeCtx.d;
  for (let i = 0; i < maxPoints; i++) {
    const p = points[i];
    const targetR =
      2 * dpr +
      p.v * 5 * dpr +
      (d.beat && p.v > 0.7 ? 3 * dpr : 0) +
      analyzedPunch * 3 * dpr;
    const displacement = targetR - pointRadii[i];
    pointVelocities[i] =
      (pointVelocities[i] + constellationSpringK * displacement) * constellationDamping;
    pointRadii[i] = Math.max(0, pointRadii[i] + pointVelocities[i]);
    const r = pointRadii[i];
    ctx.fillStyle =
      colors[Math.floor(p.v * colors.length) % colors.length];
    ctx.shadowColor = colors[0];
    ctx.shadowBlur = 4 * dpr + p.v * 8 * dpr + analyzedPunch * 6 * dpr;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
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
  const { ctx, colors, bg, phraseFlash, energyMod, nowMs } = modeCtx;
  const t = nowMs() * 0.0003;
  const bandCount = 5;
  const bandW = w / bandCount;
  const d = modeCtx.d;
  const bassEnergy = d.bass || 0;
  const midEnergy = d.mid || 0;
  const energy = energyMod;

  for (let b = 0; b < bandCount; b++) {
    const bx = b * bandW;
    const warpX = b * 0.37 + t * 0.4;
    const hue = (b / bandCount + t * 0.05) % 1;
    const sat = 0.55 + bassEnergy * 0.4;
    const lightBase = 0.25 + midEnergy * 0.35;
    const rgb = hslToRgb(hue, sat, lightBase);
    const steps = Math.max(1, Math.floor(bandW));
    for (let s = 0; s < steps; s++) {
      const x = bx + (s / steps) * bandW;
      const nx = x / w;
      const warp = fbm(nx * 3 + warpX, b * 0.5, t, 4);
      const curtainY = h * 0.15 + warp * h * 0.55 * (1 + energy * 0.6);
      const alpha = 0.12 + warp * 0.25 + energy * 0.15;
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
  topGrd.addColorStop(0, bg + "AA");
  topGrd.addColorStop(1, bg + "00");
  ctx.fillStyle = topGrd;
  ctx.fillRect(0, 0, w, h * 0.3);

  // Enhanced center anchor with glow and pulsing core
  const baseR = Math.min(w, h) * 0.18;
  const coreR = baseR * 0.35 * (1 + phraseFlash * 0.5 + modeCtx.d.bass * 0.3);
  const glowR = coreR * 3;
  const grd = ctx.createRadialGradient(w / 2, h / 2, coreR * 0.2, w / 2, h / 2, glowR);
  grd.addColorStop(0, colors[0] + "cc");
  grd.addColorStop(0.4, colors[1] + "66");
  grd.addColorStop(1, "transparent");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, glowR, 0, Math.PI * 2);
  ctx.fill();

  // Secondary orbital ring
  ctx.strokeStyle = colors[2] + "55";
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, coreR * 1.8 + (modeCtx.d.energy || 0) * 8 * dpr, 0, Math.PI * 2);
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
  void state;
  const { ctx, colors, phraseFlash, energyMod, analyzedPunch, rand } = modeCtx;
  const { particles } = state;
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
  );
}

/**
 * Dispatch to the correct mode render function.
 * Unknown modes are a no-op (consistent with Canvas2DVisualizer's `else if` chain).
 */
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
  }
}
