/**
 * Track Visual Profiles — tuned visualization presets for known tracks.
 *
 * The generic `selectVisualPreset()` (visualPresets.ts) guesses from
 * genre/energy/BPM. That is fine for unknown tracks, but for the studio's
 * own catalog we have measured analyzer data (tempo, key, sub-bass share,
 * spectral centroid, stereo image) plus knowledge of each track's intent.
 * These profiles tune a base preset per track from that evidence instead
 * of the generic guess.
 *
 * Each profile records:
 *  - `genericPick`: what selectVisualPreset() would have chosen, so agents
 *    can see whether the profile confirms or overrides the generic logic;
 *  - `analysis`: the measured snapshot that motivated the tuning (numbers,
 *    not vibes — see `measuredAt`/`notes` for provenance);
 *  - `why`: the reasoning to preserve when extending this file.
 *
 * Matching is longest-fragment-first on spaceless lowercased text, so
 * "patchnotesv35" wins over "patchnotes" and "unproductivevalleyphonk"
 * wins over "unproductive". The backend mirror
 * (`packages/backend/app/services/visual_fallback.py::_TRACK_PRESET_OVERRIDES`)
 * uses the same fragments — keep the two in sync.
 */

import type { VizParams } from "./types";
import type { VisualizationStyle } from "./trackConceptAnalyzer";
import { visualPresets, type VisualPreset } from "./visualPresets";

/** Measured analyzer snapshot behind a profile's tuning. */
export interface TrackAnalysisSnapshot {
  tempoBpm: number;
  tempoDriftBpm: number;
  estimatedKey: string;
  keyConfidenceR: number;
  keyRunnerUp?: string;
  /** Share of total spectral energy in 20–120 Hz. */
  subSharePct: number;
  spectralCentroidHz: number;
  stereoCorrelation: number;
  rmsDbfs: number;
  dynamicRangeDb: number;
  durationS: number;
  /** ISO date the snapshot was measured. */
  measuredAt: string;
  notes?: string;
}

export interface TrackVisualProfile {
  id: string;
  title: string;
  /** Fragments matched longest-first (see module docstring). */
  matchFragments: string[];
  /** Base preset id from visualPresets.ts that this profile tunes. */
  basePresetId: string;
  /** What selectVisualPreset() would pick without this profile. */
  genericPick: string;
  analysis: TrackAnalysisSnapshot;
  /** Overrides merged over the base preset's vizParams (catalog never mutated). */
  vizParamOverrides: Partial<VizParams>;
  bgColor?: string;
  meshColor?: string;
  kineticPreset?: string;
  visualizationStyle?: VisualizationStyle;
  theatreValueOverrides?: Record<string, number>;
  /** Reasoning agents should preserve when extending this file. */
  why: string;
}

