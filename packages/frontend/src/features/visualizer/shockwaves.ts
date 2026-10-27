/**
 * Drum shockwave system for the Canvas2D visualizer.
 *
 * Extracted from Canvas2DVisualizer.tsx — no logic changed. Pure functions
 * over a caller-owned `Shockwave[]` array, so the array stays per-component
 * instance (held in a `useRef`) and is clearable during Plan 2.9 deterministic
 * export resets.
 *
 * Per-drum differentiation per 2026 research:
 *   kick  = slower/thicker
 *   snare = fast/sheared
 *   hat   = flash
 */
import { clamp, hslToRgb } from "./canvas2dHelpers";

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  hue: number;
  lineWidth: number;
  speed: number;
  shear: number;
}

export const MAX_SHOCKWAVES = 8;

/**
 * Spawn one shockwave at a jittered center, differentiated by drum type.
 * No-op when the pool is full (rings a mode won't draw are never spawned,
 * so they can't leak into the next beat's frame).
 */
export function spawnShockwave(
  shockwaves: Shockwave[],
  w: number,
  h: number,
  drumType?: string,
  rand: () => number = Math.random,
): void {
  if (shockwaves.length >= MAX_SHOCKWAVES) return;
  const cx = w / 2 + (rand() - 0.5) * w * 0.4;
  const cy = h / 2 + (rand() - 0.5) * h * 0.3;

  let radius: number;
  let maxRadius: number;
  let alpha: number;
  let hue: number;
  let lineWidth: number;
  let speed: number;
  let shear: number;

  if (drumType === "kick") {
    radius = 4;
    maxRadius = Math.min(w, h) * 0.5;
    alpha = 0.6;
    hue = 0;
    lineWidth = 2.5;
    speed = 0.08;
    shear = 0;
  } else if (drumType === "snare") {
    radius = 2;
    maxRadius = Math.min(w, h) * 0.35;
    alpha = 0.45;
    hue = 200;
    lineWidth = 1.8;
    speed = 0.12;
    shear = 0.15;
  } else if (drumType === "hat") {
    radius = 1;
    maxRadius = Math.min(w, h) * 0.2;
    alpha = 0.7;
    hue = 240;
    lineWidth = 1.0;
    speed = 0.2;
    shear = 0;
  } else {
    // Fallback for unknown drum type
    radius = 2;
    maxRadius = Math.min(w, h) * 0.25;
    alpha = 0.35;
    hue = 180;
    lineWidth = 1.5;
    speed = 0.08;
    shear = 0;
  }

  shockwaves.push({
    x: cx,
    y: cy,
    radius,
    maxRadius,
    alpha,
    hue,
    lineWidth,
    speed,
    shear,
  });
}

/**
 * Advance every shockwave one frame: expand radius, fade alpha, remove spent
 * rings. Mutates the array in place.
 */
export function updateShockwaves(shockwaves: Shockwave[], motionScale: number): void {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.radius += (s.maxRadius - s.radius) * s.speed * motionScale;
    s.alpha -= 0.015 * motionScale;
    if (s.alpha <= 0 || s.radius >= s.maxRadius) {
      shockwaves.splice(i, 1);
    }
  }
}

/**
 * Draw every live shockwave as a colored ring. Snare rings get a tangential
 * shear transform.
 */
export function drawShockwaves(
  ctx: CanvasRenderingContext2D,
  shockwaves: Shockwave[],
  dpr: number,
): void {
  for (const s of shockwaves) {
    const rgb = hslToRgb(s.hue / 360, 0.8, 0.55);
    ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(s.alpha, 0, 1)})`;
    ctx.lineWidth = s.lineWidth * dpr;
    ctx.beginPath();

    if (s.shear > 0) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.transform(1, s.shear, 0, 1, 0, 0);
      ctx.translate(-s.x, -s.y);
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
