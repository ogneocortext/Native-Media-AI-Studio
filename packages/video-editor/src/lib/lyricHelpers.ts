/**
 * Shared lyric-driven visual helpers for StillIRise components.
 *
 * Consolidates LYRIC_KEYWORDS, getVisualMode, and seededRandom which were
 * previously copy-pasted across StillIRise.tsx and StillIRiseV7.tsx.
 */

/** Map of lyric-trigger words to visual modes. */
export const LYRIC_KEYWORDS: Record<string, string[]> = {
  rain: ["rain", "rain."],
  fog: ["fog", "fog,"],
  fire: ["fire", "fire,"],
  match: ["match", "match,"],
  rise: ["rise", "rise.", "rise \u2014"],
  map: ["map", "map,"],
  footprints: ["footprints", "footprints,"],
  river: ["river", "river,"],
  horizon: ["horizon", "horizon,"],
  wind: ["wind", "wind."],
  swim: ["swim", "swim."],
  dawn: ["dawn", "dawn,"],
  cold: ["cold", "cold."],
};

/** Map lyric text to visual mode keywords. */
export function getVisualMode(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const modes: string[] = [];
  for (const [mode, triggers] of Object.entries(LYRIC_KEYWORDS)) {
    if (words.some((w) => triggers.includes(w))) modes.push(mode);
  }
  return modes;
}

/**
 * Seeded pseudo-random for consistent particle positions.
 * Same seed always returns the same value.
 */
export function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}