export const trackVisualProfiles: Record<string, TrackVisualProfile> = {
  // ============================================================
  // PATCH NOTES (v1) — dark, sub-heavy, narrow; terminal aesthetic
  // ============================================================
  "patch-notes": {
    id: "patch-notes",
    title: "Patch Notes",
    matchFragments: ["patch notes", "patchnotes"],
    basePresetId: "dubstep",
    genericPick: "dubstep",
    analysis: {
      tempoBpm: 152.0,
      tempoDriftBpm: 4.3,
      estimatedKey: "D# minor",
      keyConfidenceR: 0.718,
      keyRunnerUp: "D# major",
      subSharePct: 73.4,
      spectralCentroidHz: 2651,
      stereoCorrelation: 0.904,
      rmsDbfs: -14.7,
      dynamicRangeDb: 19.7,
      durationS: 242.7,
      measuredAt: "2026-09-23",
      notes:
        "Prior session LUFS: -13.6. Dark top end, very sub-heavy, narrow stereo. " +
        "Tempo drifts 4.3 BPM across halves (Suno v6-mini render).",
    },
    vizParamOverrides: {
      // Keep the sub-driven pump (73.4% sub share) but cool the palette:
      // dubstep's default green fights the track's terminal/code aesthetic.
      glowIntensity: 0.85,
      postfx: { bloom: 0.75, vignette: 0.8, glitch: 0.55 },
      fogDensity: 0.055,
    },
    bgColor: "#04060a",
    meshColor: "#00e5ff",
    why:
      "Generic BPM>140 rule already picks dubstep — kept deliberately, not by " +
      "accident. Retuned away from dubstep's default green toward ice-cyan on " +
      "blue-black for the patch-notes terminal aesthetic; bloom lowered " +
      "(0.75) for the dark 2651 Hz-centroid mix so highlights don't blow out; " +
      "scaleBoost left at the base 2.5 because the 73.4% sub share is the " +
      "track's main visual driver.",
  },

  // ============================================================
  // PATCH NOTES v3.5 — brighter, wider, louder revision of v1
  // ============================================================
  "patch-notes-v35": {
    id: "patch-notes-v35",
    title: "Patch Notes v3.5",
    matchFragments: ["patch notes v3.5", "patchnotesv3.5", "patch notes v35", "patch notes 3.5"],
    basePresetId: "dubstep",
    genericPick: "dubstep",
    analysis: {
      tempoBpm: 147.7,
      tempoDriftBpm: 4.3,
      estimatedKey: "B major",
      keyConfidenceR: 0.673,
      keyRunnerUp: "D# minor",
      subSharePct: 66.0,
      spectralCentroidHz: 3108,
      stereoCorrelation: 0.831,
      rmsDbfs: -14.2,
      dynamicRangeDb: 19.8,
      durationS: 186.5,
      measuredAt: "2026-09-23",
      notes:
        "Prior session LUFS: -12.7. Centroid +457 Hz vs v1, stereo 0.904→0.831, " +
        "sub 73.4%→66.0%. Key moved D# minor→B major (D# minor lingers as runner-up). " +
        "Same 4.3 BPM drift as v1 — the tempo wobble survived the revision.",
    },
    vizParamOverrides: {
      // The revision is brighter, wider, louder: let it glow more, warm the
      // palette for the major-key lift, and calm the spin slightly — v3.5 is
      // the polished mix, v1 is the raw one.
      glowIntensity: 1.0,
      lightIntensity: 2.8,
      rotationSpeed: 1.3,
      particleCount: 650,
      postfx: { bloom: 1.0, vignette: 0.7, glitch: 0.5 },
    },
    meshColor: "#ffb300",
    why:
      "Same dubstep base as v1 (generic rule agrees), but the measured deltas " +
      "demand their own tuning: +457 Hz centroid and B major justify the warm " +
      "amber mesh and full glow/bloom; the wider 0.831 stereo image justifies " +
      "more light intensity and particles; rotation calmed 1.5→1.3 because " +
      "this is the refined revision. v1 and v3.5 must not share a profile — " +
      "they are different mixes.",
  },

  // ============================================================
  // UNPRODUCTIVE (V2) — midtempo major-key groove, brightest mix
  // ============================================================
  "unproductive": {
    id: "unproductive",
    title: "Unproductive",
    matchFragments: ["unproductive"],
    basePresetId: "gfunk",
    genericPick: "balanced",
    analysis: {
      tempoBpm: 103.4,
      tempoDriftBpm: 0.0,
      estimatedKey: "D# major",
      keyConfidenceR: 0.836,
      keyRunnerUp: "A# major",
      subSharePct: 45.8,
      spectralCentroidHz: 4042,
      stereoCorrelation: 0.811,
      rmsDbfs: -17.1,
      dynamicRangeDb: 17.9,
      durationS: 180.7,
      measuredAt: "2026-09-23",
      notes:
        "Sequel to Patch Notes but sonically its own thing: locked tempo, " +
        "major key, brightest centroid and widest stereo of the catalog, " +
        "lowest sub share (45.8%).",
    },
    vizParamOverrides: {
      // Smooth midtempo groove, not a neutral track: lift the glow for the
      // bright 4042 Hz centroid and ease the sub pump (only 45.8% sub).
      glowIntensity: 0.65,
      scaleBoost: 1.35,
      rotationSpeed: 0.7,
      colorShift: 1.3,
      lightIntensity: 1.5,
      particleSize: 0.045,
    },
    why:
      "Generic BPM rule lands on balanced — 103.4 BPM sits between the 100 " +
      "and 120 thresholds, so the generic path gives up and picks neutral. " +
      "The measurements say otherwise: locked 103 BPM, D# major, brightest " +
      "mix in the catalog. gfunk's smooth groovy bounce fits a midtempo " +
      "major-key groove; glow lifted for the bright centroid, sub pump " +
      "eased for the low sub share.",
  },

  // ============================================================
  // UNPRODUCTIVE (VALLEY PHONK) EXTENDED V2 — Memphis drift phonk
  // ============================================================
  "unproductive-valley-phonk": {
    id: "unproductive-valley-phonk",
    title: "Unproductive (Valley Phonk) Extended",
    matchFragments: ["unproductive valley phonk", "valley phonk", "unproductive phonk"],
    basePresetId: "phonk",
    genericPick: "phonk",
    analysis: {
      tempoBpm: 126.0,
      tempoDriftBpm: 0.0,
      estimatedKey: "F minor",
      keyConfidenceR: 0.869,
      keyRunnerUp: "C# major",
      subSharePct: 66.1,
      spectralCentroidHz: 2999,
      stereoCorrelation: 0.85,
      rmsDbfs: -14.5,
      dynamicRangeDb: 19.2,
      durationS: 240.0,
      measuredAt: "2026-09-23",
      notes:
        "Memphis drift phonk. Locked 126 BPM, " +
        "confident F minor. Exactly 4:00 — the extended runtime needs visual " +
        "density so the loop doesn't feel static.",
    },
    vizParamOverrides: {
      // Drift, not spin: heavy sway with grit. More particles and haze for
      // the 4-minute runtime; harder sub pump for the 808s.
      rotationSpeed: 2.1,
      scaleBoost: 2.2,
      particleCount: 520,
      fogDensity: 0.05,
      postfx: { bloom: 0.8, vignette: 0.6, glitch: 0.8 },
    },
    theatreValueOverrides: { skewX: -8 },
    why:
      "Generic keyword rule already picks phonk — kept deliberately. Tuned " +
      "for Memphis drift rather than generic aggression: rotation calmed " +
      "2.5→2.1 (drift sways, it doesn't spin), glitch pushed to 0.8 for " +
      "grit, particle density raised for the 4:00 extended runtime, lyric " +
      "skew deepened to -8 for menace. F minor at 126 BPM with 66% sub is " +
      "the profile's anchor — don't retune toward brightness.",
  },

  // ============================================================
  // HUMAN IN THE LOOP V2 — wide, epic, dual-vocal; 4:06 arc
  // ============================================================
  "human-in-the-loop-v2": {
    id: "human-in-the-loop-v2",
    title: "Human in the Loop V2",
    matchFragments: ["human in the loop", "human-in-the-loop", "hitl"],
    basePresetId: "cinematic",
    genericPick: "dubstep",
    analysis: {
      tempoBpm: 143.6,
      tempoDriftBpm: 0.0,
      estimatedKey: "C major",
      keyConfidenceR: 0.711,
      keyRunnerUp: "C minor",
      subSharePct: 67.4,
      spectralCentroidHz: 3280,
      stereoCorrelation: 0.919,
      rmsDbfs: -14.7,
      dynamicRangeDb: 17.3,
      durationS: 246.5,
      measuredAt: "2026-09-23",
      notes:
        "Key is ambiguous: C major r=0.711 with C minor close behind; an " +
        "earlier stem analysis favored C minor. Locked 143.6 BPM, no drift. " +
        "67.4% sub under wide portamento synths (width lives in the stems); " +
        "two voices spanning C2–A5; drums > bass > vocals > other stem balance.",
    },
    vizParamOverrides: {
      // Epic and wide, not aggressive: cinematic base keeps the wide
      // letterSpacing and light rays, with the sub pump restored (67.4%
      // sub still needs to hit) and glow raised for the airy synths.
      scaleBoost: 2.1,
      glowIntensity: 0.8,
      colorShift: 1.25,
      lightIntensity: 1.9,
      particleCount: 420,
      postfx: { bloom: 0.8, vignette: 0.6, glitch: 0 },
    },
    why:
      "Generic BPM>140 rule picks dubstep, but the mix argues otherwise: " +
      "this is a 4:06 wide/epic arc (airy synths, dual vocals, 17.3 dB " +
      "dynamic range), not an aggressive bass track. cinematic base keeps " +
      "the drama and wide type; sub pump restored to 2.1 so the 67.4% sub " +
      "share still drives the visuals; glitch forced to 0 — grit would " +
      "fight the track's open, human feel.",
  },
};

