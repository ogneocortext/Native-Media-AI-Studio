/**
 * Audio-reactive particle system for the Canvas2D visualizer's "particles" mode.
 *
 * Extracted from Canvas2DVisualizer.tsx — no logic changed. Pure functions
 * over a caller-owned `Particle[]` array, so the array stays per-component
 * instance (held in a `useRef`).
 *
 * Particles spawn from center on energy/beat, accelerate outward, and fade.
 * A center glow completes the mode.
 */
import { damp, dampLambda, hslToRgb, hexToRgb, withAlpha } from "./canvas2dHelpers";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
  size: number;
}

export const MAX_PARTICLES = 300;

/**
 * Hue (0..360) of a `#rrggbb` palette color, or null for greys/non-hex
 * strings. Particles tint from the section palette instead of the old
 * uniform `rand() * 360` rainbow, so the particle field agrees with the
 * rest of the mode's color story.
 */
function hexToHue(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = hexToRgb(`#${m[1]}`).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return null; // grey — let the caller fall back to random
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (((hue * 60) % 360) + 360) % 360;
}

/**
 * Spawn one particle from center with outward velocity scaled by energy/beat.
 * No-op when the pool is full. `hue` overrides the random hue (palette tint).
 */
export function spawnParticle(
  particles: Particle[],
  w: number,
  h: number,
  energy: number,
  beat: boolean,
  rand: () => number = Math.random,
  hue?: number,
): void {
  if (particles.length >= MAX_PARTICLES) return;
  const angle = rand() * Math.PI * 2;
  const speed = 0.5 + rand() * 2 + energy * 3 + (beat ? 3 : 0);
  particles.push({
    x: w / 2 + (rand() - 0.5) * w * 0.5,
    y: h / 2 + (rand() - 0.5) * h * 0.5,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 1,
    hue: hue ?? rand() * 360,
    size: 0.6 + rand() * 2.0,
  });
}

/**
 * Spawn, update, and draw all particles for one frame, then draw the center
 * glow. Mutates the array in place.
 *
 * `d` must expose `bass` (used for shadow blur and size scaling).
 */
export function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  w: number,
  h: number,
  dpr: number,
  energy: number,
  analyzedPunch: number,
  beat: boolean,
  bass: number,
  colors: string[],
  phraseFlash: number,
  rand: () => number = Math.random,
  dt: number = 1 / 60,
): void {
  // 2026: tint particles from the section palette (was rand()*360 — a
  // rainbow that ignored the mode's color story). Greys/non-hex entries
  // drop out and the spawn falls back to a random hue.
  const paletteHues = colors.map(hexToHue).filter((h): h is number => h !== null);
  // Spawn budget is per-frame — scale by dt*60 so the spawn *rate* is
  // frame-rate independent (same frameScale the update loop uses).
  const frameScale = dt * 60;
  const spawnCount = Math.floor(
    (energy * 6 + analyzedPunch * 8 + (beat ? 14 : 0)) * frameScale,
  );
  for (let i = 0; i < spawnCount; i++) {
    const hue = paletteHues.length
      ? paletteHues[Math.floor(rand() * paletteHues.length)]
      : undefined;
    spawnParticle(particles, w, h, energy, beat, rand, hue);
  }

  // Frame-rate-independent velocity decay toward 0.
  // lambda = -60 * ln(1 - k) where k = 1 - 0.995 = 0.005 at 60 Hz.
  const dragLambda = dampLambda(1 - 0.995);
  // `vx`/`vy` are "pixels per 1/60 s frame" — scale integration, the
  // per-frame accel compound, and the life drain by dt*60 so a 120 Hz
  // display does not double particle speed or halve lifetimes.
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    // Audio-reactive velocity: particles accelerate outward on beat/energy.
    // Compounded per frame before — pow() makes it frame-rate independent.
    const accel = 1 + energy * 0.5 + analyzedPunch * 0.6 + (beat ? 1.5 : 0);
    const accelDt = Math.pow(accel, frameScale);
    p.vx *= accelDt;
    p.vy *= accelDt;
    // Slight drag to prevent runaway speeds — frame-rate independent via damp().
    p.vx = damp(p.vx, 0, dragLambda, dt);
    p.vy = damp(p.vy, 0, dragLambda, dt);
    p.x += p.vx * frameScale;
    p.y += p.vy * frameScale;
    p.life -= (0.012 + energy * 0.01) * frameScale;
    if (p.life <= 0 || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
      particles.splice(i, 1);
      continue;
    }
    const alpha = p.life * 0.8;
    const rgb = hslToRgb(p.hue / 360, 1, 0.5 + energy * 0.3);
    const radius = p.size * dpr + bass * 2 * dpr;
    // T-VIZ-17: two-pass glow — wide soft additive halo + crisp core,
    // replacing per-particle shadow blur (the worst canvas2d offender).
    const prevCO = ctx.globalCompositeOperation;
    const prevA = ctx.globalAlpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 3 + bass * 4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = prevCO;
    ctx.globalAlpha = prevA;
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Center glow — radial gradient from bass/phraseFlash-driven color to transparent
  const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.3);
  // Alpha byte is clamped to a byte: phraseFlash/bass are nominally 0..1 but
  // an out-of-range energy value must not emit a 3-char hex suffix.
  const alphaByte = Math.floor(Math.min(255, Math.max(0, phraseFlash * 40 + bass * 60)))
    .toString(16)
    .padStart(2, "0");
  grd.addColorStop(0, withAlpha(colors[0], alphaByte));
  grd.addColorStop(1, "transparent");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
}
