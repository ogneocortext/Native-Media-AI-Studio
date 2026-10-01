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
