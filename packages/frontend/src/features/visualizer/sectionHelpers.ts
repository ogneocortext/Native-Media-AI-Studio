/**
 * Shared section configuration for LRC-driven visualizations.
 * These values are used across LrcVizController, KineticLyricOverlay, and other components.
 */

export interface SectionColors {
  base: string;
  glow: string;
  energy: string;
}

/**
 * Get section color for visual effects.
 */
export function getSectionColor(
  section: string,
  defaultColor: string = "#6366f1",
): string {
  const sectionColors: Record<string, string> = {
    INTRO: "#818cf8",
    VERSE: "#60a5fa",
    "PRE-CHORUS": "#c084fc",
    CHORUS: "#f472b6",
    BRIDGE: "#f59e0b",
    BREAKDOWN: "#34d399",
    "BUILD-UP": "#fb923c",
    DROP: "#ef4444",
    "FINAL CHORUS": "#e879f9",
    "FINAL DROP": "#f43f5e",
    OUTRO: "#94a3b8",
  };
  return sectionColors[section] || defaultColor;
}

/**
 * Get enhanced section colors with energy-aware gradients for kinetic typography.
 */
export function getSectionColors(section: string): SectionColors {
  const sectionColors: Record<string, SectionColors> = {
    INTRO: { base: "#818cf8", glow: "#6366f1", energy: "#a5b4fc" },
    VERSE: { base: "#60a5fa", glow: "#3b82f6", energy: "#93c5fd" },
    "PRE-CHORUS": { base: "#c084fc", glow: "#a855f7", energy: "#d8b4fe" },
    CHORUS: { base: "#f472b6", glow: "#ec4899", energy: "#f9a8d4" },
    BRIDGE: { base: "#f59e0b", glow: "#d97706", energy: "#fcd34d" },
    BREAKDOWN: { base: "#34d399", glow: "#10b981", energy: "#6ee7b7" },
    "BUILD-UP": { base: "#fb923c", glow: "#f97316", energy: "#fdba74" },
    DROP: { base: "#ef4444", glow: "#dc2626", energy: "#fca5a5" },
    "FINAL CHORUS": { base: "#e879f9", glow: "#d946ef", energy: "#f0abfc" },
    "FINAL DROP": { base: "#f43f5e", glow: "#e11d48", energy: "#fda4af" },
    OUTRO: { base: "#94a3b8", glow: "#64748b", energy: "#cbd5e1" },
  };
  return sectionColors[section] || sectionColors.VERSE;
}

/**
 * Get section intensity for visual effects.
 * Higher values = more intense animations, brighter colors, stronger reactions.
 */
export function getSectionIntensity(section: string): number {
  const intensityMap: Record<string, number> = {
    INTRO: 0.4,
    VERSE: 0.6,
    "PRE-CHORUS": 0.7,
    CHORUS: 1.0,
    BRIDGE: 0.7,
    BREAKDOWN: 0.5,
    "BUILD-UP": 0.8,
    DROP: 1.5,
    "FINAL CHORUS": 1.3,
    "FINAL DROP": 1.6,
    OUTRO: 0.4,
  };
  return intensityMap[section] ?? 0.6;
}

/**
 * Get section preset for kinetic typography.
 */
export function getSectionPreset(section: string): string {
  const presetMap: Record<string, string> = {
    INTRO: "ambient",
    VERSE: "cinematic",
    "PRE-CHORUS": "synthwave",
    CHORUS: "dubstep",
    BRIDGE: "gfunk",
    BREAKDOWN: "ambient",
    "BUILD-UP": "synthwave",
    DROP: "dubstep",
    "FINAL CHORUS": "phonk",
    "FINAL DROP": "phonk",
    OUTRO: "lofi",
  };
  return presetMap[section] || "cinematic";
}
