import { describe, it, expect } from "vitest";
import {
  getBeatNearTimeFromArray,
  getBeatPhase,
  getNextBeatInFromArray,
  getEnergyAtTime,
} from "./timing";

describe("getBeatNearTimeFromArray", () => {
  const beats = [1.0, 2.5, 4.0, 6.5, 9.0];

  it("returns null for empty beat array", () => {
    expect(getBeatNearTimeFromArray([], 1.0, 0.1)).toBeNull();
  });

  it("returns null for negative elapsed time", () => {
    expect(getBeatNearTimeFromArray(beats, -1, 0.1)).toBeNull();
  });

  it("returns exact match when elapsed equals a beat", () => {
    expect(getBeatNearTimeFromArray(beats, 4.0, 0.1)).toEqual({ index: 2, time: 4.0 });
  });

  it("returns nearest beat within window", () => {
    const result = getBeatNearTimeFromArray(beats, 3.0, 1.0);
    expect(result).not.toBeNull();
    // 3.0 is equidistant (0.5) from beats[1]=2.5 and beats[2]=4.0; either is valid
    expect(Math.abs(result!.time - 3.0)).toBeLessThanOrEqual(1.0);
  });

  it("returns null when no beat within window", () => {
    expect(getBeatNearTimeFromArray(beats, 7.0, 0.1)).toBeNull();
  });

  it("covers beats[lo] when mid==hi at loop exit (the bug case)", () => {
    const result = getBeatNearTimeFromArray([1.0, 4.0, 5.0], 3.0, 1.5);
    expect(result).not.toBeNull();
    expect(result!.time).toBe(4.0);
    expect(result!.index).toBe(1);
  });

  it("picks the closer of two adjacent beats", () => {
    const result = getBeatNearTimeFromArray(beats, 3.4, 1.0);
    expect(result!.time).toBe(4.0);
    expect(result!.index).toBe(2);

    const result2 = getBeatNearTimeFromArray(beats, 3.1, 1.0);
    expect(result2!.time).toBe(2.5);
    expect(result2!.index).toBe(1);
  });

  it("handles elapsed before first beat", () => {
    const result = getBeatNearTimeFromArray(beats, 0.5, 1.0);
    expect(result!.time).toBe(1.0);
    expect(result!.index).toBe(0);
  });

  it("handles elapsed after last beat", () => {
    const result = getBeatNearTimeFromArray(beats, 9.5, 1.0);
    expect(result!.time).toBe(9.0);
    expect(result!.index).toBe(4);
  });

  it("handles single-element array", () => {
    expect(getBeatNearTimeFromArray([5.0], 5.0, 0.1)).toEqual({ index: 0, time: 5.0 });
    expect(getBeatNearTimeFromArray([5.0], 6.0, 2.0)).toEqual({ index: 0, time: 5.0 });
    expect(getBeatNearTimeFromArray([5.0], 10.0, 2.0)).toBeNull();
  });
});

describe("getBeatPhase", () => {
  const beats = [1.0, 2.0, 3.0, 4.0, 5.0];

  it("returns null for empty beat array", () => {
    expect(getBeatPhase([], 1.0)).toBeNull();
  });

  it("returns null for negative elapsed time", () => {
    expect(getBeatPhase(beats, -1)).toBeNull();
  });

  it("returns phase 0 at a beat", () => {
    // At exactly a beat, phase is 0; nextBeatIn is time to the following beat
    const result = getBeatPhase(beats, 2.0);
    expect(result).not.toBeNull();
    expect(result!.phase).toBe(0);
    expect(result!.nextBeatIn).toBe(1);
  });

  it("returns phase 0.5 midway between beats", () => {
    expect(getBeatPhase(beats, 2.5)).toEqual({ phase: 0.5, nextBeatIn: 0.5 });
  });

  it("returns phase approaching 1 before next beat", () => {
    const result = getBeatPhase(beats, 3.9);
    expect(result).not.toBeNull();
    expect(result!.phase).toBeCloseTo(0.9);
    expect(result!.nextBeatIn).toBeCloseTo(0.1);
  });

  it("returns phase 1 when past last beat", () => {
    expect(getBeatPhase(beats, 6.0)).toEqual({ phase: 1, nextBeatIn: 0 });
  });

  it("returns phase 0 before first beat", () => {
    expect(getBeatPhase(beats, 0.5)).toEqual({ phase: 0, nextBeatIn: 0.5 });
  });
});

describe("getNextBeatInFromArray", () => {
  const beats = [1.0, 3.0, 6.0, 10.0];

  it("returns 0 for empty array or negative time", () => {
    expect(getNextBeatInFromArray([], 1.0)).toBe(0);
    expect(getNextBeatInFromArray(beats, -1)).toBe(0);
  });

  it("returns time to next beat", () => {
    expect(getNextBeatInFromArray(beats, 2.0)).toBe(1.0);
    expect(getNextBeatInFromArray(beats, 3.0)).toBe(3.0);
  });

  it("returns 0 when past last beat", () => {
    expect(getNextBeatInFromArray(beats, 11.0)).toBe(0);
  });
});

describe("getEnergyAtTime", () => {
  it("returns 0 for empty curve", () => {
    expect(getEnergyAtTime([], 100, 10)).toBe(0);
  });

  it("returns 0 for non-positive duration", () => {
    expect(getEnergyAtTime([0.5], 0, 10)).toBe(0);
    expect(getEnergyAtTime([0.5], -1, 10)).toBe(0);
  });

  it("returns 0 for negative elapsed time", () => {
    expect(getEnergyAtTime([0.5], 100, -1)).toBe(0);
  });

  it("returns the only value for single-point curve", () => {
    expect(getEnergyAtTime([0.7], 100, 50)).toBe(0.7);
  });

  it("interpolates linearly between two points", () => {
    expect(getEnergyAtTime([0, 1], 100, 50)).toBeCloseTo(0.5);
    expect(getEnergyAtTime([0, 1], 100, 25)).toBeCloseTo(0.25);
  });

  it("clamps at end of curve", () => {
    expect(getEnergyAtTime([0, 1], 100, 100)).toBe(1);
  });
});
