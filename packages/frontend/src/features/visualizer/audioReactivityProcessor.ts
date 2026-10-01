/**
 * AudioReactivityProcessor — Bileam-style audio reactivity module.
 *
 * Pipeline:
 *   1. Per-frame JSON timeline lookup (spectral timeline / analysis data)
 *   2. Exponential smoothing (0.35) on band energies + transient
 *   3. Gamma-curve mapping to shader uniforms
 *   4. Deterministic beat-phase waves (replaces snoise() drift for re-render stability)
 *
 * Usage:
 *   const processor = new AudioReactivityProcessor({ smoothing: 0.35, gamma: 2.2 });
 *   processor.update(spectralFrame);
 *   const uniforms = processor.getUniforms();
 */

import type { SpectralFrame } from "./useSpectralTimeline";

export interface ReactivityConfig {
  /** Exponential smoothing factor (0..1). Higher = snappier, lower = smoother. Default 0.35. */
  smoothing: number;
  /** Gamma curve exponent for mapping linear energy to uniform range. Default 2.2. */
  gamma: number;
  /** transient sensitivity multiplier. Default 1.0. */
  transientSensitivity: number;
  /** bass sensitivity multiplier. Default 1.0. */
  bassSensitivity: number;
  /** mid sensitivity multiplier. Default 1.0. */
  midSensitivity: number;
  /** high sensitivity multiplier. Default 1.0. */
  highSensitivity: number;
  /** Initial BPM estimate (used until audio BPM is known). Default 120. */
  bpm?: number;
}

export const DEFAULT_REACTIVITY_CONFIG: ReactivityConfig = {
  smoothing: 0.35,
  gamma: 2.2,
  transientSensitivity: 1.0,
  bassSensitivity: 1.0,
  midSensitivity: 1.0,
  highSensitivity: 1.0,
};

export interface ReactivityUniforms {
  /** Smoothed bass energy (0..1). */
  sub: number;
  /** Smoothed mid energy (0..1). */
  mid: number;
  /** Smoothed high energy (0..1). */
  high: number;
  /** Smoothed transient flag (0..1). */
  transient: number;
  /** Overall RMS energy (0..1). */
  energy: number;
  /** Spectral centroid normalized (0..1). */
  centroid: number;
  /** Beat phase (0..1) for deterministic animations. */
  beatPhase: number;
  /** Downbeat flag (0 or 1). */
  downbeat: number;
  /** Current BPM. */
  bpm: number;
  /** Smoothed sub energy (0..1). */
  bass: number;
}

/**
 * Deterministic beat-phase wave generator.
 *
 * Replaces `snoise()` drift with repeatable sine-based phase waves
 * so re-renders are frame-accurate and deterministic.
 */
export class BeatPhaseWave {
  private phase: number = 0;
  private lastBeatTime: number = -1;
  private beatIndex: number = 0;
  private bpm: number;

  constructor(bpm: number = 120) {
    this.bpm = bpm;
  }

  setBpm(bpm: number) {
    this.bpm = bpm;
  }

  update(time: number, beatTimes: number[] = []): number {
    if (beatTimes.length === 0) {
      // Fallback: phase from BPM only
      const beatDuration = 60.0 / this.bpm;
      this.phase = (time % beatDuration) / beatDuration;
      return this.phase;
    }

    // Find current beat index from time
    let idx = 0;
    for (let i = 0; i < beatTimes.length; i++) {
      if (beatTimes[i] <= time) idx = i;
      else break;
    }

    if (idx !== this.beatIndex) {
      this.beatIndex = idx;
      this.lastBeatTime = beatTimes[idx] ?? time;
    }

    const beatDuration = 60.0 / this.bpm;
    const sinceBeat = time - this.lastBeatTime;
    this.phase = (sinceBeat % beatDuration) / beatDuration;
    return this.phase;
  }

  getPhase(): number {
    return this.phase;
  }
}

export class AudioReactivityProcessor {
  private smoothed: ReactivityUniforms;
  private beatWave: BeatPhaseWave;
  private lastBpm: number = 120;

  constructor(private config: ReactivityConfig = DEFAULT_REACTIVITY_CONFIG) {
    this.smoothed = {
      bass: 0,
      mid: 0,
      high: 0,
      transient: 0,
      energy: 0,
      centroid: 0,
      beatPhase: 0,
      downbeat: 0,
      bpm: config.bpm ?? 120,
      sub: 0,
    };
    this.beatWave = new BeatPhaseWave(this.lastBpm);
  }

  private smooth(current: number, target: number): number {
    const alpha = this.config.smoothing;
    return current + alpha * (target - current);
  }

  private gamma(value: number): number {
    const safe = Math.max(0, Math.min(1, value));
    return Math.pow(safe, 1.0 / this.config.gamma);
  }

  update(frame: SpectralFrame | null, beatTimes: number[] = [], bpm: number = 120) {
    if (!frame) return;

    // Update BPM if changed
    if (bpm !== this.lastBpm && bpm > 0) {
      this.lastBpm = bpm;
      this.beatWave.setBpm(bpm);
    }

    // Exponential smoothing on raw band energies
    this.smoothed.bass = this.smooth(this.smoothed.bass, frame.sub * this.config.bassSensitivity);
    this.smoothed.mid = this.smooth(this.smoothed.mid, frame.mid * this.config.midSensitivity);
    this.smoothed.high = this.smooth(this.smoothed.high, frame.high * this.config.highSensitivity);
    this.smoothed.sub = this.smooth(this.smoothed.sub, frame.sub);
    this.smoothed.transient = this.smooth(this.smoothed.transient, frame.transient * this.config.transientSensitivity);
    this.smoothed.energy = this.smooth(this.smoothed.energy, frame.rms);
    this.smoothed.centroid = this.smooth(this.smoothed.centroid, frame.centroid);

    // Deterministic beat phase
    const phase = this.beatWave.update(frame.time, beatTimes);
    this.smoothed.beatPhase = phase;
    this.smoothed.downbeat = phase < 0.05 ? 1 : 0;
    this.smoothed.bpm = this.lastBpm;
  }

  /** Return gamma-mapped uniforms ready for shader binding. */
  getUniforms(): ReactivityUniforms {
    return {
      bass: this.gamma(this.smoothed.bass),
      mid: this.gamma(this.smoothed.mid),
      high: this.gamma(this.smoothed.high),
      transient: this.gamma(this.smoothed.transient),
      energy: this.gamma(this.smoothed.energy),
      centroid: this.smoothed.centroid,
      beatPhase: this.smoothed.beatPhase,
      downbeat: this.smoothed.downbeat,
      bpm: this.smoothed.bpm,
      sub: this.gamma(this.smoothed.sub),
    };
  }

  /** Raw smoothed values (pre-gamma) for UI meters. */
  getSmoothed(): ReactivityUniforms {
    return { ...this.smoothed };
  }

  reset() {
    this.smoothed = {
      bass: 0,
      mid: 0,
      high: 0,
      transient: 0,
      energy: 0,
      centroid: 0,
      beatPhase: 0,
      downbeat: 0,
      bpm: this.lastBpm,
      sub: 0,
    };
    this.beatWave = new BeatPhaseWave(this.lastBpm);
  }
}
