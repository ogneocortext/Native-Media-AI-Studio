/**
 * canvas2dModes/scopes — see index.ts for the module map.
 */
import {
  beatPhaseEnvelope,
  clamp,
  dampDisplay,
  dampLambda,
  drawGlowSprite,
  hexToRgb,
  makeFreqMapper,
  sampleMappedBand,
  withAlpha,
} from "../canvas2dHelpers";
import { boostedValue } from "./shared";
import type { BarModeContext, BarModeState } from "./types";

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
      baseR + disp * baseR * 1.2 * (1 + phraseFlash * 0.4 + energyMod * 0.3 + beatPulse * 0.45);
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
