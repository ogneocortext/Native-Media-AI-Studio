/**
 * Chroma -> hue palette mapping (docs/architecture/chroma-hue-mapping.md).
 *
 * Derives a static per-track palette from the detected musical key. Pure DSP,
 * no model: pitch class maps to hue along the circle of fifths so that
 * harmonically adjacent keys are visually adjacent - a modulation reads as a
 * smooth grade shift rather than a jump cut.
 *
 * Pure module by design: no React, no WebGL. The determinism is the point - it
 * is the fallback layer when heavier analysis is unavailable, so it must be
 * testable in isolation and must never throw on malformed input.
 */

/** Fifths order from C. Index * 30 degrees = hue. Analyzer emits sharps only. */
const FIFTHS_ORDER = ["C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#", "F"] as const;

export const SAT_MAJOR = 0.75;
export const SAT_MINOR = 0.55;
/** Below this confidence the key is not trustworthy and we stop guessing. */
export const CONF_FLOOR = 0.4;
/** At or above this, use the key directly with no blending. */
export const CONF_CERTAIN = 0.6;
/** Neutral palette saturation: desaturated, but never a flat black frame. */
export const SAT_NEUTRAL = 0.08;

export interface KeyPalette {
  /** 0..1, hue as a fraction of a turn (degrees / 360). */
  hue: number;
  /** 0..1, from mode and confidence. */
  saturation: number;
  /** 0..1, raw correlation, for shaders that want to modulate on certainty. */
  confidence: number;
  /** True when the key was too weak to trust and the neutral fallback was used. */
  fallback: boolean;
}

export interface KeyAnalysisLike {
  estimated_key?: string | null;
  key_confidence_r?: number | null;
  key_runner_up?: string | null;
  key_runner_up_r?: number | null;
}

/**
 * Split `"A minor"` into pitch class and mode.
 * Tolerates a bare pitch class (`"A"`) - some analysis files omit the mode -
 * which then falls back to major, since an omitted mode is not evidence of minor.
 */
export function parseKey(key: string | null | undefined): { pc: string; mode: "major" | "minor" } | null {
  if (typeof key !== "string") return null;
  const parts = key.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return null;
  const pc = parts[0];
  const mode = parts[1] === "minor" ? "minor" : "major";
  return FIFTHS_ORDER.includes(pc as (typeof FIFTHS_ORDER)[number])
    ? { pc, mode }
    : null;
}

/** Pitch class -> 0..1 hue along the circle of fifths. Null if unrecognised. */
export function pitchClassToHue(pc: string | null | undefined): number | null {
  const idx = FIFTHS_ORDER.indexOf((pc ?? "") as (typeof FIFTHS_ORDER)[number]);
  return idx < 0 ? null : (idx * 30) / 360;
}

/** Hue (0..1) -> 0..1 RGB, using HSV with full value. */
export function hueToRgb(hue: number, sat: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1;
  const s = Math.min(1, Math.max(0, sat));
  const c = s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = 1 - c;
  let rgb: [number, number, number];
  if (h < 1 / 6) rgb = [c, x, 0];
  else if (h < 2 / 6) rgb = [x, c, 0];
  else if (h < 3 / 6) rgb = [0, c, x];
  else if (h < 4 / 6) rgb = [0, x, c];
  else if (h < 5 / 6) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => v + m) as [number, number, number];
}

/**
 * Build the palette for a track.
 *
 * Thresholds are from the spec:
 *   r >= 0.6                 use the key directly
 *   0.4 <= r < 0.6           blend toward the runner-up, halve saturation
 *   r < 0.4, or key missing  neutral saturation, hue holds the last value
 *
 * `lastHue` carries the previous hue into the fallback branch. When it is null
 * (first track, or a track with no key at all) we fall back to the fifths slot
 * of C - red - so there is always a defined, non-black colour.
 */
export function keyPalette(analysis: KeyAnalysisLike | null | undefined, lastHue: number | null = null): KeyPalette {
  const empty: KeyPalette = {
    hue: lastHue ?? 0,
    saturation: SAT_NEUTRAL,
    confidence: 0,
    fallback: true,
  };
  if (!analysis) return empty;

  const parsed = parseKey(analysis.estimated_key);
  const raw = analysis.key_confidence_r;
  const confidence = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;

  if (!parsed || confidence < CONF_FLOOR) {
    // Hue holds the last value; when we have none, C's slot (red) is defined
    // and visible rather than a black frame.
    return { ...empty, hue: lastHue ?? pitchClassToHue("C") ?? 0 };
  }

  const hue = pitchClassToHue(parsed.pc) ?? 0;
  const baseSat = parsed.mode === "minor" ? SAT_MINOR : SAT_MAJOR;

  if (confidence >= CONF_CERTAIN) {
    return { hue, saturation: baseSat, confidence, fallback: false };
  }

  // Middling confidence: the key is a coin flip, so show the in-between.
  const runner = parseKey(analysis.key_runner_up);
  const runnerHue = runner ? pitchClassToHue(runner.pc) : null;
  if (runnerHue === null) {
    // No usable runner-up: keep the key's hue but signal the uncertainty by
    // desaturation rather than pretending the key is certain.
    return { hue, saturation: baseSat / 2, confidence, fallback: false };
  }

  // Weight the blend by the two correlations so a close runner-up barely moves
  // the hue and a distant one dominates. Clamped because r can be negative.
  const runnerR = typeof analysis.key_runner_up_r === "number" && Number.isFinite(analysis.key_runner_up_r)
    ? analysis.key_runner_up_r
    : 0;
  const w = runnerR / (confidence + runnerR);
  // Blend the short way around the hue circle so 0.95 -> 0.05 does not sweep
  // through every colour in between.
  let delta = runnerHue - hue;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  const blended = hue + delta * w;

  return { hue: ((blended % 1) + 1) % 1, saturation: baseSat / 2, confidence, fallback: false };
}