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
  renderBars,
  renderDotPeakMatrix,
  renderMirroredBars,
  renderSegmentedLedBars,
  renderStackedFrequencyBands,
  renderStereoSplitBars,
} from "./bars";
import { renderWaveform } from "./waveform";
import { renderConstellation, renderLissajous, renderRadial, renderSpectrogram } from "./scopes";
import { renderAurora, renderParticles } from "./ambient";
import { renderKineticType } from "./kinetic";
import type { BarModeContext, BarModeState } from "./types";

export {
  renderBars,
  renderDotPeakMatrix,
  renderMirroredBars,
  renderSegmentedLedBars,
  renderStackedFrequencyBands,
  renderStereoSplitBars,
} from "./bars";
export { renderWaveform } from "./waveform";
export { renderConstellation, renderLissajous, renderRadial, renderSpectrogram } from "./scopes";
export { renderAurora, renderParticles } from "./ambient";
export { renderKineticType } from "./kinetic";
export type { BarModeContext, BarModeState } from "./types";

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
    case "kinetic-type":
      renderKineticType(dpr, w, h, modeCtx, state);
      break;
  }
}
