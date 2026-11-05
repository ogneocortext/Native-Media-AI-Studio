import { describe, expect, it } from "vitest";
import {
  buildWizardSlots,
  safeVocalsStartBar,
  wizardDurationSec,
  wizardName,
  wizardSummary,
  type WizardInput,
} from "./remixWizard";
import type { EditableLayer } from "./remixRecipe";

const STEMS: EditableLayer["stem"][] = ["vocals", "drums", "bass", "other"];

function input(overrides: Partial<WizardInput> = {}): WizardInput {
  return {
    songA: "SunoV6Mini-Ad-Nauseam",
    songB: "SunoV6Mini-Human-in-the-Loop-V2",
    goal: "swap",
    barsPerSlot: 4,
    slotCount: 2,
    bpm: 143.555,
    stemsA: STEMS,
    stemsB: STEMS,
    firstAudibleB: null,
    ...overrides,
  };
}

describe("safeVocalsStartBar", () => {
  // 143.555 BPM -> 4 beats = 1.672 s per bar, so a 4-bar block is 6.687 s
  // (measured this session: a 4-bar render of Ad Nauseam ran 6.687 s).
  const barSeconds = (4 * 60) / 143.555;

  it("leaves a vocals layer alone when the source opens with sound", () => {
    expect(safeVocalsStartBar(0.0, barSeconds)).toBe(0);
    expect(safeVocalsStartBar(1.0, barSeconds)).toBe(0);
    expect(safeVocalsStartBar(null, barSeconds)).toBe(0);
  });

  it("skips a silent intro to the next 4-bar boundary", () => {
    // The measured trap: Ad Nauseam's vocals are digital silence for 7.06 s,
    // which is already past the first 4-bar block (6.687 s) - so bar 4 would
    // still open on silence and the entry has to be bar 8.
    expect(safeVocalsStartBar(7.06, barSeconds)).toBe(8);
    // 20 s of silence lands past 16 bars -> the next boundary.
    expect(safeVocalsStartBar(20.0, barSeconds)).toBe(12);
  });
});

describe("wizardDurationSec", () => {
  it("counts every slot", () => {
    const two = input({ slotCount: 2, barsPerSlot: 4, bpm: 120 });
    expect(wizardDurationSec(two)).toBeCloseTo(16, 5); // 8 bars * 2 s
    expect(wizardDurationSec({ ...two, slotCount: 4 })).toBeCloseTo(32, 5);
    expect(wizardDurationSec({ ...two, barsPerSlot: 8 })).toBeCloseTo(32, 5);
  });
});

describe("buildWizardSlots", () => {
  it("builds the swap structure the presets build", () => {
    const slots = buildWizardSlots(input());

    expect(slots).toHaveLength(2);
    expect(slots[0].bars).toBe(4);
    // Backing only in slot 1, vocals arriving in slot 2.
    expect(slots[0].layers.map((l) => l.stem)).toEqual(["drums", "bass"]);
    expect(slots[1].layers.map((l) => l.stem)).toEqual(["drums", "bass", "vocals"]);
    expect(slots[1].layers[2].track).toBe("SunoV6Mini-Human-in-the-Loop-V2");
  });

  it("offsets vocals past a silent intro rather than rendering silence", () => {
    const slots = buildWizardSlots(input({ firstAudibleB: 7.06 }));

    // 7.06 s is past the first 4-bar block at 143.555 BPM, so the entry is
    // bar 8 - bar 4 would still render silence.
    expect(slots[1].layers[2].source_start_bar).toBe(8);
  });

  it("blends both songs into one slot, without B's vocals fighting A's", () => {
    const slots = buildWizardSlots(input({ goal: "blend" }));

    expect(slots).toHaveLength(2);
    expect(slots[0].layers.map((l) => l.stem)).toEqual(["vocals", "drums", "bass", "other", "drums", "bass", "other"]);
    expect(slots[0].layers.filter((l) => l.stem === "vocals")).toHaveLength(1);
  });

  it("opens the intro goal instrumental and brings vocals in on slot 2", () => {
    const slots = buildWizardSlots(input({ goal: "intro" }));

    expect(slots[0].layers.map((l) => l.stem)).toEqual(["drums", "bass", "other"]);
    expect(slots[1].layers.map((l) => l.stem)).toEqual(["vocals", "drums", "bass", "other", "vocals"]);
  });

  it("repeats the structure for a longer arrangement", () => {
    const slots = buildWizardSlots(input({ slotCount: 4 }));

    // Slot 1 is backing only; once the vocals arrive they stay, so the rest
    // of the arrangement carries them.
    expect(slots).toHaveLength(4);
    expect(slots.map((s) => s.layers.length)).toEqual([2, 3, 3, 3]);
  });

  it("omits a stem the source does not have, rather than sending it to a render", () => {
    const slots = buildWizardSlots(
      input({
        goal: "intro",
        stemsA: ["drums", "bass"],
        stemsB: ["drums", "other"],
      }),
    );

    expect(slots[0].layers.map((l) => l.stem)).toEqual(["drums", "bass"]);
    // No vocals anywhere: B has none, so nothing references them.
    expect(slots.flatMap((s) => s.layers).some((l) => l.stem === "vocals")).toBe(false);
  });

  it("builds a single-song arrangement when there is no second song", () => {
    const slots = buildWizardSlots(input({ songB: null, goal: "swap" }));

    expect(slots).toHaveLength(2);
    expect(slots.flatMap((s) => s.layers).every((l) => l.track === "SunoV6Mini-Ad-Nauseam")).toBe(true);
  });
});

describe("wizardName", () => {
  it("names the arrangement after both songs", () => {
    // The last two hyphen-separated parts of each song name: enough to tell
    // them apart without a 60-character directory name.
    expect(wizardName("SunoV6Mini-Ad-Nauseam", "SunoV6Mini-Human-in-the-Loop-V2")).toBe(
      "mashup-ad-nauseam-loop-v2",
    );
  });

  it("works with one song", () => {
    expect(wizardName("SunoV6Mini-Ad-Nauseam", null)).toBe("mashup-ad-nauseam");
  });
});

describe("wizardSummary", () => {
  it("reports the decisions in the order they were made", () => {
    const lines = wizardSummary(input({ goal: "intro", slotCount: 4, barsPerSlot: 8 }));

    expect(lines.map((l) => l.label)).toEqual(["Song A", "Song B", "Shape", "Length", "Runs for"]);
    expect(lines[4].value).toContain("at 143.555 BPM");
  });
});
