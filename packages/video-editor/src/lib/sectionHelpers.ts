/**
 * Shared section configuration for StillIRise V7.
 * Re-exports the canonical implementation from
 * frontend/src/features/visualizer/sectionHelpers.ts so both packages
 * share one copy.
 */
export * from "../../../frontend/src/features/visualizer/sectionHelpers";

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
