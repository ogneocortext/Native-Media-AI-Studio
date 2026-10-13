/**
 * Section-aware motion driver (three-js-studio plan F2).
 *
 * The studio's motion was reactive but unphrased: sections detected by
 * the track analysis (`useTrackMetadata`) were used only as AI prompt
 * context, never at runtime. This module turns a section boundary into
 * a motion decision — camera mode, `beatPunch` scale, particle
 * intensity, palette/light shift — following the section→motion map in
 * [[three-js-render-motion-2026]] §3.
 *
 * Boundary behavior honours `sceneGuidelines.ts`' transitions rule:
 * **cut hard on snare/downbeat, or a 0.9 s ease-out wipe — never a
 * slow crossfade.** A boundary that lands within `CUT_ALIGNMENT_SEC`
 * of a beat time is a snare/downbeat hit and cuts; anything else wipes
 * over `SECTION_WIPE_SEC` on the `settle-soft` (deep ease-out) anchor.
 *
 * Pure and allocation-free per frame: `stepSectionDriver` returns one
 * small object only on a boundary frame and reuses the map's profile
 * objects otherwise, so the render loop's hot path stays clean (same
 * rule as `easing.ts`/`cameraTransitions.ts`).
 */

import type { CameraMode } from "../types";

/** One section row from the analysis (`AudioAnalysisResult["sections"]`). */
export interface AnalysisSection {
  type: string;
  start: number;
  end: number;
  energy: number;
}

/** The motion profile a section asks for. */
export interface SectionMotionProfile {
  /** Camera mode the section drives (overrides the template's mode
   *  while the section is active; the template's mode remains the
   *  default profile and the between-sections fallback). */
  cameraMode: CameraMode;
  /** Multiplier on the template's `sceneConfig.beatPunch`. */
  beatPunchScale: number;
  /** Multiplier on particle speed/intensity. */
  particleScale: number;
  /** Hue rotation in degrees applied to scene lights on entry —
   *  the palette/light shift half of the §3 map. */
  paletteShift: number;
}

/** Wipe duration at a non-aligned boundary (`sceneGuidelines.ts`). */
export const SECTION_WIPE_SEC = 0.9;
/** A boundary within this distance of a beat time cuts (snare/downbeat). */
export const CUT_ALIGNMENT_SEC = 0.06;

/**
 * Section → motion map (starter), from
 * [[three-js-render-motion-2026]] §3's table. The camera column is
 * verbatim from the research; the object/energy columns are encoded as
 * the three scalars the render loop already has knobs for
 * (`beatPunch`, particle speed, light hue). Energy "rising/tensing/
 * peak/shift/releasing" maps to punch+particle intensity; "low,
 * breathing" pulls both back.
 */
export const SECTION_MOTION_MAP: Record<string, SectionMotionProfile> = {
  // Slow dolly in, fade/build, rising energy.
  intro: { cameraMode: "dolly", beatPunchScale: 0.7, particleScale: 0.8, paletteShift: -10 },
  // Static or slow orbit, settle-soft, minimal, low breathing.
  verse: { cameraMode: "static", beatPunchScale: 0.85, particleScale: 0.7, paletteShift: -5 },
  // Dolly in medium, anticipation, tensing.
  "pre-chorus": { cameraMode: "dolly", beatPunchScale: 1.1, particleScale: 1.2, paletteShift: 0 },
  // Orbit/handheld faster, expressive-pop then hold, peak.
  chorus: { cameraMode: "handheld", beatPunchScale: 1.3, particleScale: 1.5, paletteShift: 15 },
  // Orbit medium, new color/material state, contrast shift.
  bridge: { cameraMode: "orbit", beatPunchScale: 1.0, particleScale: 1.1, paletteShift: 30 },
  // Dolly out, exit-accelerate into stillness, releasing.
  outro: { cameraMode: "dolly", beatPunchScale: 0.6, particleScale: 0.6, paletteShift: -15 },
  // Not in the §3 table; the analysis emits `drop` for high-energy
  // boundaries — treat it as the peak, harder than chorus.
  drop: { cameraMode: "handheld", beatPunchScale: 1.4, particleScale: 1.6, paletteShift: 20 },
};

/** Between-sections / no-metadata fallback: neutral scales, orbit. */
export const DEFAULT_SECTION_PROFILE: SectionMotionProfile = {
  cameraMode: "orbit",
  beatPunchScale: 1,
  particleScale: 1,
  paletteShift: 0,
};

/** Profile for a section type; unknown types get the neutral default. */
export function profileForSection(type: string): SectionMotionProfile {
  return SECTION_MOTION_MAP[type] ?? DEFAULT_SECTION_PROFILE;
}

/**
 * Index of the section containing `timeSec`, or -1.
 *
 * Gaps between sections fall back to the previous section so motion
 * stays phrased across an analysis gap; before the first section (or
 * with no sections at all) there is nothing to drive, hence -1.
 */
export function sectionIndexAt(sections: AnalysisSection[], timeSec: number): number {
  if (!sections.length || !Number.isFinite(timeSec)) return -1;
  let last: number | null = null;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (timeSec < s.start) break;
    if (timeSec <= s.end) return i;
    last = i;
  }
  return last ?? -1;
}

/**
 * Cut or wipe at a boundary landing on `boundaryTimeSec`.
 *
 * Beat times within `CUT_ALIGNMENT_SEC` make it a snare/downbeat hit
 * (hard cut); otherwise the 0.9 s ease-out wipe. With no beat data the
 * safe choice is the wipe — a wrong cut is a visible pop, a wrong wipe
 * is only a slower settle.
 */
export function resolveBoundaryTransition(
  boundaryTimeSec: number,
  beatTimes: readonly number[],
): "cut" | "wipe" {
  if (!Number.isFinite(boundaryTimeSec)) return "wipe";
  for (const b of beatTimes) {
    if (Math.abs(b - boundaryTimeSec) <= CUT_ALIGNMENT_SEC) return "cut";
  }
  return "wipe";
}

/** Mutable driver state: the section index currently applied. */
export interface SectionDriverState {
  lastIndex: number;
}

export function createSectionDriverState(): SectionDriverState {
  return { lastIndex: -1 };
}

/** One frame's driver result. `boundary` is non-null only on the
 *  frame the playhead crosses into a different section. */
export interface SectionStep {
  profile: SectionMotionProfile;
  /** -1 when the playhead is outside every section. */
  index: number;
  boundary: "cut" | "wipe" | null;
}

/**
 * Advance the driver to `playheadSec`.
 *
 * Re-entering the same index is a no-op; leaving all sections
 * (index -1) resets `lastIndex` so a later re-entry fires a boundary
 * again rather than being swallowed.
 */
export function stepSectionDriver(
  state: SectionDriverState,
  sections: AnalysisSection[],
  playheadSec: number,
  beatTimes: readonly number[] = [],
): SectionStep {
  const index = sectionIndexAt(sections, playheadSec);
  if (index < 0) {
    state.lastIndex = -1;
    return { profile: DEFAULT_SECTION_PROFILE, index: -1, boundary: null };
  }
  const section = sections[index];
  if (index === state.lastIndex) {
    return { profile: profileForSection(section.type), index, boundary: null };
  }
  const boundary = resolveBoundaryTransition(section.start, beatTimes);
  state.lastIndex = index;
  return { profile: profileForSection(section.type), index, boundary };
}
