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
import { hslToRgb } from "./canvas2dHelpers";

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
 * Spawn one particle from center with outward velocity scaled by energy/beat.
 * No-op when the pool is full.
 */
export function spawnParticle(
  particles: Particle[],
  w: number,
  h: number,
  energy: number,
  beat: boolean,
  rand: () => number = Math.random,
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
    hue: rand() * 360,
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
): void {
  const spawnCount = Math.floor(energy * 6 + analyzedPunch * 8 + (beat ? 14 : 0));
  for (let i = 0; i < spawnCount; i++) spawnParticle(particles, w, h, energy, beat, rand);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    // Audio-reactive velocity: particles accelerate outward on beat/energy
    const accel = 1 + energy * 0.5 + analyzedPunch * 0.6 + (beat ? 1.5 : 0);
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
    ctx.shadowBlur = 6 * dpr + bass * 8 * dpr + analyzedPunch * 6 * dpr;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * dpr + bass * 2 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Center glow — radial gradient from bass/phraseFlash-driven color to transparent
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
      Math.floor(phraseFlash * 40 + bass * 60)
        .toString(16)
        .padStart(2, "0"),
  );
  grd.addColorStop(1, "transparent");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
}
