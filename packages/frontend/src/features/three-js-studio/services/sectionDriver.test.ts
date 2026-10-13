import { describe, expect, it } from "vitest";
import {
  CUT_ALIGNMENT_SEC,
  DEFAULT_SECTION_PROFILE,
  SECTION_MOTION_MAP,
  SECTION_WIPE_SEC,
  createSectionDriverState,
  profileForSection,
  resolveBoundaryTransition,
  sectionIndexAt,
  stepSectionDriver,
  type AnalysisSection,
} from "./sectionDriver";

const SECTIONS: AnalysisSection[] = [
  { type: "intro", start: 0, end: 8, energy: 0.3 },
  { type: "verse", start: 8, end: 24, energy: 0.45 },
  { type: "pre-chorus", start: 24, end: 32, energy: 0.6 },
  { type: "chorus", start: 32, end: 56, energy: 0.9 },
  { type: "outro", start: 56, end: 70, energy: 0.35 },
];

// A 120 BPM grid (beat every 0.5 s) with a downbeat every 2 s.
const BEATS: number[] = [];
for (let t = 0; t <= 70; t += 0.5) BEATS.push(Number(t.toFixed(3)));

describe("sectionIndexAt", () => {
  it("finds the section containing the time", () => {
    expect(sectionIndexAt(SECTIONS, 0)).toBe(0);
    expect(sectionIndexAt(SECTIONS, 4)).toBe(0);
    expect(sectionIndexAt(SECTIONS, 8.5)).toBe(1); // verse
    expect(sectionIndexAt(SECTIONS, 40)).toBe(3); // chorus
    expect(sectionIndexAt(SECTIONS, 70)).toBe(4); // outro
  });

  it("gives a shared boundary instant to the earlier section", () => {
    // intro is [0,8] and verse is [8,24]: at exactly 8 s the earlier
    // section still owns the instant, so a boundary frame happens at
    // 8+ε, not at 8 exactly. First match wins.
    expect(sectionIndexAt(SECTIONS, 8)).toBe(0);
    expect(sectionIndexAt(SECTIONS, 8.0001)).toBe(1);
  });

  it("holds the last section past its end — the outro is still the outro at the track's tail", () => {
    expect(sectionIndexAt(SECTIONS, 80)).toBe(4);
  });

  it("returns -1 before the first section and with no sections", () => {
    const lateStart: AnalysisSection[] = [
      { type: "intro", start: 5, end: 15, energy: 0.3 },
      { type: "verse", start: 15, end: 30, energy: 0.4 },
    ];
    expect(sectionIndexAt(lateStart, 1)).toBe(-1);
    expect(sectionIndexAt([], 10)).toBe(-1);
  });

  it("holds the previous section across a gap between sections", () => {
    const gapped: AnalysisSection[] = [
      { type: "verse", start: 0, end: 10, energy: 0.5 },
      { type: "chorus", start: 20, end: 30, energy: 0.9 },
    ];
    expect(sectionIndexAt(gapped, 15)).toBe(0);
    expect(sectionIndexAt(gapped, 25)).toBe(1);
  });

  it("returns -1 for a non-finite playhead", () => {
    expect(sectionIndexAt(SECTIONS, NaN)).toBe(-1);
  });
});

describe("profileForSection", () => {
  it("maps the §3 table's section types", () => {
    expect(profileForSection("intro").cameraMode).toBe("dolly");
    expect(profileForSection("verse").cameraMode).toBe("static");
    expect(profileForSection("pre-chorus").cameraMode).toBe("dolly");
    expect(profileForSection("chorus").cameraMode).toBe("handheld");
    expect(profileForSection("bridge").cameraMode).toBe("orbit");
    expect(profileForSection("outro").cameraMode).toBe("dolly");
  });

  it("scales intensity with the energy column (peak > low)", () => {
    const chorus = profileForSection("chorus");
    const verse = profileForSection("verse");
    expect(chorus.beatPunchScale).toBeGreaterThan(verse.beatPunchScale);
    expect(chorus.particleScale).toBeGreaterThan(verse.particleScale);
    // Every mapped profile keeps punch/particles positive.
    for (const p of Object.values(SECTION_MOTION_MAP)) {
      expect(p.beatPunchScale).toBeGreaterThan(0);
      expect(p.particleScale).toBeGreaterThan(0);
      expect(Number.isFinite(p.paletteShift)).toBe(true);
    }
  });

  it("falls back to the neutral profile for unknown types", () => {
    expect(profileForSection("breakdown")).toBe(DEFAULT_SECTION_PROFILE);
    expect(DEFAULT_SECTION_PROFILE.beatPunchScale).toBe(1);
    expect(DEFAULT_SECTION_PROFILE.particleScale).toBe(1);
  });
});