/** Lowercase and strip every non-alphanumeric: "SunoV6Mini-Patch_Notes" → "sunov6minipatchnotes". */
function squashTrackName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Resolve the tuned profile for a track name (clean filename or title).
 * Longest fragment wins, so "patchnotesv35" beats "patchnotes" and
 * "unproductivevalleyphonk" beats "unproductive". Returns null for
 * unknown tracks — callers fall back to selectVisualPreset().
 */
export function resolveTrackVisualProfile(trackName: string): TrackVisualProfile | null {
  const squashed = squashTrackName(trackName);
  if (!squashed) return null;
  const candidates: Array<{ profile: TrackVisualProfile; fragment: string }> = [];
  for (const profile of Object.values(trackVisualProfiles)) {
    for (const raw of profile.matchFragments) {
      const fragment = squashTrackName(raw);
      if (fragment) candidates.push({ profile, fragment });
    }
  }
  candidates.sort((a, b) => b.fragment.length - a.fragment.length);
  for (const c of candidates) {
    if (squashed.includes(c.fragment)) return c.profile;
  }
  return null;
}

/**
 * Build the effective preset for a profile: base preset from the catalog
 * with the profile's overrides merged in. Never mutates `visualPresets`.
 * The returned id is the base preset id so UI lookups against the catalog
 * (e.g. the active-preset badge) keep working.
 */
export function buildTunedPreset(profile: TrackVisualProfile): VisualPreset {
  const base = visualPresets[profile.basePresetId];
  if (!base) throw new Error(`Unknown base preset "${profile.basePresetId}" for track profile "${profile.id}"`);
  return {
    ...base,
    vizParams: { ...base.vizParams, ...profile.vizParamOverrides },
    bgColor: profile.bgColor ?? base.bgColor,
    meshColor: profile.meshColor ?? base.meshColor,
    kineticPreset: profile.kineticPreset ?? base.kineticPreset,
    visualizationStyle: profile.visualizationStyle ?? base.visualizationStyle,
    theatreValues: { ...base.theatreValues, ...profile.theatreValueOverrides },
  };
}
