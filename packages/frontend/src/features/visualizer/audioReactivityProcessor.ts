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
  /**
   * Legacy single-alpha smoothing (0..1). Used as the default for both
   * attack and release when neither is set explicitly. Higher = snappier,
   * lower = smoother. Default 0.35.
   */
  smoothing: number;
  /**
   * Attack smoothing (0..1) — the alpha applied when a band's target is
   * *rising*. Plan 2.2's "Attack" triad knob: high values snap onto
   * onsets within a frame or two. Defaults to `smoothing`.
   */
  attackSmoothing?: number;
  /**
   * Release smoothing (0..1) — the alpha applied when a band's target is
   * *falling*. Plan 2.2's "Release" triad knob: low values let energy
   * ring out instead of collapsing with the onset. Defaults to
   * `smoothing`.
   */
  releaseSmoothing?: number;
  /** Gamma curve exponent for mapping linear energy to uniform range. Default 2.2. */
  gamma: number;
  /**
   * Overall sensitivity multiplier (plan 2.2's "Sensitivity" knob) applied
   * to every band target before smoothing. 1.0 is unity; >1 makes the
   * visualization react harder to quiet passages (and clip sooner — bands
   * are clamped post-gamma). Default 1.0.
   */
  sensitivity: number;
  /** transient sensitivity multiplier. Default 1.0. Plan 2.2's "Beat response" knob. */
  transientSensitivity: number;
  /** bass sensitivity multiplier. Default 1.0. */
  bassSensitivity: number;
  /** mid sensitivity multiplier. Default 1.0. */
  midSensitivity: number;
  /** high sensitivity multiplier. Default 1.0. */
  highSensitivity: number;
  /** Initial BPM estimate (used until audio BPM is known). Default 120. */
  bpm?: number;
  /**
   * Plan 2.8 — master switch for the anticipation pullback uniform.
   * When false, `anticipation` stays 0 (per-style toggle surface;
   * the motion driver's `ResolveMotionOptions.anticipationEnabled`
   * is the spatial counterpart). Default true.
   */
  anticipationEnabled?: boolean;
  /**
   * Plan 2.8 — the anticipation ramp window in seconds: how far
   * before the downbeat the pullback starts. Default 0.12 (~120 ms).
   */
  anticipationWindowSec?: number;
}

export const DEFAULT_REACTIVITY_CONFIG: ReactivityConfig = {
  smoothing: 0.35,
  attackSmoothing: 0.35,
  releaseSmoothing: 0.35,
  gamma: 2.2,
  sensitivity: 1.0,
  transientSensitivity: 1.0,
  bassSensitivity: 1.0,
  midSensitivity: 1.0,
  highSensitivity: 1.0,
  anticipationEnabled: true,
  anticipationWindowSec: 0.12,
};

/**
 * Plan 2.2 — the user-facing reactivity triad plus beat
 * response, as exposed by the ReactivityHUD. This is the
 * *control* surface; `composeReactivityConfig` maps it onto
 * the processor's `ReactivityConfig`.
 */
export interface ReactivityTriad {
  /** Overall sensitivity master gain (0.2–2.5). Default 1. */
  sensitivity: number;
  /** Attack smoothing alpha (0.05–0.95). Default 0.35. */
  attack: number;
  /** Release smoothing alpha (0.01–0.5). Default 0.35. */
  release: number;
  /** Beat (transient) response multiplier (0–2.5). Default 1. */
  beatResponse: number;
}

export const DEFAULT_REACTIVITY_TRIAD: ReactivityTriad = {
  sensitivity: 1.0,
  attack: 0.35,
  release: 0.35,
  beatResponse: 1.0,
};

/** The HUD's frequency-focus band selection. */
export type FrequencyFocus = "balanced" | "bass" | "mid" | "treble";

/**
 * Compose the effective processor config from the triad, the
 * HUD's reactivity boost and its frequency focus.
 *
 * - `gain` multiplies the overall sensitivity (the boost is a
 *   master gain, so it rides on top of the triad's Sensitivity).
 * - `focus` biases the band sensitivities: the focused band gets
 *   1.5×, the others 0.7×, "balanced" leaves them at 1×. This is
 *   what makes the HUD's Focus Emphasis buttons affect the shader
 *   visuals rather than only the meters.
 */
export function composeReactivityConfig(
  triad: ReactivityTriad,
  opts: { gain?: number; focus?: FrequencyFocus } = {},
): Partial<ReactivityConfig> {
  const gain = opts.gain ?? 1;
  const focus = opts.focus ?? "balanced";
  const bandBias = (band: "bass" | "mid" | "high"): number => {
    if (focus === "balanced") return 1;
    return focus === band ? 1.5 : 0.7;
  };
  return {
    sensitivity: triad.sensitivity * gain,
    attackSmoothing: triad.attack,
    releaseSmoothing: triad.release,
    transientSensitivity: triad.beatResponse,
    bassSensitivity: bandBias("bass"),
    midSensitivity: bandBias("mid"),
    highSensitivity: bandBias("high"),
  };
}

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
  /**
   * Plan 2.8 — anticipation pullback (0..1). Ramps from 0 to 1 over
   * `anticipationWindowSec` before each downbeat, hits 1 exactly as
   * the transient accent fires, then drops back to 0 and holds —
   * no post-beat drift. 0 on non-downbeat beats and when
   * `anticipationEnabled` is false. Passed through linearly (no
   * gamma): it is a control ramp, not an energy reading.
   */
  anticipation: number;
}

