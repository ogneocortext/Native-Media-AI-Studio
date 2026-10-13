import { describe, it, expect } from "vitest";
import {
  AudioReactivityProcessor,
  composeReactivityConfig,
  DEFAULT_REACTIVITY_CONFIG,
  DEFAULT_REACTIVITY_TRIAD,
} from "./audioReactivityProcessor";
import type { SpectralFrame } from "./useSpectralTimeline";

/**
 * Plan 2.2 — the reactivity triad (sensitivity / attack /
 * release / beat response) and the asymmetric smoother it
 * drives. These tests pin the mapping from the HUD's control
 * surface onto the processor's config, and the attack/release
 * split itself, so a regression (a symmetric smoother, a
 * sensitivity that silently does nothing, a focus bias that
 * misses the wrong band) fails here rather than as a visual
 * that no longer responds to the sliders.
 */

/** A spectral frame with the given band values. */
function frame(bands: Partial<SpectralFrame> = {}): SpectralFrame {
  return {
    frame: 0,
    time: 0,
    sub: 0,
    mid: 0,
    high: 0,
    transient: 0,
    centroid: 0,
    rms: 0,
    ...bands,
  };
}

describe("composeReactivityConfig", () => {
  it("maps the triad onto the processor config", () => {
    const composed = composeReactivityConfig(
      { sensitivity: 1.5, attack: 0.8, release: 0.2, beatResponse: 2.0 },
      { gain: 2.0, focus: "balanced" },
    );
    // The boost is a master gain riding on top of Sensitivity.
    expect(composed.sensitivity).toBeCloseTo(3.0, 6);
    expect(composed.attackSmoothing).toBeCloseTo(0.8, 6);
    expect(composed.releaseSmoothing).toBeCloseTo(0.2, 6);
    expect(composed.transientSensitivity).toBeCloseTo(2.0, 6);
    // Balanced focus leaves every band at unity.
    expect(composed.bassSensitivity).toBeCloseTo(1, 6);
    expect(composed.midSensitivity).toBeCloseTo(1, 6);
    expect(composed.highSensitivity).toBeCloseTo(1, 6);
  });

  it("biases the focused band up and the others down", () => {
    const composed = composeReactivityConfig(DEFAULT_REACTIVITY_TRIAD, {
      focus: "bass",
    });
    expect(composed.bassSensitivity).toBeCloseTo(1.5, 6);
    expect(composed.midSensitivity).toBeCloseTo(0.7, 6);
    expect(composed.highSensitivity).toBeCloseTo(0.7, 6);
  });

  it("defaults gain to unity and focus to balanced", () => {
    const composed = composeReactivityConfig(DEFAULT_REACTIVITY_TRIAD);
    expect(composed.sensitivity).toBeCloseTo(1, 6);
    expect(composed.bassSensitivity).toBeCloseTo(1, 6);
  });
});

