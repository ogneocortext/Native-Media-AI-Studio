import { describe, it, expect } from "vitest";
import {
  REACTIVITY_GENRE_PRESETS,
  matchReactivityGenrePreset,
} from "./reactivityGenrePresets";

/**
 * Plan 2.3 — genre reactivity presets. These tests pin the preset
 * definitions (triad values inside the HUD sliders' valid ranges, so
 * applying a preset can never push a slider out of bounds) and the
 * genre matcher, so a bad preset or a matcher regression fails here
 * rather than as a track that silently keeps the wrong dynamics.
 */

describe("reactivity genre presets", () => {
  it("defines the plan's three genre families plus phonk/bass", () => {
    const ids = REACTIVITY_GENRE_PRESETS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["edm", "ambient", "vocal", "phonk"]),
    );
  });

  it("keeps every triad inside the HUD slider ranges", () => {
    for (const preset of REACTIVITY_GENRE_PRESETS) {
      const { triad } = preset;
      // HUD ranges: sensitivity 0.2–2.5, attack 0.05–0.95,
      // release 0.01–0.5, beat response 0–2.5.
      expect(triad.sensitivity).toBeGreaterThanOrEqual(0.2);
      expect(triad.sensitivity).toBeLessThanOrEqual(2.5);
      expect(triad.attack).toBeGreaterThanOrEqual(0.05);
      expect(triad.attack).toBeLessThanOrEqual(0.95);
      expect(triad.release).toBeGreaterThanOrEqual(0.01);
      expect(triad.release).toBeLessThanOrEqual(0.5);
      expect(triad.beatResponse).toBeGreaterThanOrEqual(0);
      expect(triad.beatResponse).toBeLessThanOrEqual(2.5);
      expect(preset.gain).toBeGreaterThan(0);
    }
  });

  it("gives EDM fast attack and high beat response, ambient the opposite", () => {
    const edm = REACTIVITY_GENRE_PRESETS.find((p) => p.id === "edm")!;
    const ambient = REACTIVITY_GENRE_PRESETS.find((p) => p.id === "ambient")!;
    expect(edm.triad.attack).toBeGreaterThan(ambient.triad.attack);
    expect(edm.triad.beatResponse).toBeGreaterThan(
      ambient.triad.beatResponse,
    );
    expect(edm.triad.release).toBeLessThan(ambient.triad.release);
  });

  it("gives vocal-led mid focus", () => {
    const vocal = REACTIVITY_GENRE_PRESETS.find((p) => p.id === "vocal")!;
    expect(vocal.focus).toBe("mid");
  });
});

describe("matchReactivityGenrePreset", () => {
  it("matches case-insensitively on genre keywords", () => {
    expect(matchReactivityGenrePreset(["EDM"])?.id).toBe("edm");
    expect(matchReactivityGenrePreset(["Lo-Fi"])?.id).toBe("ambient");
    expect(matchReactivityGenrePreset(["acoustic pop"])?.id).toBe("vocal");
    expect(matchReactivityGenrePreset(["drift phonk"])?.id).toBe("phonk");
  });

  it("prefers the track's first (most relevant) genre", () => {
    // "pop" matches vocal before the later "edm" is considered.
    expect(matchReactivityGenrePreset(["pop", "edm"])?.id).toBe("vocal");
  });

  it("returns null for unknown or empty genre lists", () => {
    expect(matchReactivityGenrePreset(["polka"])?.id ?? null).toBeNull();
    expect(matchReactivityGenrePreset([])).toBeNull();
    expect(matchReactivityGenrePreset(null)).toBeNull();
    expect(matchReactivityGenrePreset(undefined)).toBeNull();
  });
});
