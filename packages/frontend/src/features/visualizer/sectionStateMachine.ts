import type { ShaderPresetName } from "./shaders";

export type SectionType =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "bridge"
  | "outro"
  | "drop"
  | "breakdown";

export interface SectionPresetMapping {
  preset: ShaderPresetName;
  feedback: boolean;
  feedbackZoom: number;
  feedbackRotation: number;
  feedbackDecay: number;
  trailIntensity: number;
}

const SECTION_PRESET_MAP: Record<SectionType, SectionPresetMapping> = {
  intro: {
    preset: "spectralReactor",
    feedback: true,
    feedbackZoom: 1.005,
    feedbackRotation: 0.002,
    feedbackDecay: 0.96,
    trailIntensity: 0.3,
  },
  verse: {
    preset: "abstractWaves",
    feedback: false,
    feedbackZoom: 1.0,
    feedbackRotation: 0.0,
    feedbackDecay: 0.97,
    trailIntensity: 0.0,
  },
  "pre-chorus": {
    preset: "neonGrid",
    feedback: true,
    feedbackZoom: 1.003,
    feedbackRotation: 0.001,
    feedbackDecay: 0.95,
    trailIntensity: 0.2,
  },
  chorus: {
    preset: "spectralReactor",
    feedback: true,
    feedbackZoom: 1.008,
    feedbackRotation: 0.003,
    feedbackDecay: 0.97,
    trailIntensity: 0.5,
  },
  bridge: {
    preset: "foggyNoir",
    feedback: true,
    feedbackZoom: 1.002,
    feedbackRotation: -0.001,
    feedbackDecay: 0.94,
    trailIntensity: 0.35,
  },
  outro: {
    preset: "westCoastSunset",
    feedback: true,
    feedbackZoom: 1.001,
    feedbackRotation: 0.0,
    feedbackDecay: 0.93,
    trailIntensity: 0.25,
  },
  drop: {
    preset: "spectralReactor",
    feedback: true,
    feedbackZoom: 1.012,
    feedbackRotation: 0.004,
    feedbackDecay: 0.98,
    trailIntensity: 0.6,
  },
  breakdown: {
    preset: "neonRain",
    feedback: true,
    feedbackZoom: 1.004,
    feedbackRotation: 0.002,
    feedbackDecay: 0.95,
    trailIntensity: 0.3,
  },
};

export function getSectionPreset(sectionType: string): SectionPresetMapping {
  const key = sectionType.toLowerCase() as SectionType;
  return SECTION_PRESET_MAP[key] ?? SECTION_PRESET_MAP.verse;
}

export function getAllSectionPresets(): Record<SectionType, SectionPresetMapping> {
  return { ...SECTION_PRESET_MAP };
}
