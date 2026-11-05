import { describe, it, expect } from "vitest";
import { sampleSpectralFrame, type SpectralFrame } from "./useSpectralTimeline";

function frame(partial: Partial<SpectralFrame> & { time: number }): SpectralFrame {
  return {
    frame: 0,
    sub: 0,
    mid: 0,
    high: 0,
    transient: 0,
    centroid: 0,
    rms: 0,
    ...partial,
  };
}

/**
 * T-VIZ-19 — interpolated spectral-timeline sampling. Before this change
 * `sampleAtTime` snapped to `floor(time * fps)`, so band energies stepped
 * at frame boundaries; now they lerp between adjacent analysis frames.
 */
describe("sampleSpectralFrame (T-VIZ-19)", () => {
  const frames = [
    frame({ frame: 0, time: 0, sub: 0.0, mid: 0.0, rms: 0.0 }),
    frame({ frame: 1, time: 1 / 24, sub: 1.0, mid: 0.0, rms: 0.5 }),
    frame({ frame: 2, time: 2 / 24, sub: 0.0, mid: 1.0, rms: 1.0 }),
  ];
  const fps = 24;

  it("returns null for an empty timeline", () => {
    expect(sampleSpectralFrame([], fps, 0.5)).toBeNull();
  });

  it("returns the exact frame at frame boundaries", () => {
    const f0 = sampleSpectralFrame(frames, fps, 0);
    const f1 = sampleSpectralFrame(frames, fps, 1 / 24);
    expect(f0?.sub).toBe(0);
    expect(f1?.sub).toBe(1);
    expect(f1?.mid).toBe(0);
  });

  it("lerps band energies between adjacent frames", () => {
    // Halfway between frame 0 (sub=0) and frame 1 (sub=1).
    const mid = sampleSpectralFrame(frames, fps, 0.5 / 24);
    expect(mid?.sub).toBeCloseTo(0.5, 5);
    expect(mid?.frame).toBe(0); // metadata from the earlier frame
    // Three-quarters of the way: sub falls back toward frame 2's 0.
    const q = sampleSpectralFrame(frames, fps, 1.75 / 24);
    expect(q?.sub).toBeCloseTo(0.25, 5);
    expect(q?.mid).toBeCloseTo(0.75, 5);
  });

  it("clamps out-of-range times instead of reading past the array", () => {
    expect(sampleSpectralFrame(frames, fps, -5)?.sub).toBe(0);
    expect(sampleSpectralFrame(frames, fps, 999)?.sub).toBe(0); // last frame
    expect(sampleSpectralFrame(frames, fps, 999)?.frame).toBe(2);
  });
});
