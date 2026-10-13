import { describe, it, expect } from "vitest";
import {
  getSectionPreset,
  getAllSectionPresets,
  type SectionType,
} from "./sectionStateMachine";

/**
 * Section → shader-preset wiring. This mapping drives which visual preset,
 * feedback trail and zoom the visualizer picks for each song section. It fails
 * silently: an unknown section quietly falls back to "verse", and a wrong
 * feedbackDecay/trailIntensity just looks like a less lively chorus rather than
 * an error — so the section keys, the case-insensitive lookup, the fallback,
 * and the defensive copy in getAllSectionPresets are all pinned here.
 */

const ALL_SECTIONS: SectionType[] = [
  "intro",
  "verse",
  "pre-chorus",
  "chorus",
  "bridge",
  "outro",
  "drop",
  "breakdown",
];

describe("getSectionPreset", () => {
  it("returns the mapped preset for every known section", () => {
    expect(getSectionPreset("intro").preset).toBe("spectralReactor");
    expect(getSectionPreset("verse").preset).toBe("abstractWaves");
    expect(getSectionPreset("pre-chorus").preset).toBe("neonGrid");
    expect(getSectionPreset("chorus").preset).toBe("spectralReactor");
    expect(getSectionPreset("bridge").preset).toBe("foggyNoir");
    expect(getSectionPreset("outro").preset).toBe("westCoastSunset");
    expect(getSectionPreset("drop").preset).toBe("spectralReactor");
    expect(getSectionPreset("breakdown").preset).toBe("neonRain");
  });

  it("is case-insensitive", () => {
    expect(getSectionPreset("CHORUS")).toEqual(getSectionPreset("chorus"));
    expect(getSectionPreset("Pre-Chorus")).toEqual(getSectionPreset("pre-chorus"));
    expect(getSectionPreset("BRIDGE").preset).toBe("foggyNoir");
  });

  it("falls back to the verse preset for an unknown section", () => {
    // The silent-failure path: an unmapped section must land on verse, not on
    // undefined. A regression here would crash the visualizer on a new label.
    const fallback = getSectionPreset("drop-thing-from-the-future");
    expect(fallback).toEqual(getSectionPreset("verse"));
    expect(fallback.preset).toBe("abstractWaves");
    expect(getSectionPreset("").preset).toBe("abstractWaves");
  });

  it("builds energy across sections (drop/chorus hotter than intro/verse)", () => {
    expect(getSectionPreset("drop").feedbackZoom).toBeGreaterThan(
      getSectionPreset("chorus").feedbackZoom,
    );
    expect(getSectionPreset("chorus").feedbackZoom).toBeGreaterThan(
      getSectionPreset("intro").feedbackZoom,
    );
    expect(getSectionPreset("drop").trailIntensity).toBeGreaterThan(
      getSectionPreset("verse").trailIntensity,
    );
  });

  it("leaves verse as the only section without a feedback trail", () => {
    for (const section of ALL_SECTIONS) {
      const expectFeedback = section !== "verse";
      expect(getSectionPreset(section).feedback, section).toBe(expectFeedback);
    }
  });
});

describe("getAllSectionPresets", () => {
  it("exposes a mapping for every section type", () => {
    const all = getAllSectionPresets();
    for (const section of ALL_SECTIONS) {
      expect(all[section]).toBeDefined();
      expect(all[section].preset).toBeTruthy();
    }
    expect(Object.keys(all).sort()).toEqual([...ALL_SECTIONS].sort());
  });

  it("returns a fresh top-level map each call", () => {
    // The spread copies the top-level keys, so reassigning a section on the
    // returned object does not touch the module's source map. The value objects
    // themselves are shared (read-only) references -- the same objects
    // getSectionPreset hands out -- so they are not deep-cloned. Overriding a
    // top-level key is the supported way to derive a variant.
    const all = getAllSectionPresets();
    const original = all.chorus;
    all.chorus = { ...original, preset: "neonRain", trailIntensity: 999 };
    const fresh = getAllSectionPresets();
    expect(fresh.chorus.preset).toBe("spectralReactor");
    expect(fresh.chorus.trailIntensity).toBe(0.5);
    // getSectionPreset returns the same live reference the map holds.
    expect(getSectionPreset("chorus")).toBe(original);
  });
});
