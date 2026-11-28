/**
 * canvas2dModes/ambient — see index.ts for the module map.
 */
import {
  beatPhaseEnvelope,
  clamp,
  fbm,
  hslToRgb,
  makeFreqMapper,
  sampleMappedBand,
  withAlpha,
} from "../canvas2dHelpers";
import { updateAndDrawParticles } from "../particles";
import type { BarModeContext, BarModeState } from "./types";

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
