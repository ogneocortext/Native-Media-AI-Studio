import { describe, it, expect } from "vitest";
import { selectVizMode } from "./visualizerHelpers";

/**
 * Q4 — visualizer mode auto-selection. `selectVizMode` picks the highest-priority
 * mode suited to a track's characteristics, following the Q2 fallback model:
 * modes are a priority list, not a manual toggle. Callers fall back down
 * `VIZ_MODE_PRIORITY` if the chosen mode can't initialize.
 *
 * These tests pin the selection rules so a regression here silently
 * misassigns tracks to the wrong visual stage rather than surfacing an error.
 */

describe("selectVizMode", () => {
  it("defaults to the first priority mode (3d) when nothing matches", () => {
    expect(selectVizMode("unknown track")).toBe("3d");
    expect(selectVizMode("", undefined, undefined, undefined)).toBe("3d");
  });

  it("picks 3d for high energy", () => {
    expect(selectVizMode("track", undefined, 0.8)).toBe("3d");
    expect(selectVizMode("track", undefined, 1.0)).toBe("3d");
    // boundary: exactly 0.75 is not > 0.75, so the energy rule doesn't fire.
    // With no genre match it falls to the default ("3d"); with a shader genre
    // the genre rule wins instead.
    expect(selectVizMode("track", undefined, 0.75)).toBe("3d");
    expect(selectVizMode("track", "cyberpunk", 0.75)).toBe("shader");
  });

  it("picks 3d for high BPM (> 140)", () => {
    expect(selectVizMode("track", undefined, undefined, 150)).toBe("3d");
    expect(selectVizMode("track", undefined, undefined, 141)).toBe("3d");
    // boundary: exactly 140 is not > 140, so the BPM rule doesn't fire.
    // With no genre match it falls to the default ("3d"); with a shader genre
    // the genre rule wins instead.
    expect(selectVizMode("track", undefined, undefined, 140)).toBe("3d");
    expect(selectVizMode("track", "cyberpunk", undefined, 140)).toBe("shader");
  });

  it("picks shader for FX-heavy genres", () => {
    for (const genre of [
      "synthwave", "retro", "neon", "outrun", "cyberpunk", "phonk",
      "drift", "trap metal", "trap-metal", "grime",
    ]) {
      expect(selectVizMode("some track", genre)).toBe("shader");
    }
    // case-insensitive
    expect(selectVizMode("track", "CYBERPUNK")).toBe("shader");
    expect(selectVizMode("track", "Synthwave")).toBe("shader");
  });

  it("picks 2d for low energy", () => {
    expect(selectVizMode("track", undefined, 0.3)).toBe("2d");
    expect(selectVizMode("track", undefined, 0.0)).toBe("2d");
    // boundary: exactly 0.4 is not < 0.4, so the energy rule doesn't fire.
    // With no genre match it falls to the default ("3d"); with a chill genre
    // the genre rule wins instead.
    expect(selectVizMode("track", undefined, 0.4)).toBe("3d");
    expect(selectVizMode("track", "ambient", 0.4)).toBe("2d");
  });

  it("picks 2d for low BPM (< 90)", () => {
    expect(selectVizMode("track", undefined, undefined, 80)).toBe("2d");
    expect(selectVizMode("track", undefined, undefined, 60)).toBe("2d");
    // boundary: exactly 90 is not < 90
    expect(selectVizMode("track", undefined, undefined, 90)).toBe("3d");
    expect(selectVizMode("track", "ambient", undefined, 90)).toBe("2d");
  });

  it("picks 2d for chill/ambient genres", () => {
    for (const genre of ["lo fi", "lofi", "chill", "jazz", "ambient"]) {
      expect(selectVizMode("track", genre)).toBe("2d");
    }
    // case-insensitive
    expect(selectVizMode("track", "LOFI")).toBe("2d");
  });

  it("applies priority order when multiple rules match", () => {
    // High energy + chill genre: energy rule wins → 3d
    expect(selectVizMode("chill track", "ambient", 0.9)).toBe("3d");
    // High BPM + chill genre: BPM rule wins → 3d
    expect(selectVizMode("chill track", "ambient", undefined, 150)).toBe("3d");
    // Shader genre + low BPM: genre rule wins (checked before BPM) → shader
    expect(selectVizMode("synthwave track", "synthwave", undefined, 60)).toBe("shader");
  });

  it("matches genre keywords inside track names", () => {
    // genre is undefined, but track name carries the keyword
    expect(selectVizMode("my synthwave jam")).toBe("shader");
    expect(selectVizMode("lofi beats")).toBe("2d");
    expect(selectVizMode("chill hop")).toBe("2d");
  });

  it("returns only valid VizMode values", () => {
    const cases: Array<Parameters<typeof selectVizMode>> = [
      ["track"],
      ["track", "synthwave"],
      ["track", undefined, 0.9],
      ["track", undefined, undefined, 160],
      ["track", "ambient", 0.1],
      ["track", "ambient", undefined, 60],
      ["", undefined, undefined, undefined],
    ];
    for (const [trackName, genre, energy, bpm] of cases) {
      const mode = selectVizMode(trackName, genre, energy, bpm);
      expect(["3d", "shader", "2d"]).toContain(mode);
    }
  });
});
