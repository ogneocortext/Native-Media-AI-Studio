/**
 * Pure math/color helpers for the Canvas2D visualizer.
 *
 * Extracted from Canvas2DVisualizer.tsx (was 1560 lines) — no logic changed.
 * No React: plain Canvas2D arithmetic. The perceptual-scale conversions are the
 * one import — they live in ./perceptualScales (one tested implementation per
 * scale) and are re-exported below so existing importers keep working.
 */

import { barkToHz, hzToBark, hzToMel, melToHz } from "./perceptualScales";

export { barkToHz, hzToBark, hzToMel };
/** Alias for the historical `hzToERB` spelling used by this module. */
export { hzToErb as hzToERB } from "./perceptualScales";

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

/**
 * Frame-rate-independent exponential smoothing (exponential decay toward a
 * target).
 *
 * `lambda` is the continuous decay rate in "per-60Hz-seconds", derived from a
 * per-frame weight `k` (designed for a 60 Hz frame budget) as:
 *
 *     lambda = -60 * ln(1 - k)
 *
 * `dt` is the elapsed time in seconds since the last frame. At 60 Hz,
 * `dt = 1/60`, so `exp(-lambda * dt) = exp(log(1 - k)) = 1 - k`, reproducing
 * the original fixed-per-frame lerp `state += k * (target - state)`. At any
 * other frame rate, N steps of `damp()` with `dt = 1 / (60 * N)` converge to
 * the same state as 60 steps with `dt = 1/60` — smoothness no longer depends
 * on the monitor's refresh rate.
 *
 * Example: a spring with `springK = 0.28` at 60 Hz has
 * `lambda = -60 * ln(1 - 0.28) ≈ 1.978`. Running 60 steps at 60 Hz or 120
 * steps at 120 Hz both converge to the same state.
 *
 * Mutates nothing: returns the next state value.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  const factor = Math.exp(-lambda * dt);
  return target + (current - target) * factor;
}

/**
 * Convert a per-60Hz-frame smoothing weight `k` (e.g. `springK = 0.28`) into
 * the continuous decay rate `lambda` used by `damp()`.
 *
 *     lambda = -60 * ln(1 - k)
 *
 * At `dt = 1/60` (60 Hz), `damp(current, target, lambda, dt)` equals
 * `current + k * (target - current)`.
 */
