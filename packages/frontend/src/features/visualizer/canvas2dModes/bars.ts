/**
 * canvas2dModes/bars — see index.ts for the module map.
 */
import {
  beatPhaseEnvelope,
  clamp,
  damp,
  dampDisplay,
  dampLambda,
  drawGlowSprite,
  easeOutBack,
  makeFreqMapper,
  sampleMappedBand,
  withAlpha,
} from "../canvas2dHelpers";
import {
  boostedValue,
  PEAK_DECAY,
  computeBarTarget,
  drawBarBody,
  drawBar,
  drawPeakIndicator,
  drawBeatFlash,
  drawDownbeatDot,
} from "./shared";
import type { BarModeContext, BarModeState } from "./types";

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
    const disp = dampDisplay(state.displayBars[i], clamp(targetRows, 0, rows), dispLambda, frameDt);
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