describe("resolveBoundaryTransition — cut on snare, else wipe", () => {
  it("cuts when the boundary lands on a beat", () => {
    expect(resolveBoundaryTransition(32, BEATS)).toBe("cut");
    expect(resolveBoundaryTransition(33, BEATS)).toBe("cut"); // within tolerance
  });

  it("wipes when the boundary misses the beat grid", () => {
    expect(resolveBoundaryTransition(32.25, BEATS)).toBe("wipe");
  });

  it("wipes without beat data — a wrong cut is a pop, a wrong wipe only slower", () => {
    expect(resolveBoundaryTransition(32, [])).toBe("wipe");
  });

  it("uses the documented 0.06 s alignment window", () => {
    // Just inside the window cuts; just outside wipes. (Tested off the
    // exact edge: 32 + 0.06 is 0.0600000000000023 in float, and a
    // knife-edge assertion would pin the rounding, not the rule.)
    expect(resolveBoundaryTransition(32.05, BEATS)).toBe("cut");
    expect(resolveBoundaryTransition(32.065, BEATS)).toBe("wipe");
    expect(SECTION_WIPE_SEC).toBe(0.9);
    expect(CUT_ALIGNMENT_SEC).toBe(0.06);
  });
});

describe("stepSectionDriver", () => {
  it("fires a cut on the first frame when the section start is on-grid", () => {
    const state = createSectionDriverState();
    // Playhead at 1 s is inside intro; the boundary *instant* is the
    // section's start (0 s), which is a beat → cut.
    const step = stepSectionDriver(state, SECTIONS, 1, BEATS);
    expect(step.index).toBe(0);
    expect(step.boundary).toBe("cut");
    expect(state.lastIndex).toBe(0);
  });

  it("is silent while the playhead stays inside a section", () => {
    const state = createSectionDriverState();
    stepSectionDriver(state, SECTIONS, 1, BEATS);
    expect(stepSectionDriver(state, SECTIONS, 5, BEATS).boundary).toBeNull();
    // Verse starts at 8 s, on the 0.5 s beat grid → cut on entry.
    const verse = stepSectionDriver(state, SECTIONS, 8.5, BEATS);
    expect(verse.index).toBe(1);
    expect(verse.boundary).toBe("cut");
  });

  it("cuts at a beat-aligned boundary and wipes at an off-grid one", () => {
    const state = createSectionDriverState();
    stepSectionDriver(state, SECTIONS, 4, BEATS); // intro
    // Chorus starts at 32 s, on the grid → cut, with the peak profile.
    const onGrid = stepSectionDriver(state, SECTIONS, 32.5, BEATS);
    expect(onGrid.index).toBe(3);
    expect(onGrid.boundary).toBe("cut");
    expect(onGrid.profile.cameraMode).toBe("handheld");
    expect(onGrid.profile.beatPunchScale).toBeGreaterThan(1);

    // Same track, chorus shifted 0.25 s off the grid → wipe.
    const state2 = createSectionDriverState();
    stepSectionDriver(state2, SECTIONS, 4, BEATS);
    const shifted: AnalysisSection[] = SECTIONS.map((s) =>
      s.type === "chorus" ? { ...s, start: 32.25, end: 56 } : s,
    );
    const offGrid = stepSectionDriver(state2, shifted, 32.3, BEATS);
    expect(offGrid.index).toBe(3);
    expect(offGrid.boundary).toBe("wipe");
  });

  it("resets before the first section, so entry re-fires", () => {
    const lateStart: AnalysisSection[] = [
      { type: "intro", start: 5, end: 15, energy: 0.3 },
      { type: "verse", start: 15, end: 30, energy: 0.4 },
    ];
    const state = createSectionDriverState();
    const before = stepSectionDriver(state, lateStart, 1, BEATS);
    expect(before.index).toBe(-1);
    expect(before.boundary).toBeNull();
    expect(before.profile).toBe(DEFAULT_SECTION_PROFILE);

    const entry = stepSectionDriver(state, lateStart, 6, BEATS);
    expect(entry.index).toBe(0);
    expect(entry.boundary).not.toBeNull();

    // Seeking back before the first section resets, so a later seek
    // forward fires again instead of being swallowed.
    expect(stepSectionDriver(state, lateStart, 1, BEATS).index).toBe(-1);
    expect(state.lastIndex).toBe(-1);
    expect(stepSectionDriver(state, lateStart, 6, BEATS).boundary).not.toBeNull();
  });

  it("is inert with no sections", () => {
    const state = createSectionDriverState();
    const step = stepSectionDriver(state, [], 10, BEATS);
    expect(step.index).toBe(-1);
    expect(step.boundary).toBeNull();
    expect(step.profile).toBe(DEFAULT_SECTION_PROFILE);
  });

  it("survives a NaN playhead without sticking a profile", () => {
    const state = createSectionDriverState();
    stepSectionDriver(state, SECTIONS, 4, BEATS);
    const nan = stepSectionDriver(state, SECTIONS, NaN, BEATS);
    expect(nan.index).toBe(-1);
    expect(state.lastIndex).toBe(-1);
  });
});