export function dampLambda(k: number): number {
  return -60 * Math.log(1 - k);
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
 *
 * `sampleRate` is the live `AudioContext` rate and is forwarded to the Bark and
 * Mel mappers, whose Hz → bin conversion divides by Nyquist. `log` and `linear`
 * work in bin-index space and are rate-independent. It defaults to 44100 only
 * so a virtual/demo buffer (no analyser) still renders.
 */
export function makeFreqMapper(
  scale: PerceptualScale | undefined,
  barCount: number,
  freqLength: number,
  sampleRate = 44100,
): (barIndex: number) => number {
  const chosen = scale ?? "log";
  switch (chosen) {
    case "bark":
      return (idx: number) => barkFreqMap(idx, barCount, freqLength, sampleRate);
    case "mel":
      return (idx: number) => melFreqMap(idx, barCount, freqLength, sampleRate);
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

// ============================================================================
// T-VIZ-15 — single attack/release envelope stage
// ============================================================================
// One smoothing stage between raw analyser band data and every Canvas2D
// mode. Per-band-group time constants (transients snap, colour drifts)
// from the veffects reference, converted to continuous lambdas via the
// T-VIZ-14 helper. Replaces the per-mode springs and the earlier
// two-mode asymmetricSmoothStep wiring.

/** Per-frame convergence weights at 60 Hz, by frequency group. */
interface EnvelopeBandK {
  attack: number;
  release: number;
}

const ENVELOPE_BANDS: { maxHz: number; k: EnvelopeBandK }[] = [
  { maxHz: 250, k: { attack: 0.5, release: 0.06 } }, // bass
  { maxHz: 4000, k: { attack: 0.5, release: 0.07 } }, // mid
  { maxHz: Infinity, k: { attack: 0.5, release: 0.1 } }, // treble
];

/** Spectral centroid smoothing — symmetric, slow (veffects reference). */
const CENTROID_K = 0.05;

export interface EnvelopeStage {
  /** Enveloped bands in the same 0–255 byte scale/length as analyser output. */
  readonly bands: Uint8Array;
  /** Length of `bands` (matches the analyser's frequencyBinCount). */
  readonly length: number;
  /** Enveloped spectral centroid, 0..1 of Nyquist. */
  centroid: number;
  /** Advance the envelope by `dt` seconds against raw byte band data. */
  step(raw: Uint8Array, dt: number): void;
  /**
   * T-VIZ-16 — same as `step` but the input is already normalized to
   * 0..1 (e.g. dB floats mapped through the analyser's min/maxDecibels).
   * Avoids the byte quantization step on slow fades; output `bands`
   * stays byte-scaled so mode math is unchanged.
   */
  stepNorm(raw: ArrayLike<number>, dt: number): void;
  /** Snap all state to zero — call on track switch / silence. */
  reset(): void;
}

/**
 * Create the shared band-envelope stage. `freqLength` is the analyser's
 * `frequencyBinCount` (fftSize / 2); `sampleRate` maps bins to Hz so each
 * bin gets its group's attack/release lambdas.
 */
export function createEnvelopeStage(
  freqLength: number,
  sampleRate = 44100,
): EnvelopeStage {
  const length = Math.max(1, freqLength);
  const binHz = sampleRate / (2 * length);
  const attackLambda = new Float64Array(length);
  const releaseLambda = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const hz = (i + 0.5) * binHz;
    const group = ENVELOPE_BANDS.find((b) => hz < b.maxHz) ?? ENVELOPE_BANDS[2];
    attackLambda[i] = dampLambda(group.k.attack);
    releaseLambda[i] = dampLambda(group.k.release);
  }
  const centroidLambda = dampLambda(CENTROID_K);
  const state = new Float64Array(length);
  const bands = new Uint8Array(length);
  const advance = (
    readTarget: (i: number) => number,
    rawLen: number,
    dt: number,
  ) => {
    const n = Math.min(length, rawLen);
    let sum = 0;
    let weighted = 0;
    for (let i = 0; i < n; i++) {
      const target = readTarget(i);
      sum += target * 255;
      weighted += i * target * 255;
      const rising = target > state[i];
      state[i] = damp(
        state[i],
        target,
        rising ? attackLambda[i] : releaseLambda[i],
        dt,
      );
      bands[i] = Math.round(clamp(state[i], 0, 1) * 255);
    }
    for (let i = n; i < length; i++) {
      state[i] = damp(state[i], 0, releaseLambda[i], dt);
      bands[i] = Math.round(clamp(state[i], 0, 1) * 255);
    }
    const centroidTarget = sum > 0 ? weighted / sum / length : 0;
    stage.centroid = damp(stage.centroid, centroidTarget, centroidLambda, dt);
  };

  const stage: EnvelopeStage = {
    bands,
    length,
    centroid: 0,
    step(raw: Uint8Array, dt: number) {
      advance((i) => raw[i] / 255, raw.length, dt);
    },
    stepNorm(raw: ArrayLike<number>, dt: number) {
      advance((i) => {
        const v = raw[i];
        return Number.isFinite(v) ? clamp(v, 0, 1) : 0;
      }, raw.length, dt);
    },
    reset() {
      state.fill(0);
      bands.fill(0);
      stage.centroid = 0;
    },
  };
  return stage;
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

// ============================================================================
// T-VIZ-17 — pre-rendered glow sprites (replaces per-shape shadow blur)
// ============================================================================
// shadow blur forces the canvas to re-rasterize a gaussian blur for every
// shape, every frame — the single most expensive 2D canvas feature. The
// standard replacement is a soft radial sprite drawn additively: one
// offscreen canvas per colour, scaled/translated per instance.

const GLOW_SPRITE_SIZE = 128;
const glowSpriteCache = new Map<string, HTMLCanvasElement>();

/** Parse "#rgb"/"#rrggbb"/"rgb()"/"rgba()" into [r,g,b]; null if unknown. */
function parseColorRgb(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = /^rgba?\(([^)]+)\)/.exec(trimmed);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p));
    if (parts.length >= 3 && parts.every((p) => Number.isFinite(p))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

/**
 * Soft radial glow sprite for `color`, cached per colour string. The
 * gradient fades the colour to transparent — under `globalCompositeOperation
 * = "lighter"` the black-transparent tail contributes nothing, so the
 * falloff reads as a real glow.
 */
export function getGlowSprite(color: string): HTMLCanvasElement {
  const cached = glowSpriteCache.get(color);
  if (cached) return cached;
  const size = GLOW_SPRITE_SIZE;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (g) {
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    const rgb = parseColorRgb(color);
    if (rgb) {
      const [cr, cg, cb] = rgb;
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.85)`);
      grad.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.28)`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    } else {
      // Unparseable colour — still usable under 'lighter': the tail is
      // transparent black which adds zero light.
      grad.addColorStop(0, color);
      grad.addColorStop(1, "transparent");
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  glowSpriteCache.set(color, c);
  return c;
}

/**
 * Draw an additive glow centred at (cx, cy) covering w×h device pixels.
 * Saves/restores composite op and alpha so callers keep their state.
 */
export function drawGlowSprite(
  ctx: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  alpha = 0.6,
): void {
  const prevCO = ctx.globalCompositeOperation;
  const prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  ctx.drawImage(getGlowSprite(color), cx - w / 2, cy - h / 2, w, h);
  ctx.globalCompositeOperation = prevCO;
  ctx.globalAlpha = prevA;
}

/** Clamp a value into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ============================================================================
// Perceptual frequency scales (2026 research additions)
// ============================================================================
//
// `hzToBark`/`barkToHz`/`hzToERB`/`hzToMel` used to be defined here *and* in
// ./perceptualScales — two copies, and both carried the same wrong Bark inverse
// (Traunmuller's, which is not the inverse of Terhardt's forward function), so
// the defect existed twice and either copy could drift. They are now imported
// from ./perceptualScales and re-exported above: one implementation, under test.

/** Map a bar index to an FFT bin using Bark scale (critical bands).
 *  Better for masking-aware visualization than linear or simple log.
 *
 *  `sampleRate` matters: the mapper converts Hz → bin via Nyquist, so a 44.1 kHz
 *  assumption on a 48 kHz context (the Windows default device rate) stretches the
 *  whole frequency axis by 8.8%. Callers should pass the live `AudioContext`
 *  rate; the default is a fallback for a virtual/demo buffer with no analyser.
 */
export function barkFreqMap(
  barIndex: number,
  barCount: number,
  freqLength: number,
  sampleRate = 44100,
): number {
  const len = Math.max(1, freqLength);
  const nyquist = sampleRate / 2;
  const t = barCount > 1 ? barIndex / (barCount - 1) : 0;

  // Map to Bark range: ~1 Bark (20 Hz) to ~24.7 Bark (Nyquist at 44.1 kHz)
  const minBark = hzToBark(20);
  const maxBark = hzToBark(nyquist);
  const bark = minBark + t * (maxBark - minBark);

  // Convert back to Hz with the **Bark** inverse, then to an FFT bin index.
  //
  // Two bugs lived here. First it used the ERB inverse, `(10^(x/21.4) - 1) /
  // 0.00437` — a different scale entirely, so every band landed ~3.4x too low
  // and the top bar sampled ~1.2 kHz instead of Nyquist. Then it used
  // Traunmuller's Bark inverse, which is not the inverse of the Terhardt
  // forward: it overshot Nyquist by 46% and put intermediate bars at the wrong
  // pitch. `barkToHz` is now an exact numeric inverse, so this lands where the
  // Bark interpolation says it should.
  //
  // The old tests missed both because they only asserted range and monotonicity,
  // and a uniformly squashed (or overshooting) mapping satisfies both.
  const hz = barkToHz(bark);
  return Math.min(len, Math.max(0, (hz / nyquist) * len));
}

/** Map a bar index to an FFT bin using Mel scale (pitch perception).
 *  Best for vocal-heavy content and speech recognition applications.
 *  See {@link barkFreqMap} for why `sampleRate` must be the live context rate. */
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
  const hz = melToHz(mel);
  return Math.min(len, Math.max(0, (hz / nyquist) * len));
}
