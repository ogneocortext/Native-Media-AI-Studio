/**
 * Genre reactivity presets (plan 2.3).
 *
 * Bundles of the reactivity triad (sensitivity / attack / release / beat
 * response) + frequency focus + master gain, one per genre family. This is
 * the reactivity-panel counterpart to the kinetic lyric presets
 * (`KineticPresets.ts`): where those pick *how lyrics move* per genre,
 * these pick *how hard the visuals react* per genre.
 *
 * - EDM: fast attack, high beat response — the drop has to land.
 * - Ambient: long release, low beat response — energy should bloom and
 *   decay, not snap. (The plan's "spectral-centroid weighting" has no
 *   processor knob; the long release + low beat response is the
 *   achievable half of that intent.)
 * - Vocal-led: mid emphasis via the HUD's frequency focus, moderate
 *   attack/release so consonants read without pumping.
 * - Phonk / bass: fastest attack, highest beat response, bass focus —
 *   for the drift-phonk catalog this studio is built around.
 *
 * Matching mirrors the kinetic presets: each preset declares the genre
 * keywords it serves, and `matchReactivityGenrePreset` matches a track's
 * analyzer genre list against them (case-insensitive, substring).
 */

import type {
  FrequencyFocus,
  ReactivityTriad,
} from "./audioReactivityProcessor";

export interface ReactivityGenrePreset {
  id: string;
  name: string;
  description: string;
  /** Genre keywords this preset serves (matched case-insensitively). */
  genres: string[];
  triad: ReactivityTriad;
  focus: FrequencyFocus;
  /** Master gain multiplier applied on top of the triad's sensitivity. */
  gain: number;
}

export const REACTIVITY_GENRE_PRESETS: ReactivityGenrePreset[] = [
  {
    id: "edm",
    name: "EDM",
    description: "Fast attack, high beat response — drops land hard",
    genres: ["edm", "house", "techno", "trance", "dubstep", "electronic", "dance", "big room"],
    triad: { sensitivity: 1.2, attack: 0.8, release: 0.12, beatResponse: 2.0 },
    focus: "bass",
    gain: 1.1,
  },
  {
    id: "ambient",
    name: "Ambient",
    description: "Long release, low beat response — energy blooms and decays",
    genres: ["ambient", "chill", "lo-fi", "lofi", "drone", "downtempo", "new age"],
    triad: { sensitivity: 0.85, attack: 0.15, release: 0.45, beatResponse: 0.35 },
    focus: "balanced",
    gain: 0.9,
  },
  {
    id: "vocal",
    name: "Vocal-led",
    description: "Mid emphasis, moderate dynamics — vocals read without pumping",
    genres: ["pop", "vocal", "acoustic", "singer", "songwriter", "indie", "folk"],
    triad: { sensitivity: 1.1, attack: 0.4, release: 0.25, beatResponse: 0.8 },
    focus: "mid",
    gain: 1.0,
  },
  {
    id: "phonk",
    name: "Phonk / Bass",
    description: "Fastest attack, maximum beat response, bass focus",
    genres: ["phonk", "drift", "trap", "bass", "grime", "uk grime", "g-funk", "gfunk"],
    triad: { sensitivity: 1.3, attack: 0.85, release: 0.1, beatResponse: 2.2 },
    focus: "bass",
    gain: 1.15,
  },
];

/**
 * Match a track's analyzer genre list to a reactivity preset.
 *
 * The track's genres are checked in order (the analyzer lists the most
 * relevant first); the first genre that substring-matches any preset's
 * keyword list wins. Returns null when nothing matches — the caller
 * keeps the current triad rather than snapping to a default.
 */
export function matchReactivityGenrePreset(
  genres: string[] | undefined | null,
): ReactivityGenrePreset | null {
  if (!genres) return null;
  for (const raw of genres) {
    const needle = raw.toLowerCase().trim();
    if (!needle) continue;
    for (const preset of REACTIVITY_GENRE_PRESETS) {
      if (
        preset.genres.some(
          (kw) => needle.includes(kw) || kw.includes(needle),
        )
      ) {
        return preset;
      }
    }
  }
  return null;
}
