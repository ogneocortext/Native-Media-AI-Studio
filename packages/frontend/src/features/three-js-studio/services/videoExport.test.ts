import { describe, expect, it } from "vitest";
import { createSeededRandom, planExport } from "./videoExport";

/**
 * F5 determinism contract: the export grid is a pure function of the
 * requested duration/fps, and every frame's timestamp comes from the
 * frame index — never the wall clock. The seeded PRNG is what lets the
 * render loop's per-frame jitter (handheld walk, beat shake) repeat
 * identically across runs.
 */
describe("planExport", () => {
  it("produces exactly 300 frames for the plan's 10 s @ 30 fps case", () => {
    const plan = planExport(10, 30);
    expect(plan.totalFrames).toBe(300);
    expect(plan.dtSec).toBeCloseTo(1 / 30, 12);
  });

  it("rounds rather than truncates the frame count", () => {
    // 10 s @ 29.97 → 299.7 → 300 frames, not 299.
    expect(planExport(10, 29.97).totalFrames).toBe(300);
    // 1 s @ 24 → exactly 24.
    expect(planExport(1, 24).totalFrames).toBe(24);
  });

  it("always yields at least one frame", () => {
    expect(planExport(0, 30).totalFrames).toBe(300); // duration sanitized to 10
    expect(planExport(10, 0).totalFrames).toBe(300); // fps sanitized to 30
    expect(planExport(0.01, 24).totalFrames).toBe(1); // 0.24 rounds to 0 → clamped
  });

  it("timestamps frame i at i/fps, clamped to the duration", () => {
    const plan = planExport(10, 30);
    expect(plan.timeAt(0)).toBe(0);
    expect(plan.timeAt(1)).toBeCloseTo(1 / 30, 12);
    expect(plan.timeAt(299)).toBeCloseTo(299 / 30, 12);
    // A runaway index clamps instead of extending past the export.
    expect(plan.timeAt(10_000)).toBe(10);
    expect(plan.timeAt(-5)).toBe(0);
    expect(plan.timeAt(2.7)).toBeCloseTo(2 / 30, 12); // floors
  });

  it("advances monotonically so the mux sees a sorted timeline", () => {
    const plan = planExport(5, 60);
    let prev = -1;
    for (let i = 0; i < plan.totalFrames; i++) {
      const t = plan.timeAt(i);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it("sanitizes non-finite inputs to the defaults", () => {
    expect(planExport(NaN, 30).durationSec).toBe(10);
    expect(planExport(10, Infinity).fps).toBe(30);
    expect(planExport(-5, 30).durationSec).toBe(10);
  });
});

describe("createSeededRandom", () => {
  it("repeats exactly for the same seed", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("differs for different seeds", () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("stays inside [0, 1) for a long run", () => {
    const rand = createSeededRandom();
    for (let i = 0; i < 5000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("is not constant — it actually varies", () => {
    const rand = createSeededRandom(7);
    const values = new Set(Array.from({ length: 20 }, () => rand()));
    expect(values.size).toBe(20);
  });

  it("spreads roughly uniformly, not clustered at an endpoint", () => {
    const rand = createSeededRandom(0x9e3779b9);
    let sum = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) sum += rand();
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.02);
  });
});
