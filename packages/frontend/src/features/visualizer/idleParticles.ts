/**
 * Idle ambient particle system for the Canvas2D visualizer.
 *
 * Extracted from Canvas2DVisualizer.tsx — no logic changed. Pure functions
 * over a caller-owned `IdleParticle[]` array, so the array stays per-component
 * instance (held in a `useRef`).
 *
 * Subtle floating motes drawn when no track is playing — keeps the canvas
 * feeling alive without reacting to audio.
 */
import { hslToRgb } from "./canvas2dHelpers";

export interface IdleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
  size: number;
}

export const MAX_IDLE_PARTICLES = 40;

/**
 * Spawn one idle particle at a random position with gentle drift.
 * No-op when the pool is full.
 */
export function spawnIdleParticle(
  particles: IdleParticle[],
  w: number,
  h: number,
  rand: () => number = Math.random,
): void {
  if (particles.length >= MAX_IDLE_PARTICLES) return;
  particles.push({
    x: rand() * w,
    y: rand() * h,
    vx: (rand() - 0.5) * 0.3,
    vy: (rand() - 0.5) * 0.3,
    life: 0.4 + rand() * 0.6,
    hue: rand() * 360,
    size: 0.8 + rand() * 1.2,
  });
}

/**
 * Advance every idle particle one frame: drift by velocity, decay life,
 * remove expired or off-screen particles. Spawns a gentle trickle of new
 * particles each frame. Mutates the array in place.
 */
export function updateIdleParticles(
  particles: IdleParticle[],
  w: number,
  h: number,
  motionScale: number,
  rand: () => number = Math.random,
): void {
  // Spawn a gentle trickle
  if (rand() < 0.06 * motionScale) spawnIdleParticle(particles, w, h, rand);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * motionScale;
    p.y += p.vy * motionScale;
    p.life -= 0.002 * motionScale;
    if (
      p.life <= 0 ||
      p.x < -20 ||
      p.x > w + 20 ||
      p.y < -20 ||
      p.y > h + 20
    ) {
      particles.splice(i, 1);
    }
  }
}

/**
 * Draw every idle particle as a small fading dot.
 */
export function drawIdleParticles(
  ctx: CanvasRenderingContext2D,
  particles: IdleParticle[],
  dpr: number,
): void {
  for (const p of particles) {
    const alpha = p.life * 0.25;
    const rgb = hslToRgb(p.hue / 360, 0.6, 0.55);
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
}
