import { describe, it, expect } from "vitest";
import {
  getPresetById,
  getPresetsByTag,
  createPresetFromCurrent,
  exportPresetToString,
  importPresetFromString,
  getConfigAtTime,
  DEFAULT_VISUAL_PRESET,
  PRESET_LIBRARY,
  VisualPreset,
} from "./visualPreset";

describe("getPresetById", () => {
  it("returns the preset with the given id", () => {
    expect(getPresetById("phonk-drift")?.name).toBe("Phonk Drift");
    expect(getPresetById("synthwave")?.name).toBe("Synthwave");
    expect(getPresetById("default")?.name).toBe("Default Preset");
  });

  it("returns undefined for unknown id", () => {
    expect(getPresetById("nonexistent")).toBeUndefined();
  });
});

describe("getPresetsByTag", () => {
  it("returns presets that have the given tag", () => {
    const phonk = getPresetsByTag("phonk");
    expect(phonk.length).toBeGreaterThan(0);
    expect(phonk.every((p) => p.tags.includes("phonk"))).toBe(true);
  });

  it("returns empty array for unknown tag", () => {
    expect(getPresetsByTag("nonexistent-tag")).toEqual([]);
  });
});

describe("createPresetFromCurrent", () => {
  it("merges overrides into a copy of the base preset", () => {
    const result = createPresetFromCurrent(DEFAULT_VISUAL_PRESET, {
      name: "Custom",
      visualizer: { intensity: 0.5 },
    } as Partial<VisualPreset>);
    expect(result.name).toBe("Custom");
    expect(result.visualizer.intensity).toBe(0.5);
    expect(result.theme).toEqual(DEFAULT_VISUAL_PRESET.theme);
    expect(result.id).toBe(DEFAULT_VISUAL_PRESET.id);
  });

  it("does not mutate the base preset", () => {
    const base = DEFAULT_VISUAL_PRESET;
    createPresetFromCurrent(base, { name: "Mutated" });
    expect(base.name).toBe("Default Preset");
  });
});

describe("exportPresetToString", () => {
  it("serializes a preset to JSON", () => {
    const json = exportPresetToString(DEFAULT_VISUAL_PRESET);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe("default");
    expect(parsed.name).toBe("Default Preset");
  });
});

describe("importPresetFromString", () => {
  it("imports a valid preset", () => {
    const json = exportPresetToString(DEFAULT_VISUAL_PRESET);
    const imported = importPresetFromString(json);
    expect(imported).not.toBeNull();
    expect(imported!.id).toBe("default");
    expect(imported!.name).toBe("Default Preset");
  });

  it("returns null for invalid JSON", () => {
    expect(importPresetFromString("not json")).toBeNull();
    expect(importPresetFromString("")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(importPresetFromString("42")).toBeNull();
    expect(importPresetFromString('"string"')).toBeNull();
    expect(importPresetFromString("true")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    expect(importPresetFromString('{"id": "x"}')).toBeNull();
    expect(importPresetFromString('{"name": "x"}')).toBeNull();
    expect(importPresetFromString('{"id": "x", "name": "y"}')).toBeNull();
  });

  it("returns null when camera.keyframes is missing or empty", () => {
    const invalid = {
      ...DEFAULT_VISUAL_PRESET,
      camera: { ...DEFAULT_VISUAL_PRESET.camera, keyframes: [] },
    };
    expect(importPresetFromString(JSON.stringify(invalid))).toBeNull();
  });

  it("rejects keyframes with missing at/position/target", () => {
    const invalid = {
      ...DEFAULT_VISUAL_PRESET,
      camera: {
        ...DEFAULT_VISUAL_PRESET.camera,
        keyframes: [{ at: 0, position: [0, 0, 0] }] as never,
      },
    };
    expect(importPresetFromString(JSON.stringify(invalid))).toBeNull();
  });

  it("rejects keyframes with non-numeric position values", () => {
    const invalid = {
      ...DEFAULT_VISUAL_PRESET,
      camera: {
        ...DEFAULT_VISUAL_PRESET.camera,
        keyframes: [{ at: 0, position: [0, 0, "bad" as never], target: [0, 0, 0] }],
      },
    };
    expect(importPresetFromString(JSON.stringify(invalid))).toBeNull();
  });
});

describe("getConfigAtTime", () => {
  it("returns first keyframe values before the first keyframe time", () => {
    const config = getConfigAtTime(DEFAULT_VISUAL_PRESET, 0);
    expect(config.camera.position).toEqual([0, 2, 5]);
    expect(config.camera.target).toEqual([0, 0, 0]);
  });

  it("interpolates between keyframes", () => {
    const phonk = PRESET_LIBRARY.find((p) => p.id === "phonk-drift")!;
    const start = getConfigAtTime(phonk, 0);
    expect(start.camera.position).toEqual([0, 1, 4]);
    const end = getConfigAtTime(phonk, 10);
    expect(end.camera.position).toEqual([-2, 1, 4]);
  });

  it("clamps to last keyframe after the last keyframe time", () => {
    const phonk = PRESET_LIBRARY.find((p) => p.id === "phonk-drift")!;
    const late = getConfigAtTime(phonk, 999);
    expect(late.camera.position).toEqual([-2, 1, 4]);
  });

  it("applies section overrides", () => {
    const config = getConfigAtTime(DEFAULT_VISUAL_PRESET, 0, "DROP");
    expect(config.theme.primary).toBeDefined();
    expect(config.visualizer.intensity).toBeDefined();
  });
});
