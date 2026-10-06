import { describe, it, expect } from "vitest";
import { classifyAnalysisResponse } from "./useKeyPalette";
import {
  keyPalette,
  pitchClassToHue,
  hueToRgb,
  parseKey,
  SAT_MAJOR,
  SAT_MINOR,
  SAT_NEUTRAL,
  CONF_FLOOR,
  CONF_CERTAIN,
} from "./keyPalette";

/**
 * Spec: docs/architecture/chroma-hue-mapping.md
 * These assertions are transcribed from the spec document, so a change to the
 * spec that is not mirrored here shows up as a failing test rather than as
 * silent drift between the doc and the code.
 */

describe("classifyAnalysisResponse (Phase 0.3)", () => {
  // A track nobody has analyzed must be a first-class state with an "Analyze"
  // affordance, not an error. Getting this wrong is what made loading a normal
  // unanalyzed track look like something had broken.
  it("treats 404 as 'not analyzed', not as an error", () => {
    expect(classifyAnalysisResponse(404)).toEqual({ kind: "not-analyzed" });
  });

  it("treats 2xx as found", () => {
    for (const status of [200, 201, 204]) {
      expect(classifyAnalysisResponse(status)).toEqual({ kind: "found" });
    }
  });

  it("treats genuine failures as errors, carrying the status", () => {
    for (const status of [400, 401, 403, 500, 502, 503]) {
      expect(classifyAnalysisResponse(status)).toEqual({ kind: "error", status });
    }
  });

  it("does not treat other 4xx as 'not analyzed'", () => {
    // Only 404 means "no such analysis". A 403 is an auth problem and must
    // still surface, or a misconfigured proxy would look like an unanalyzed
    // track and quietly disable the palette.
    expect(classifyAnalysisResponse(403).kind).toBe("error");
    expect(classifyAnalysisResponse(500).kind).toBe("error");
  });

  it("always returns a usable neutral palette for the not-analyzed case", () => {
    // The Q2/Q5 deterministic-fallback contract: an unanalyzed track still has
    // to render, it just renders neutral.
    const p = keyPalette(null, null);
    expect(p.fallback).toBe(true);
    expect(Number.isFinite(p.hue)).toBe(true);
    expect(Number.isFinite(p.saturation)).toBe(true);
  });
});

describe("pitch class -> hue", () => {
  // The full circle-of-fifths table from the spec. Fifths order, not chromatic,
  // so harmonically adjacent keys are 30 degrees apart.
  const FIFTHS: Array<[string, number]> = [
    ["C", 0],
    ["G", 30],
    ["D", 60],
    ["A", 90],
    ["E", 120],
    ["B", 150],
    ["F#", 180],
    ["C#", 210],
    ["G#", 240],
    ["D#", 270],
    ["A#", 300],
    ["F", 330],
  ];

  it.each(FIFTHS)("maps %s to %i degrees", (pc, degrees) => {
    expect(pitchClassToHue(pc)).toBeCloseTo(degrees / 360, 10);
  });

  it("covers all 12 pitch classes exactly once", () => {
    const hues = FIFTHS.map(([pc]) => pitchClassToHue(pc));
    expect(new Set(hues).size).toBe(12);
  });

  it("returns null for an unknown pitch class", () => {
    expect(pitchClassToHue("H")).toBeNull();
    expect(pitchClassToHue("")).toBeNull();
    expect(pitchClassToHue(undefined)).toBeNull();
  });
});