/** Clamp to 0..1 (local — this module must not import the motion/ tree). */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
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

  /**
   * Plan 2.8 — seconds from `time` to the next downbeat (bar line),
   * for the anticipation pullback.
   *
   * With a beat grid, the next downbeat is the next grid entry whose
   * index is a multiple of 4 (4/4 assumption — the same grid the
   * backend analysis produces). Without a grid, it falls back to the
   * BPM grid: bars of 4 beats measured from t=0. Never negative: when
   * `time` sits exactly on a downbeat, the *next* one (a full bar
   * ahead) is returned.
   */
  timeToNextDownbeat(time: number, beatTimes: number[] = []): number {
    if (beatTimes.length > 0) {
      for (let i = 0; i < beatTimes.length; i++) {
        // The epsilon keeps a frame landing exactly on the downbeat
        // reading 0 ("the accent fires now") instead of skipping to
        // the next bar.
        if (i % 4 === 0 && beatTimes[i] + 1e-9 >= time) {
          return Math.max(0, beatTimes[i] - time);
        }
      }
    }
    const bpm = this.bpm > 0 ? this.bpm : 120;
    const barDuration = (60.0 / bpm) * 4;
    const nextBar = (Math.floor(time / barDuration) + 1) * barDuration;
    return nextBar - time;
  }
}

export class AudioReactivityProcessor {
  private smoothed: ReactivityUniforms;
  private beatWave: BeatPhaseWave;
  private lastBpm: number = 120;

  private attackAlpha: number;
  private releaseAlpha: number;

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
      anticipation: 0,
      bpm: config.bpm ?? 120,
      sub: 0,
    };
    this.attackAlpha = config.attackSmoothing ?? config.smoothing;
    this.releaseAlpha = config.releaseSmoothing ?? config.smoothing;
    this.beatWave = new BeatPhaseWave(this.lastBpm);
  }

  /**
   * Update the config live (plan 2.2 — the reactivity triad). A partial
   * patch; unspecified keys keep their current value. `smoothing` re-keys
   * attack/release only when they were left at their `smoothing` default,
   * so an explicit attack/release the user set is not silently reset.
   */
  updateConfig(patch: Partial<ReactivityConfig>) {
    const prev = this.config;
    this.config = { ...prev, ...patch };
    const attackWasDefault =
      prev.attackSmoothing === undefined ||
      prev.attackSmoothing === prev.smoothing;
    const releaseWasDefault =
      prev.releaseSmoothing === undefined ||
      prev.releaseSmoothing === prev.smoothing;
    if (patch.smoothing !== undefined) {
      if (attackWasDefault) {
        this.attackAlpha = patch.smoothing;
        // Keep the stored value in sync with the new
        // smoothing so a later smoothing patch still
        // recognizes attack as "at the default" —
        // otherwise the stored value goes stale and
        // the re-key silently stops firing.
        this.config.attackSmoothing = patch.smoothing;
      }
      if (releaseWasDefault) {
        this.releaseAlpha = patch.smoothing;
        this.config.releaseSmoothing = patch.smoothing;
      }
    }
    if (patch.attackSmoothing !== undefined) {
      this.attackAlpha = patch.attackSmoothing;
    }
    if (patch.releaseSmoothing !== undefined) {
      this.releaseAlpha = patch.releaseSmoothing;
    }
  }

  private smooth(current: number, target: number): number {
    // Asymmetric exponential smoothing: rising targets take the attack
    // alpha (snap onto onsets), falling targets take the release alpha
    // (let energy ring out). With both alphas equal this is the original
    // symmetric smoother.
    const alpha = target > current ? this.attackAlpha : this.releaseAlpha;
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

    // Exponential smoothing on raw band energies. The overall
    // sensitivity multiplier (plan 2.2) scales every target
    // before its per-band sensitivity, so the triad's
    // "Sensitivity" is a master gain on the reaction, not a
    // per-band trim.
    const sens = this.config.sensitivity;
    this.smoothed.bass = this.smooth(
      this.smoothed.bass,
      frame.sub * this.config.bassSensitivity * sens,
    );
    this.smoothed.mid = this.smooth(
      this.smoothed.mid,
      frame.mid * this.config.midSensitivity * sens,
    );
    this.smoothed.high = this.smooth(
      this.smoothed.high,
      frame.high * this.config.highSensitivity * sens,
    );
    this.smoothed.sub = this.smooth(this.smoothed.sub, frame.sub * sens);
    this.smoothed.transient = this.smooth(
      this.smoothed.transient,
      frame.transient * this.config.transientSensitivity * sens,
    );
    this.smoothed.energy = this.smooth(this.smoothed.energy, frame.rms * sens);
    this.smoothed.centroid = this.smooth(this.smoothed.centroid, frame.centroid);

    // Deterministic beat phase
    const phase = this.beatWave.update(frame.time, beatTimes);
    this.smoothed.beatPhase = phase;
    this.smoothed.downbeat = phase < 0.05 ? 1 : 0;
    // Plan 2.8 — anticipation pullback. Deterministic ramp, not
    // smoothed: smoothing would lag the pullback behind the beat it
    // precedes. Hits 1 exactly on the downbeat, then holds at 0.
    if (this.config.anticipationEnabled === false) {
      this.smoothed.anticipation = 0;
    } else {
      const windowSec = this.config.anticipationWindowSec ?? 0.12;
      const toDownbeat = this.beatWave.timeToNextDownbeat(frame.time, beatTimes);
      this.smoothed.anticipation =
        windowSec > 0 ? clamp01(1 - toDownbeat / windowSec) : 0;
    }
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
      anticipation: this.smoothed.anticipation,
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
      anticipation: 0,
      bpm: this.lastBpm,
      sub: 0,
    };
    this.beatWave = new BeatPhaseWave(this.lastBpm);
  }
}
