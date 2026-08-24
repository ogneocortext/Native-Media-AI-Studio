type ModuleId = "audio" | "palette" | "typography" | "bento" | "texture" | "blender" | "motion" | "storyboard" | "preview";

interface ModuleState {
  id: ModuleId;
  enabled: boolean;
  variant: string;
}

type SongId = "still-i-rise" | "take-the-crown";

export const SONGS: Record<
  SongId,
  { label: string; badge: string; analysis: string; docFiles: string[] }
> = {
  "still-i-rise": {
    label: "Still I Rise",
    badge: "234.12s \u2022 99.4 BPM \u2022 Bb Maj",
    analysis: "/docs/still-i-rise-analysis.json",
    docFiles: [
      "VISUAL_STORYTELLING_2026.md",
      "STORYBOARD_StillIRise.md",
      "MINDFUL_LAYERING_2026.md",
      "STORYBOARD_StillIRise.json",
      "still-i-rise-analysis.json",
      "still-i-rise-whisper.json",
    ],
  },
  "take-the-crown": {
    label: "Take the Crown",
    badge: "124.0s \u2022 152 BPM \u2022 E Maj",
    analysis: "/docs/take-the-crown-analysis.json",
    docFiles: [
      "VISUAL_STORYTELLING_2026.md",
      "STORYBOARD_TakeTheCrown.md",
      "take-the-crown-analysis.json",
      "take-the-crown-whisper.json",
      "STORYBOARD_StillIRise.md",
      "MINDFUL_LAYERING_2026.md",
    ],
  },
};

export const defaultModules: ModuleState[] = [
  { id: "audio", enabled: true, variant: "99.4 detected" },
  { id: "palette", enabled: true, variant: "nocturnal" },
  { id: "typography", enabled: true, variant: "kinetic" },
  { id: "bento", enabled: true, variant: "2-card" },
  { id: "texture", enabled: true, variant: "subtle" },
  { id: "blender", enabled: true, variant: "v4 PBR" },
  { id: "motion", enabled: true, variant: "restrained" },
  { id: "storyboard", enabled: true, variant: "10 seq" },
  { id: "preview", enabled: true, variant: "5s+10s" },
];

export const paletteVariants: Record<string, { name: string; swatches: string[]; desc: string }> = {
  nocturnal: {
    name: "Nocturnal Future-Garage",
    swatches: ["#0a0f1e", "#1e3a5f", "#a8d8ff", "#8a5a2b"],
    desc: "Intro 220\u00b0 \u2192 Verse 198\u00b0 \u2192 Chorus warm amber 28\u00b0\u2192220\u00b0 slow drift",
  },
  violet: {
    name: "Violet Maximalist",
    swatches: ["#070a13", "#3a1f6b", "#8b5cff", "#ff8a2b"],
    desc: "Chorus 258\u00b0 saturated violet, high energy",
  },
  mono: {
    name: "Mono Slate",
    swatches: ["#070a13", "#2a3448", "#8aa8ba", "#e6eef6"],
    desc: "Desat slate #3a4558, low contrast",
  },
};

export const typographyVariants: Record<string, { name: string; desc: string }> = {
  kinetic: {
    name: "Kinetic Per-Word",
    desc: "19px Space Grotesk stagger 0.16s, chorus 88px split bounce sin(t*3.2)",
  },
  editorial: { name: "Editorial Glass", desc: "19-22px static glass, 2-line max, no bounce" },
  hero: { name: "Hero Always-On", desc: "88px STILL I RISE every frame \u2014 amateur trap" },
};

export type { ModuleId, ModuleState, SongId };
