/**
 * canvas2dModes/waveform — see index.ts for the module map.
 */
import { damp, dampLambda, drawGlowSprite, withAlpha } from "../canvas2dHelpers";
import type { BarModeContext, BarModeState } from "./types";

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
