/**
 * canvas2dModes/shared — see index.ts for the module map.
 */
import { drawGlowSprite, sampleMappedBand } from "../canvas2dHelpers";
import type { BarModeContext, BarModeState } from "./types";

export const PEAK_DECAY = 0.985;

/** Shared boosted-value computation used by every bar-style mode. */
export function boostedValue(rawV: number, ctx: BarModeContext): number {
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
export function computeBarTarget(
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
export function drawBarBody(
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
export function drawBar(
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
export function drawPeakIndicator(
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
export function drawBeatFlash(
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
export function drawDownbeatDot(
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
