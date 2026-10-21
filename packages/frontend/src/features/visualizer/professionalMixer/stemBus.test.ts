import { describe, it, expect } from "vitest";
import {
  DEFAULT_STEM_ROUTING,
  ROUTABLE_STEMS,
  ROUTING_PRESETS,
  StemRouting,
  describeRouting,
  isDefaultRouting,
} from "./stemBus";

describe("stemBus routing", () => {
  it("DEFAULT_STEM_ROUTING maps each stem to its namesake bus", () => {
    expect(DEFAULT_STEM_ROUTING).toEqual({
      vocals: "vocals",
      drums: "drums",
      bass: "bass",
      other: "other",
    });
  });

  it("ROUTABLE_STEMS lists all four stems", () => {
    expect(ROUTABLE_STEMS).toEqual(["vocals", "drums", "bass", "other"]);
  });

  it("ROUTING_PRESETS includes standard, rhythmSection, threeWay, everythingVocals, everythingDrums", () => {
    expect(Object.keys(ROUTING_PRESETS).sort()).toEqual([
      "everythingDrums",
      "everythingVocals",
      "rhythmSection",
      "standard",
      "threeWay",
    ]);
  });

  it("rhythmSection routes other to drums", () => {
    expect(ROUTING_PRESETS.rhythmSection.other).toBe("drums");
    expect(ROUTING_PRESETS.rhythmSection.drums).toBe("drums");
  });

  it("threeWay routes other to bass", () => {
    expect(ROUTING_PRESETS.threeWay.other).toBe("bass");
  });

  it("everythingVocals routes all stems to vocals", () => {
    expect(ROUTING_PRESETS.everythingVocals).toEqual({
      vocals: "vocals",
      drums: "vocals",
      bass: "vocals",
      other: "vocals",
    });
  });

  it("everythingDrums routes all stems to drums", () => {
    expect(ROUTING_PRESETS.everythingDrums).toEqual({
      vocals: "drums",
      drums: "drums",
      bass: "drums",
      other: "drums",
    });
  });
});

describe("describeRouting", () => {
  it("renders each stem -> bus mapping separated by |", () => {
    const result = describeRouting(DEFAULT_STEM_ROUTING);
    expect(result).toContain("vocals → vocals");
    expect(result).toContain("drums → drums");
    expect(result).toContain("bass → bass");
    expect(result).toContain("other → other");
  });

  it("renders custom routing", () => {
    const routing: StemRouting = { vocals: "vocals", drums: "drums", bass: "drums", other: "drums" };
    const result = describeRouting(routing);
    expect(result).toContain("bass → drums");
    expect(result).toContain("other → drums");
  });
});

describe("isDefaultRouting", () => {
  it("returns true for default routing", () => {
    expect(isDefaultRouting(DEFAULT_STEM_ROUTING)).toBe(true);
  });

  it("returns true for standard preset (same as default)", () => {
    expect(isDefaultRouting(ROUTING_PRESETS.standard)).toBe(true);
  });

  it("returns false when any stem routes differently", () => {
    expect(isDefaultRouting(ROUTING_PRESETS.rhythmSection)).toBe(false);
    expect(isDefaultRouting(ROUTING_PRESETS.threeWay)).toBe(false);
    expect(isDefaultRouting(ROUTING_PRESETS.everythingVocals)).toBe(false);
    expect(isDefaultRouting(ROUTING_PRESETS.everythingDrums)).toBe(false);
  });

  it("returns false for partial routing missing a stem", () => {
    expect(isDefaultRouting({ vocals: "vocals" } as never)).toBe(false);
  });
});
