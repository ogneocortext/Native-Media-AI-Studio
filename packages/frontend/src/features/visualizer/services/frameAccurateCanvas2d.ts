/**
 * Plan 2.9 — deterministic render API for the Canvas2D visualizer lane.
 *
 * Extracted from Canvas2DVisualizer.tsx — no logic changed. This module owns
 * all deterministic-export state (virtual clock, seeded RNG, virtual audio
 * buffers, export-active gate) and provides the `FrameAccurateRenderApi`
 * surface that `services/frameAccurateExport.exportFramesDeterministic`
 * consumes.
 *
 * The component's live `draw()` loop shares state with this module:
 * when `beginDeterministicRun` resets the spring/particle state to null via
 * the `resetState` callback, the next `draw()` call re-initializes it cleanly
 * so two exports of the same scene are bit-identical.
 *
 * Mode state shared with the live loop, reset via `resetState` callback:
 *   barVelocities, barPeaks, smoothedBars, smoothedStack,
 *   waveEnvelope, waveVelocities, smoothed,
 *   phraseFlash, beatVignette, silentFrames
 *
 * Cleared via `clearPools` callback (const arrays, not nulled):
 *   particles, idleParticles, shockwaves
 */
import type { AudioData, AudioAnalysisData } from "../types";
import { createSeededRandom } from "../../../shared/seededRandom";
import type { SpectralFrame } from "../useSpectralTimeline";
import { deterministicAudioFrame, frameReadiness } from "./analysisAudioFrame";
import type { FrameAccurateRenderApi } from "./frameAccurateExport";

export interface FrameAccurateCanvas2DDeps {
  /** Sample the spectral timeline at virtual time tSec (seconds). */
  sampleSpectralTimeline: (tSec: number) => SpectralFrame | null;
  /** True when the spectral timeline is still loading. */
  spectralLoading: boolean;
  /** Holder for the backend analysis data (virtual frames read from here). */
  analysisHolder: { current: AudioAnalysisData | null | undefined };
  /** Analyser ref — used to read binCount/fftSize/sampleRate for virtual frames. */
  analyserRef: { current: AnalyserNode | null };
  /** Canvas ref — the exporter captures this canvas. */
  canvasRef: { current: HTMLCanvasElement | null };
  /** The component's draw() function — called synchronously by renderAtVirtualTime. */
  draw: () => void;
  /** Resets all shared mode state to null/zero so frame 0 starts clean. */
  resetState: () => void;
  /** Clears all particle/shockwave pools (const arrays, cleared not nulled). */
  clearPools: () => void;
}

export class FrameAccurateCanvas2D implements FrameAccurateRenderApi {
  /** True while a deterministic export is driving frames manually. */
  private exportActive = false;

  /** Seeded RNG used during export; null for live rendering. */
  private virtualRandom: (() => number) | null = null;

  /** Virtual time being rendered (seconds), or null for live frames. */
  private virtualTime: number | null = null;

  /** Virtual audio data swapped in during virtual frames. */
  private virtualAudio: AudioData | null = null;

  /** Virtual frequency buffer swapped in during virtual frames. */
  private virtualFreq: Uint8Array | null = null;

  /** Virtual waveform buffer swapped in during virtual frames. */
  private virtualWave: Uint8Array | null = null;

  constructor(private readonly deps: FrameAccurateCanvas2DDeps) {}

  /** Can this path render a faithful frame right now? */
  readiness(): { ok: boolean; reason?: string } {
    const frame = this.deps.sampleSpectralTimeline(0);
    if (this.deps.spectralLoading && !frame) {
      return {
        ok: false,
        reason: "the analyzed timeline is still loading — try again in a moment",
      };
    }
    return frameReadiness({
      analysis: this.deps.analysisHolder.current ?? null,
      spectralFrame: frame,
    });
  }

  /** Reset stateful drivers so frame 0 starts clean. */
  beginDeterministicRun(): void {
    this.exportActive = true;
    this.virtualRandom = createSeededRandom(0x5eed_2d01);
    this.deps.resetState();
    this.deps.clearPools();
  }

  /**
   * Render exactly one frame at virtual time `tSec` (seconds).
   * Synchronous w.r.t. the canvas: when it returns, the canvas holds
   * exactly frame `tSec`.
   */
  renderAtVirtualTime(tSec: number): void {
    const analyser = this.deps.analyserRef.current;
    const binCount = analyser?.frequencyBinCount ?? 1024;
    const fftSize = analyser?.fftSize ?? 2048;
    const sampleRate = analyser?.context?.sampleRate ?? 44100;
    const frame = deterministicAudioFrame({
      analysis: this.deps.analysisHolder.current ?? null,
      spectralFrame: this.deps.sampleSpectralTimeline(tSec),
      tSec,
      binCount,
      fftSize,
      sampleRate,
    });
    this.virtualTime = tSec;
    this.virtualAudio = frame.audio;
    this.virtualFreq = frame.freq;
    this.virtualWave = frame.wave;
    try {
      this.deps.draw();
    } finally {
      // Cleared before the next frame so a throw cannot leave the live loop
      // rendering a stale virtual frame.
      this.virtualTime = null;
      this.virtualAudio = null;
      this.virtualFreq = null;
      this.virtualWave = null;
    }
  }

  /** Re-enable live rendering after the last frame. */
  endDeterministicRun(): void {
    this.exportActive = false;
    this.virtualRandom = null;
  }

  /** The canvas this lane renders into. */
  canvas(): HTMLCanvasElement | null {
    return this.deps.canvasRef.current;
  }

  // --- Getters for shared state (used by the live draw loop) ---

  /** True while a deterministic export is in progress. */
  get isExportActive(): boolean {
    return this.exportActive;
  }

  /** Virtual time, or null for live frames. */
  get virtualTimeSec(): number | null {
    return this.virtualTime;
  }

  /** Virtual random (seeded during export, null for live). */
  get virtualRand(): (() => number) | null {
    return this.virtualRandom;
  }

  /** Virtual audio data, or null for live frames. */
  get virtualAudioData(): AudioData | null {
    return this.virtualAudio;
  }

  /** Virtual frequency buffer, or null for live frames. */
  get virtualFreqBuffer(): Uint8Array | null {
    return this.virtualFreq;
  }

  /** Virtual waveform buffer, or null for live frames. */
  get virtualWaveBuffer(): Uint8Array | null {
    return this.virtualWave;
  }
}
