/**
 * Pure math/color helpers for the Canvas2D visualizer.
 *
 * Extracted from Canvas2DVisualizer.tsx (was 1560 lines) — no logic changed.
 * No dependencies: plain Canvas2D arithmetic, no React.
 */

/** Normalize a CSS color to 6-digit hex so an alpha suffix can be appended.
 *  Preset bgColors are usually `#rrggbb`, but `#rgb` (or a non-hex value) would
 *  have produced an invalid `fillStyle`, silently breaking the trail fade. */
export function normalizeHex(hex: string): string {
  const m = /^#([0-9a-f]{3})$/i.exec(hex.trim());
  if (m) {
    const [r, g, b] = m[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(hex.trim())) return hex.trim().toLowerCase();
  return "#050505"; // non-hex background: fall back to the default canvas bg
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = normalizeHex(hex).slice(1);
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

export function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return "#" + [r, g, bl].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// ============================================================================
// Animation helpers (2026 2D visualizer improvements)
// ============================================================================

/** Ease-out with a subtle overshoot for punchy bar transitions. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  return 1 + (c2 + 1) * Math.pow(t - 1, 3) + c2 * Math.pow(t - 1, 2);
}

/** Quadratic ease-out for smooth palette/section transitions. */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

// ============================================================================
// 2026 visualization research additions
// ============================================================================
// 2026 visualization research additions
// ===========================================================================

/** Map a bar index to an FFT bin using logarithmic frequency scaling.
 *  Human pitch perception is logarithmic — allocate more bars to bass/mids,
 *  fewer to highs. Returns a float bin index; caller rounds/floor as needed. */
export function logFreqMap(barIndex: number, barCount: number, freqLength: number): number {
  // A zero-length FFT (an empty or not-yet-populated analyser buffer) makes
  // log(0) -Infinity and exp(-Infinity) 0, so the lerp produced NaN. NaN here
  // propagates into a bar index and silently blanks the whole spectrum bar.
  const len = Math.max(1, freqLength);
  const t = barCount > 1 ? barIndex / (barCount - 1) : 0;
  // log-space from ~20 Hz to Nyquist; curve steepens at low end for bass detail
  const minLog = Math.log(1); // normalized 0 -> 20 Hz bin
  const maxLog = Math.log(len);
  const logIdx = minLog + t * (maxLog - minLog);
  return Math.exp(logIdx);
}

/** Perceptual scale selector used by the bar-style modes. */
export type PerceptualScale = "linear" | "log" | "bark" | "mel";

/**
 * Build a bar-index -> FFT-bin mapper for the chosen perceptual scale.
 *
 * This selector was **copy-pasted six times** inside `Canvas2DVisualizer.tsx`
 * (the diagnosis doc counted them at L600, 715, 804, 873, 950, 1023), each a
 * fresh closure over `perceptualScale`/`barCount`/`freqLen`. Six copies means a
 * fix to the mapping — or a new scale — has to be found and applied six times,
 * and any copy that is missed silently renders that mode on a different scale.
 * One factory, called once per frame per mode.
 *
 * Returned values are float bin indices; callers floor and clamp them.
 */
export function makeFreqMapper(
  scale: PerceptualScale | undefined,
  barCount: number,
  freqLength: number,
): (barIndex: number) => number {
  const chosen = scale ?? "log";
  switch (chosen) {
    case "bark":
      return (idx: number) => barkFreqMap(idx, barCount, freqLength);
    case "mel":
      return (idx: number) => melFreqMap(idx, barCount, freqLength);
    case "linear":
      return (idx: number) => (idx / barCount) * freqLength;
    case "log":
    default:
      return (idx: number) => logFreqMap(idx, barCount, freqLength);
  }
}

/**
 * Sample a frequency array through a mapper, clamped to the array bounds.
 *
 * Every one of the six call sites repeated the same
 * `freq?.[Math.min(freqLen - 1, Math.floor(freqMap(i)))] || 0` expression, which
 * is where a negative or NaN index silently blanks a bar.
 */
export function sampleMappedBand(
  freq: ArrayLike<number> | null | undefined,
  mapper: (barIndex: number) => number,
  barIndex: number,
): number {
  if (!freq || freq.length === 0) return 0;
  const raw = mapper(barIndex);
  if (!Number.isFinite(raw)) return 0;
  const bin = Math.floor(raw);
  if (bin < 0) return 0;
  const index = Math.min(freq.length - 1, bin);
  const value = freq[index];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Asymmetric band smoothing coefficients (AE doc §1, "the #1 fatigue fix"). */
export interface AsymmetricSmoothing {
  /** Weight given to the incoming sample when rising. */
  attack: number;
  /** Weight given to the incoming sample when falling. */
  release: number;
}

/**
 * Defaults from `docs/knowledge/gemini-ae-to-canvas2d-2026-10-02/README.md` §1:
 * rise 0.8 / fall 0.12. The 6.7x ratio is what damps high-frequency flicker
 * without adding lag to a kick.
 */
export const DEFAULT_ASYMMETRIC_SMOOTHING: AsymmetricSmoothing = {
  attack: 0.8,
  release: 0.12,
};

/**
 * One step of asymmetric (fast-attack, slow-release) smoothing.
 *
 * Equal-weight smoothing is the "triangular hit curve" the motion-design doc
 * calls amateur tell #3: everything ramps and falls at the same rate, so a hit
 * never snaps and a tail never clears. Rising fast and falling slowly is what
 * makes a transient read as a transient.
 *
 * Mutates and returns `state` so a caller can run a whole band array without
 * allocating per frame.
 */
export function asymmetricSmoothStep(
  state: number,
  target: number,
  smoothing: AsymmetricSmoothing = DEFAULT_ASYMMETRIC_SMOOTHING,
): number {
  const t = Number.isFinite(target) ? target : 0;
  const rising = t > state;
  const weight = rising ? smoothing.attack : smoothing.release;
  // A weight of exactly 1 is legitimate (pass-through) but must not be able to
  // produce a value outside [0,1] when the caller passes an unnormalised target.
  const next = state + weight * (t - state);
  return clamp(next, 0, 1);
}

/**
 * Smooth a whole band array in place.
 *
 * `values` is read at each index; `smoothed` holds the previous frame's state and
 * is updated in place. Both arrays are mutated rather than copied — this runs
 * 64+ times per frame.
 */
export function asymmetricSmoothBands(
  values: ArrayLike<number>,
  smoothed: number[],
  smoothing: AsymmetricSmoothing = DEFAULT_ASYMMETRIC_SMOOTHING,
): void {
  if (smoothed.length !== values.length) {
    smoothed.length = values.length;
    for (let i = 0; i < smoothed.length; i++) smoothed[i] = 0;
  }
  for (let i = 0; i < values.length; i++) {
    smoothed[i] = asymmetricSmoothStep(smoothed[i], values[i], smoothing);
  }
}

/** Simple value noise for aurora/fluid effects (no external deps). */
export function valueNoise(x: number, y: number, t: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const n00 = Math.sin(xi * 127.1 + yi * 311.7 + t * 0.7) * 43758.5453;
  const n10 = Math.sin((xi + 1) * 127.1 + yi * 311.7 + t * 0.7) * 43758.5453;
  const n01 = Math.sin(xi * 127.1 + (yi + 1) * 311.7 + t * 0.7) * 43758.5453;
  const n11 = Math.sin((xi + 1) * 127.1 + (yi + 1) * 311.7 + t * 0.7) * 43758.5453;
  // fract() must be non-negative: JS `%` keeps the sign of the dividend, and
  // these products span roughly +/-43758, so a bare `% 1` returned -1..1 with
  // about half the samples negative — a broken "noise" field rather than a
  // subtle offset. Adding 1 before the modulo folds negatives back into 0..1.
  const fract = (n: number) => ((n % 1) + 1) % 1;
  const nx0 = n00 + sx * (n10 - n00);
  const nx1 = n01 + sx * (n11 - n01);
  return fract(nx0 + sy * (nx1 - nx0));
}

/** Fractal Brownian motion — domain-warped FBM for aurora curtains. */
export function fbm(x: number, y: number, t: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * valueNoise(x * freq, y * freq, t);
    freq *= 2.0;
    amp *= 0.5;
  }
  return val;
}

/** Clamp a value into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ============================================================================
// Perceptual frequency scales (2026 research additions)
// ============================================================================

/** Convert Hz to Bark scale (critical bands for masking/loudness). */
export function hzToBark(hz: number): number {
  return 13 * Math.atan(0.00076 * hz) + 3.5 * Math.atan(Math.pow(hz / 7500, 2));
}

/** Convert Hz to ERB scale (equivalent rectangular bandwidth). */
export function hzToERB(hz: number): number {
  return 21.4 * Math.log10(1 + 0.00437 * hz);
}

/** Convert Hz to Mel scale (pitch perception for speech recognition). */
export function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

/** Map a bar index to an FFT bin using Bark scale (critical bands).
 *  Better for masking-aware visualization than linear or simple log. */
export function barkFreqMap(
  barIndex: number,
  barCount: number,
  freqLength: number,
  sampleRate = 44100,
): number {
  const len = Math.max(1, freqLength);
  const nyquist = sampleRate / 2;
  const t = barCount > 1 ? barIndex / (barCount - 1) : 0;

  // Map to Bark range: ~1 Bark (20 Hz) to ~24 Bark (Nyquist)
  const minBark = hzToBark(20);
  const maxBark = hzToBark(nyquist);
  const bark = minBark + t * (maxBark - minBark);

  // Convert back to Hz, then to FFT bin index
  const hz = (Math.pow(10, bark / 21.4) - 1) / 0.00437;
  return Math.min(len, Math.max(0, (hz / nyquist) * len));
}

/** Map a bar index to an FFT bin using Mel scale (pitch perception).
 *  Best for vocal-heavy content and speech recognition applications. */
export function melFreqMap(
  barIndex: number,
  barCount: number,
  freqLength: number,
  sampleRate = 44100,
): number {
  const len = Math.max(1, freqLength);
  const nyquist = sampleRate / 2;
  const t = barCount > 1 ? barIndex / (barCount - 1) : 0;

  // Map to Mel range: ~0 Mel (20 Hz) to ~4000 Mel (Nyquist)
  const minMel = hzToMel(20);
  const maxMel = hzToMel(nyquist);
  const mel = minMel + t * (maxMel - minMel);

  // Convert back to Hz, then to FFT bin index
  const hz = 700 * (Math.pow(10, mel / 2595) - 1);
  return Math.min(len, Math.max(0, (hz / nyquist) * len));
}
