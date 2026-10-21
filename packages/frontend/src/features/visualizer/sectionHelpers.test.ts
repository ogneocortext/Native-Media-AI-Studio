import { describe, it, expect } from "vitest";
import {
  getSectionColor,
  getSectionColors,
  getSectionIntensity,
  getSectionPreset,
} from "./sectionHelpers";

describe("getSectionColor", () => {
  it("returns known color for each section", () => {
    expect(getSectionColor("INTRO")).toBe("#818cf8");
    expect(getSectionColor("VERSE")).toBe("#60a5fa");
    expect(getSectionColor("PRE-CHORUS")).toBe("#c084fc");
    expect(getSectionColor("CHORUS")).toBe("#f472b6");
    expect(getSectionColor("BRIDGE")).toBe("#f59e0b");
    expect(getSectionColor("BREAKDOWN")).toBe("#34d399");
    expect(getSectionColor("BUILD-UP")).toBe("#fb923c");
    expect(getSectionColor("DROP")).toBe("#ef4444");
    expect(getSectionColor("FINAL CHORUS")).toBe("#e879f9");
    expect(getSectionColor("FINAL DROP")).toBe("#f43f5e");
    expect(getSectionColor("OUTRO")).toBe("#94a3b8");
  });

  it("returns default color for unknown section", () => {
    expect(getSectionColor("UNKNOWN")).toBe("#6366f1");
    expect(getSectionColor("UNKNOWN", "#ff0000")).toBe("#ff0000");
  });
});

describe("getSectionColors", () => {
  it("returns SectionColors for each section", () => {
    const chorus = getSectionColors("CHORUS");
    expect(chorus.base).toBe("#f472b6");
    expect(chorus.glow).toBe("#ec4899");
    expect(chorus.energy).toBe("#f9a8d4");

    const drop = getSectionColors("DROP");
    expect(drop.base).toBe("#ef4444");
    expect(drop.glow).toBe("#dc2626");
    expect(drop.energy).toBe("#fca5a5");
  });

  it("falls back to VERSE colors for unknown section", () => {
    expect(getSectionColors("UNKNOWN")).toEqual(getSectionColors("VERSE"));
  });
});

describe("getSectionIntensity", () => {
  it("returns known intensity for each section", () => {
    expect(getSectionIntensity("INTRO")).toBe(0.4);
    expect(getSectionIntensity("VERSE")).toBe(0.6);
    expect(getSectionIntensity("PRE-CHORUS")).toBe(0.7);
    expect(getSectionIntensity("CHORUS")).toBe(1.0);
    expect(getSectionIntensity("DROP")).toBe(1.5);
    expect(getSectionIntensity("FINAL DROP")).toBe(1.6);
    expect(getSectionIntensity("OUTRO")).toBe(0.4);
  });

  it("returns default 0.6 for unknown section", () => {
    expect(getSectionIntensity("UNKNOWN")).toBe(0.6);
  });
});

describe("getSectionPreset", () => {
  it("returns known preset for each section", () => {
    expect(getSectionPreset("INTRO")).toBe("ambient");
    expect(getSectionPreset("VERSE")).toBe("cinematic");
    expect(getSectionPreset("PRE-CHORUS")).toBe("synthwave");
    expect(getSectionPreset("CHORUS")).toBe("dubstep");
    expect(getSectionPreset("BRIDGE")).toBe("gfunk");
    expect(getSectionPreset("BREAKDOWN")).toBe("ambient");
    expect(getSectionPreset("BUILD-UP")).toBe("synthwave");
    expect(getSectionPreset("DROP")).toBe("dubstep");
    expect(getSectionPreset("FINAL CHORUS")).toBe("phonk");
    expect(getSectionPreset("FINAL DROP")).toBe("phonk");
    expect(getSectionPreset("OUTRO")).toBe("lofi");
  });

  it("returns default 'cinematic' for unknown section", () => {
    expect(getSectionPreset("UNKNOWN")).toBe("cinematic");
  });
});
