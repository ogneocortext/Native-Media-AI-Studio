import { describe, it, expect, vi, afterEach } from "vitest";
import {
  smoothBeatPhase,
  estimateOutputLatency,
  createAudioClock,
  ANALYSER_SMOOTHING,
  ATTACK,
  RELEASE,
} from "./audioTiming";

/**
 * audioTiming is the module every timed lookup depends on: beat grid, LRC
 * highlighting and section changes all read from it, and it exists precisely
 * because those were drifting. A regression here is silent — nothing throws,
 * visuals just land a beat late — which is why these cover the wrap and
 * clamping edges rather than the happy path only.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("constants", () => {
  it("keeps attack above release so transients rise faster than they fall", () => {
    expect(ATTACK).toBeGreaterThan(RELEASE);
  });

  it("keeps analyser smoothing in [0, 1)", () => {
    expect(ANALYSER_SMOOTHING).toBeGreaterThanOrEqual(0);
    expect(ANALYSER_SMOOTHING).toBeLessThan(1);
  });
});

describe("smoothBeatPhase", () => {
  it("moves toward the target by 30% of the delta", () => {
    expect(smoothBeatPhase(0.3, 0)).toBeCloseTo(0.09, 10);
  });

  it("takes the short way around the wrap instead of spinning backwards", () => {
    // 0.97 -> 0.03 is a 6% forward step, not a 94% backward one. If the phase
    // moved backwards the beat indicator would visibly stutter on every wrap.
    const next = smoothBeatPhase(0.03, 0.97);
    expect(next).toBeGreaterThan(0.97);
    expect(next).toBeLessThan(1.03);
  });

  it("always returns a phase in [0, 1)", () => {
    const cases: Array<[number, number]> = [
      [0.99, 0.0],
      [0.0, 0.99],
      [1.5, -0.25],
      [0.5, 0.5],
      [2.7, 2.7],
    ];
    for (const [target, smoothed] of cases) {
      const out = smoothBeatPhase(target, smoothed);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThan(1);
    }
  });

  it("converges toward the target across repeated frames", () => {
    let phase = 0;
    for (let i = 0; i < 60; i++) phase = smoothBeatPhase(0.5, phase);
    expect(phase).toBeCloseTo(0.5, 2);
  });
});

describe("estimateOutputLatency", () => {
  const ctx = (output: number | undefined, base: number | undefined) =>
    ({ outputLatency: output, baseLatency: base }) as unknown as BaseAudioContext;

  it("returns 0 without a context", () => {
    expect(estimateOutputLatency(null)).toBe(0);
  });

  it("sums output and base latency", () => {
    expect(estimateOutputLatency(ctx(0.02, 0.01))).toBeCloseTo(0.03, 10);
  });

  it("treats missing latency properties as zero", () => {
    // Browsers that do not implement outputLatency report undefined; that must
    // not become NaN and poison every downstream timed lookup.
    expect(estimateOutputLatency(ctx(undefined, undefined))).toBe(0);
  });

  it("rejects NaN, Infinity and negative values", () => {
    expect(estimateOutputLatency(ctx(Number.NaN, 0.01))).toBe(0);
    expect(estimateOutputLatency(ctx(Number.POSITIVE_INFINITY, 0))).toBe(0);
    expect(estimateOutputLatency(ctx(-0.2, 0))).toBe(0);
  });

  it("clamps to 0.5 s so a bad report cannot desync everything", () => {
    expect(estimateOutputLatency(ctx(5, 5))).toBe(0.5);
  });
});
describe("createAudioClock", () => {
  /** Minimal stand-in for HTMLMediaElement with the fields the clock reads. */
  const el = (currentTime: number, playbackRate = 1) =>
    ({ currentTime, playbackRate }) as HTMLMediaElement;

  it("interpolates between coarse currentTime ticks", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    // First sample establishes the tick baseline.
    clock.sample(el(10), 0);
    // 250 ms later with no new tick: the clock should have advanced, not frozen.
    vi.spyOn(performance, "now").mockReturnValue(250);
    expect(clock.sample(el(10), 0)).toBeCloseTo(10.25, 10);
  });

  it("re-baselines when the media element ticks forward", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    clock.sample(el(10), 0);
    vi.spyOn(performance, "now").mockReturnValue(500);
    // currentTime jumped to 12.5; elapsed wall time must not be added on top of
    // it, or the clock would overshoot.
    expect(clock.sample(el(12.5), 0)).toBeCloseTo(12.5, 10);
  });

  it("subtracts latency so the reported position is what is heard", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    expect(clock.sample(el(10), 0.25)).toBeCloseTo(9.75, 10);
  });

  it("never reports a negative position", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    // Latency larger than the elapsed time would otherwise go negative.
    expect(clock.sample(el(0.1), 5)).toBe(0);
  });

  it("clamps interpolation so a stalled element cannot run away", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    clock.sample(el(10), 0);
    // 30 s of wall time with no media tick: capped at tick + 0.5 s.
    vi.spyOn(performance, "now").mockReturnValue(30_000);
    expect(clock.sample(el(10), 0)).toBeCloseTo(10.5, 10);
  });

  it("scales interpolation by playbackRate", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    clock.sample(el(10, 2), 0);
    // 100 ms of wall time at 2x = 0.2 s of media time. The window is kept under
    // 0.5 s so the stall clamp below is not what is being measured here.
    vi.spyOn(performance, "now").mockReturnValue(100);
    expect(clock.sample(el(10, 2), 0)).toBeCloseTo(10.2, 10);
  });

  it("lets the stall clamp override a fast playbackRate", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    clock.sample(el(10, 2), 0);
    // At 2x, one second of wall time would interpolate to 12 s, but no tick
    // arrived, so the clamp caps the result at tick + 0.5 s. A clock that ran
    // ahead of the media element is worse than one that lags briefly.
    vi.spyOn(performance, "now").mockReturnValue(1000);
    expect(clock.sample(el(10, 2), 0)).toBeCloseTo(10.5, 10);
  });

  it("returns the last position when the element is absent", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    clock.sample(el(10), 0.2);
    vi.spyOn(performance, "now").mockReturnValue(400);
    // A null element (track swapped mid-frame) must not throw or reset to 0.
    expect(clock.sample(null, 0.2)).toBeCloseTo(9.8, 10);
  });

  it("treats a non-finite latency as zero rather than producing NaN", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    expect(clock.sample(el(10), Number.NaN)).toBeCloseTo(10, 10);
  });

  it("reset() clears the interpolation baseline", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const clock = createAudioClock();
    clock.sample(el(10), 0.2);
    clock.reset();
    // After a reset the stale tick anchor is gone, so a fresh element starts
    // from its own time rather than interpolating against the old one.
    expect(clock.sample(el(3), 0)).toBeCloseTo(3, 10);
  });
});