describe("AudioReactivityProcessor reactivity triad", () => {
  it("snaps onto onsets with the attack alpha and rings out with the release alpha", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    processor.updateConfig({ attackSmoothing: 0.9, releaseSmoothing: 0.01 });

    // Onset: a 0→1 sub target takes one frame to reach ~0.9.
    processor.update(frame({ sub: 1 }), [], 120);
    expect(processor.getSmoothed().bass).toBeCloseTo(0.9, 6);

    // Release: the same 1→0 target barely moves in one frame
    // (0.9 * 0.99). A symmetric smoother would drop to ~0.59.
    processor.update(frame({ sub: 0 }), [], 120);
    expect(processor.getSmoothed().bass).toBeCloseTo(0.891, 6);
  });

  it("keeps the original symmetric behavior when attack equals release", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    // Both alphas at the 0.35 default: one frame moves 35%
    // of the way, in either direction.
    processor.update(frame({ sub: 1 }), [], 120);
    expect(processor.getSmoothed().bass).toBeCloseTo(0.35, 6);
    processor.update(frame({ sub: 0 }), [], 120);
    expect(processor.getSmoothed().bass).toBeCloseTo(0.35 * 0.65, 6);
  });

  it("scales every band target by the sensitivity multiplier", () => {
    const unity = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    const doubled = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    doubled.updateConfig({ sensitivity: 2.0 });

    unity.update(frame({ sub: 0.5, mid: 0.4, high: 0.3, rms: 0.6 }), [], 120);
    doubled.update(
      frame({ sub: 0.5, mid: 0.4, high: 0.3, rms: 0.6 }),
      [],
      120,
    );

    // First frame: smoothed = alpha * target, and the target
    // is exactly 2× — so the smoothed value is too.
    const a = unity.getSmoothed();
    const b = doubled.getSmoothed();
    expect(b.bass).toBeCloseTo(a.bass * 2, 6);
    expect(b.mid).toBeCloseTo(a.mid * 2, 6);
    expect(b.high).toBeCloseTo(a.high * 2, 6);
    expect(b.energy).toBeCloseTo(a.energy * 2, 6);
  });

  it("scales the transient (beat response) independently of the bands", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    processor.updateConfig({ transientSensitivity: 2.5 });
    processor.update(frame({ transient: 0.4 }), [], 120);
    // 0.4 * 2.5 = 1.0 target; one 0.35-alpha frame → 0.35.
    expect(processor.getSmoothed().transient).toBeCloseTo(0.35, 6);
  });

  it("applies a composed triad end-to-end", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    processor.updateConfig(
      composeReactivityConfig(
        { sensitivity: 2, attack: 0.9, release: 0.05, beatResponse: 1 },
        { gain: 1, focus: "balanced" },
      ),
    );
    // sensitivity 2 × sub 0.5 = 1.0 target; attack 0.9 → 0.9.
    processor.update(frame({ sub: 0.5 }), [], 120);
    expect(processor.getSmoothed().bass).toBeCloseTo(0.9, 6);
  });

  it("re-keys attack/release from smoothing only while they sit at the default", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    // Both alphas start at smoothing (0.35), so a smoothing
    // patch moves both.
    processor.updateConfig({ smoothing: 0.5 });
    processor.update(frame({ sub: 1 }), [], 120);
    expect(processor.getSmoothed().bass).toBeCloseTo(0.5, 6);

    // An explicit attack stops tracking smoothing; release
    // keeps tracking it.
    processor.updateConfig({ attackSmoothing: 0.9 });
    processor.updateConfig({ smoothing: 0.2 });
    processor.update(frame({ sub: 1 }), [], 120);
    // Rising target still uses the explicit 0.9 attack.
    expect(processor.getSmoothed().bass).toBeCloseTo(
      0.5 + 0.9 * (1 - 0.5),
      6,
    );
    processor.update(frame({ sub: 0 }), [], 120);
    // Falling target uses the re-keyed 0.2 release.
    expect(processor.getSmoothed().bass).toBeCloseTo(
      (0.5 + 0.9 * (1 - 0.5)) * 0.8,
      6,
    );
  });

  it("keeps unspecified keys on a partial updateConfig patch", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    processor.updateConfig({ gamma: 1.0 });
    // Gamma is observable through getUniforms: with gamma 1.0
    // the smoothed value passes through unchanged.
    processor.update(frame({ sub: 0.5 }), [], 120);
    expect(processor.getUniforms().bass).toBeCloseTo(0.175, 6);
    // Sensitivity untouched by the gamma-only patch.
    processor.update(frame({ sub: 0.5 }), [], 120);
    // target 0.5, alpha 0.35: 0.175 + 0.35 * (0.5 - 0.175)
    expect(processor.getUniforms().bass).toBeCloseTo(
      0.175 + 0.35 * (0.5 - 0.175),
      6,
    );
  });
});

describe("Plan 2.8 — beat anticipation", () => {
  // 120 BPM grid from t=0: beats every 0.5 s, downbeats (index % 4)
  // at 0, 2.0, 4.0, ...
  const grid120 = Array.from({ length: 17 }, (_, i) => i * 0.5);

  it("ramps anticipation to 1 in the 120 ms before a downbeat", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    // 50 ms before the downbeat at t=2.0.
    processor.update(frame({ time: 1.95 }), grid120, 120);
    expect(processor.getUniforms().anticipation).toBeCloseTo(
      1 - 0.05 / 0.12,
      6,
    );
    // Exactly on the downbeat: full pullback as the accent fires.
    processor.update(frame({ time: 2.0 }), grid120, 120);
    expect(processor.getUniforms().anticipation).toBeCloseTo(1, 6);
  });

  it("holds at 0 on non-downbeat beats and far from bar lines", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    // 50 ms before beat index 2 (t=1.0) — not a downbeat, so the
    // pullback must not fire; the next downbeat is 1.05 s away.
    processor.update(frame({ time: 0.95 }), grid120, 120);
    expect(processor.getUniforms().anticipation).toBe(0);
    // Mid-bar, far from any downbeat.
    processor.update(frame({ time: 1.0 }), grid120, 120);
    expect(processor.getUniforms().anticipation).toBe(0);
  });

  it("falls back to the BPM grid when no beat times exist", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    // 120 BPM, no grid: bars of 2 s from t=0. 100 ms before t=4.0.
    processor.update(frame({ time: 3.9 }), [], 120);
    expect(processor.getUniforms().anticipation).toBeCloseTo(
      1 - 0.1 / 0.12,
      6,
    );
  });

  it("stays at 0 when anticipation is disabled", () => {
    const processor = new AudioReactivityProcessor({
      ...DEFAULT_REACTIVITY_CONFIG,
      anticipationEnabled: false,
    });
    processor.update(frame({ time: 1.95 }), grid120, 120);
    expect(processor.getUniforms().anticipation).toBe(0);
  });

  it("resets anticipation to 0", () => {
    const processor = new AudioReactivityProcessor(DEFAULT_REACTIVITY_CONFIG);
    processor.update(frame({ time: 1.95 }), grid120, 120);
    expect(processor.getUniforms().anticipation).toBeGreaterThan(0);
    processor.reset();
    expect(processor.getUniforms().anticipation).toBe(0);
  });
});