describe("keyPalette", () => {
  it("reproduces the spec's worked example", () => {
    // "A minor", r = 0.82 -> hue 0.25, sat 0.55, conf 0.82
    const p = keyPalette({ estimated_key: "A minor", key_confidence_r: 0.82 });
    expect(p.hue).toBeCloseTo(0.25, 10);
    expect(p.saturation).toBe(SAT_MINOR);
    expect(p.confidence).toBeCloseTo(0.82, 10);
    expect(p.fallback).toBe(false);
  });

  it("maps mode to saturation", () => {
    expect(keyPalette({ estimated_key: "C major", key_confidence_r: 0.9 }).saturation).toBe(SAT_MAJOR);
    expect(keyPalette({ estimated_key: "A minor", key_confidence_r: 0.9 }).saturation).toBe(SAT_MINOR);
  });

  it("uses the key directly at high confidence, ignoring the runner-up", () => {
    const p = keyPalette({
      estimated_key: "D major",
      key_confidence_r: CONF_CERTAIN,
      key_runner_up: "E minor",
      key_runner_up_r: 0.65,
    });
    expect(p.hue).toBeCloseTo(pitchClassToHue("D")!, 10);
    expect(p.saturation).toBe(SAT_MAJOR);
    expect(p.fallback).toBe(false);
  });

  it("falls back to neutral below the confidence floor, holding the last hue", () => {
    const p = keyPalette({ estimated_key: "A minor", key_confidence_r: CONF_FLOOR - 0.01 }, 0.5);
    expect(p.fallback).toBe(true);
    expect(p.saturation).toBe(SAT_NEUTRAL);
    expect(p.hue).toBeCloseTo(0.5, 10);
  });

  it("produces a visible colour when there is no key at all", () => {
    // The deterministic-fallback contract: never a black frame.
    const p = keyPalette(null);
    expect(p.fallback).toBe(true);
    expect(p.saturation).toBe(SAT_NEUTRAL);
    const [r, g, b] = hueToRgb(p.hue, p.saturation);
    expect(Math.max(r, g, b)).toBeGreaterThan(0);
  });

  it("blends toward the runner-up at middling confidence, halving saturation", () => {
    // C (0deg) toward G (30deg), weighted 0.3/0.8 -> 11.25deg.
    const p = keyPalette({
      estimated_key: "C major",
      key_confidence_r: 0.5,
      key_runner_up: "G major",
      key_runner_up_r: 0.3,
    });
    expect(p.hue).toBeCloseTo(11.25 / 360, 10);
    expect(p.saturation).toBeCloseTo(SAT_MAJOR / 2, 10);
    expect(p.fallback).toBe(false);
  });

  it("keeps the hue but desaturates when the runner-up is missing", () => {
    const p = keyPalette({ estimated_key: "E major", key_confidence_r: 0.45 });
    expect(p.hue).toBeCloseTo(pitchClassToHue("E")!, 10);
    expect(p.saturation).toBeCloseTo(SAT_MAJOR / 2, 10);
  });

  it("blends the short way around the hue circle", () => {
    // F (330deg) -> C (0deg) is 30 degrees forward, not 330 degrees backward.
    const p = keyPalette({
      estimated_key: "F major",
      key_confidence_r: 0.5,
      key_runner_up: "C major",
      key_runner_up_r: 0.3,
    });
    expect(p.hue).toBeGreaterThan(0.9);
  });

  it("always returns finite numbers", () => {
    const inputs = [
      null,
      undefined,
      {},
      { estimated_key: null },
      { estimated_key: "H minor" },
      { estimated_key: "A minor", key_confidence_r: Number.NaN },
      { estimated_key: "A minor", key_confidence_r: "0.9" as unknown as number },
    ];
    for (const input of inputs) {
      const p = keyPalette(input as never);
      expect(Number.isFinite(p.hue)).toBe(true);
      expect(Number.isFinite(p.saturation)).toBe(true);
      expect(Number.isFinite(p.confidence)).toBe(true);
    }
  });
});

describe("hueToRgb", () => {
  it("maps primaries at full saturation", () => {
    expect(hueToRgb(0, 1)[0]).toBeCloseTo(1, 10);
    expect(hueToRgb(1 / 3, 1)[1]).toBeCloseTo(1, 10);
    expect(hueToRgb(2 / 3, 1)[2]).toBeCloseTo(1, 10);
  });

  it("wraps past 1 and below 0", () => {
    // Compared per channel with a tolerance: wrapping does arithmetic on the
    // hue fraction, so exact equality would fail on float representation alone.
    const near = (a: [number, number, number], b: [number, number, number]) => {
      a.forEach((channel, i) => expect(channel).toBeCloseTo(b[i], 10));
    };
    near(hueToRgb(1.1, 1), hueToRgb(0.1, 1));
    near(hueToRgb(-0.1, 1), hueToRgb(0.9, 1));
  });

  it("clamps saturation into range", () => {
    for (const channel of hueToRgb(0.3, 5)) expect(channel).toBeLessThanOrEqual(1);
    for (const channel of hueToRgb(0.3, -1)) expect(channel).toBeGreaterThanOrEqual(0);
  });
});
describe("parseKey", () => {
  it("splits pitch class and mode", () => {
    expect(parseKey("A minor")).toEqual({ pc: "A", mode: "minor" });
    expect(parseKey("C major")).toEqual({ pc: "C", mode: "major" });
  });

  it("defaults to major when the mode is omitted", () => {
    // Committed analysis files carry a bare "E". An omitted mode is not
    // evidence of minor, so major is the honest reading.
    expect(parseKey("E")).toEqual({ pc: "E", mode: "major" });
  });

  it("rejects unusable input", () => {
    expect(parseKey("H minor")).toBeNull();
    expect(parseKey("")).toBeNull();
    expect(parseKey(null)).toBeNull();
    expect(parseKey(undefined)).toBeNull();
  });
});