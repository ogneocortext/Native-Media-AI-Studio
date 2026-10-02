/**
 * Stem mix presets and gain conversion.
 *
 * Implements the UX contract from
 * `docs/knowledge/gemini-stem-mixer-ux-2026-10-02/README.md`, which constrains the
 * mixer to a small control count and specifies a dB fader scale plus a 3-way
 * macro preset. That brief is guidance to evaluate, not verified implementation,
 * so the numbers are isolated here as pure data + functions:
 *
 * - Unit-tested in `stemMixPresets.test.ts` (mutation-checked).
 * - The component converts to WebAudio gain via `dbToGain`, so the UI can stay in
 *   dB (perceptually meaningful, matches the brief) while the audio graph stays in
 *   linear amplitude.
 *
 * Pure module: no React, no WebAudio, no imports. That is deliberate - it is the
 * part most likely to be tuned, and it should be testable without a browser.
 */

/** Mirrors the backend's `STEM_NAMES` in `services/source_separation.py`. */
export type StemName = "vocals" | "drums" | "bass" | "other";

export const STEM_NAMES: StemName[] = ["vocals", "drums", "bass", "other"];

/** Fader travel per the brief: -24 dB to +6 dB. */
export const FADER_MIN_DB = -24;
export const FADER_MAX_DB = 6;

/** A stem at fader minimum reads as -inf (soft mute) per the brief. */
export const MIN_DB_EPSILON = -60;

/**
 * Snap window around 0 dB. The brief asks for magnetic snapping so a stem
 * returns to unity without fiddling, which matters because these tracks are
 * level-matched by Demucs and unity is the natural reference.
 */
export const SNAP_DB = 0.5;

export type MixPresetId = "balanced" | "vocal_focus" | "karaoke";

/**
 * Macro presets that move all four faders at once.
 *
 * The brief replaces an "Advanced" drawer with this single control, on the
 * reasoning that non-engineers cannot use per-band EQ safely. `-Infinity`
 * vocals is the karaoke case: it is a mute expressed as a level, so the fader
 * position still reads meaningfully.
 */
export const MIX_PRESETS: Record<MixPresetId, Record<StemName, number>> = {
  // Default must sound better than the raw track with zero input.
  balanced: { vocals: 1.5, drums: 0, bass: -0.5, other: -1.5 },
  vocal_focus: { vocals: 3.5, drums: -0.5, bass: -1, other: -2.5 },
  karaoke: { vocals: -Infinity, drums: 1, bass: 0.5, other: 0 },
};

/**
 * Per-stem defaults before any user input.
 *
 * Suno-derived stems all have a problem the brief names individually: vocals sit
 * submerged, low end is muddy, and the "other" bucket holds most of the Demucs
 * swirl. These offsets are the cheapest correct starting point and are what
 * `Reset` restores.
 */
export const DEFAULT_STEM_GAINS_DB: Record<StemName, number> = MIX_PRESETS.balanced;

/** Neutral profile for non-Suno tracks: no corrective offsets at all. */
export const NEUTRAL_STEM_GAINS_DB: Record<StemName, number> = {
  vocals: 0,
  drums: 0,
  bass: 0,
  other: 0,
};

/**
 * Convert a dB value to linear gain for a WebAudio GainNode.
 *
 * WebAudio `GainNode.gain` is linear amplitude, but a mixer fader is
 * perceptually logarithmic. Doing this conversion in one place is the point:
 * the alternative is `10 ** (db / 20)` scattered across call sites, which is
 * where a 20-vs-10 error (amplitude vs power) would silently go unnoticed.
 *
 * -Infinity maps to 0 (true silence) rather than NaN.
 */
export function dbToGain(db: number): number {
  if (db === -Infinity || db <= MIN_DB_EPSILON) return 0;
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

/**
 * Convert linear gain back to dB, for displaying a fader position.
 * Returns `MIN_DB_EPSILON` rather than -Infinity so it stays slider-compatible.
 */
export function gainToDb(gain: number): number {
  if (gain <= 0) return MIN_DB_EPSILON;
  return 20 * Math.log10(gain);
}

/**
 * Snap a dB value to 0 when it lands *within* `SNAP_DB`, and clamp to the fader
 * range otherwise.
 *
 * The snap test is strict (`<`) on purpose: exactly `SNAP_DB` away from unity is
 * a deliberate user choice, so it must not be swallowed by the magnet. An
 * inclusive `<=` here means a user aiming for +0.5 dB silently gets 0.0 and no
 * amount of care on their part avoids it.
 *
 * Snap is applied before clamping so a value just outside the range cannot be
 * snapped inward to a different value than the user asked for.
 */
export function snapDb(db: number): number {
  if (!Number.isFinite(db)) return db;
  if (Math.abs(db) < SNAP_DB) return 0;
  return Math.max(FADER_MIN_DB, Math.min(FADER_MAX_DB, db));
}

/** dB position for a fader at fraction `t` in [0, 1]. */
export function dbFromFraction(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return FADER_MIN_DB + clamped * (FADER_MAX_DB - FADER_MIN_DB);
}

/**
 * Fraction in [0, 1] for a dB position. Inverse of `dbFromFraction`, except
 * that `-Infinity` (karaoke vocals) reports 0 - fader at the bottom.
 */
export function fractionFromDb(db: number): number {
  if (db === -Infinity || db <= MIN_DB_EPSILON) return 0;
  return Math.max(0, Math.min(1, (db - FADER_MIN_DB) / (FADER_MAX_DB - FADER_MIN_DB)));
}

/** Format a dB value for a fader readout. */
export function formatDb(db: number): string {
  if (db === -Infinity) return "-∞";
  const rounded = Math.round(db * 10) / 10;
  if (rounded === 0) return "0.0 dB";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
}

/** Preset label order for the segmented control. */
export const MIX_PRESET_ORDER: MixPresetId[] = ["balanced", "vocal_focus", "karaoke"];

export const MIX_PRESET_LABELS: Record<MixPresetId, string> = {
  balanced: "Balanced",
  vocal_focus: "Vocal Boost",
  karaoke: "Karaoke",
};