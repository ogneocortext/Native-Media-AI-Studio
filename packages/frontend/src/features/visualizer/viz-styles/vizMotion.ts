/**
 * 2026-grade audio-reactive motion primitives for the 3D visualizations.
 *
 * The shader presets got beat-quantized snaps, attack/release smoothing,
 * energy-driven palettes and highlight rolloff (see shaders.ts). These
 * helpers bring the same language to the Three.js scene so a 3D style
 * and an FX preset read as one studio, not two eras.
 *
 * Why each exists (measured, not aesthetic):
 *  - attackRelease: every viz set its pulse to 1.0 on a beat and decayed
 *    with a fixed multiplier. That is release-only — the attack is an
 *    instant step, which reads as a glitch on 120 Hz displays and as a
 *    pop on 30 Hz ones. A real envelope has both.
 *  - energyHue: palettes were fixed hue ranges, so a quiet passage and a
 *    chorus looked the same except for brightness. The 2026 convention
 *    (and the shader work) is cool-when-quiet → warm-when-loud.
 *  - rolloff: emissive intensities were linear, so under bloom any loud
 *    frame clipped to a featureless white disc. 1 - exp(-x·k) keeps the
 *    low end sensitive and rolls the peak off instead of clipping it.
 *  - beatSnap: beatPhase is continuous [0,1); a smooth cos curve over it
 *    quantizes motion to the musical grid without a boolean onset.
 *  - gammaDrive: HSL lightness was driven by raw linear band energy, a
 *    perceptual channel fed a non-perceptual value — quiet frames sank
 *    and loud frames clipped. pow(x, 1/2.2), the same curve the shader
 *    path's uniforms already use.
 */

/**
 * Frame-rate-independent attack/release envelope.
 * `current` moves toward `target` at `attack` (per 60 fps frame) when
 * the target is above it, and at `release` when below. Both are
 * per-frame retention factors (0.9 = keep 90% of the gap per frame).
 */
export function attackRelease(
  current: number,
  target: number,
  attack: number,
  release: number,
  dt60: number,
): number {
  const rate = target > current ? attack : release;
  // pow() normalizes the per-frame factor to the actual frame time so
  // 120 Hz and 30 Hz displays converge at the same wall-clock rate.
  const gap = target - current;
  return current + gap * (1 - Math.pow(rate, dt60));
}

/**
 * Beat-quantized snap curve over the continuous beat phase.
 * phase 0 = on the beat, →1 as the next beat nears. Returns a value in
 * [0, 1] that spikes sharply at the beat and decays smoothly — motion
 * keyed to this reads as "on the grid" rather than as a smooth swell.
 * `sharpness` (default 6) controls how fast the spike falls off.
 */
export function beatSnap(phase: number, sharpness = 6): number {
  const p = ((phase % 1) + 1) % 1;
  return Math.exp(-sharpness * p);
}

/**
 * Energy-driven hue: cool blue (0.58) at rest → warm orange-red (0.03)
 * at full energy. Pass the result to setHSL as the hue.
 */
export function energyHue(energy: number): number {
  const e = Math.min(1, Math.max(0, energy));
  // Quadratic so the warm shift only commits in the loud half — a
  // linear ramp warms the whole track, including quiet verses.
  return 0.58 - 0.55 * e * e;
}

/**
 * Highlight rolloff: 1 - exp(-x·k). Sensitive at low x, rolls off
 * instead of clipping at high x. Use for emissive intensity / glow so
 * loud frames keep detail under bloom instead of going white.
 */
export function rolloff(x: number, k = 1.2): number {
  return 1 - Math.exp(-Math.max(0, x) * k);
}

/**
 * Gamma-corrected brightness drive for perceptual channels (HSL
 * lightness, emissive lightness). Eyes respond logarithmically, so a raw
 * linear energy→brightness map clips early and reads as wrong
 * ([[audio-reactive-best-practices-2026]] §2). `pow(x, 1/2.2)` lifts
 * quiet passage detail and compresses the loud half, so a quiet verse
 * still moves the lightness channel and a chorus does not blow it out.
 *
 * Same convention as `AudioReactivityProcessor`'s shader uniforms
 * (`gamma: 2.2` default) — one curve across both render paths.
 *
 * Only for energy *readings* (band levels, spectral features). Control
 * ramps and envelopes (beatPulse, beatSnap, the processor's
 * `anticipation` uniform) stay linear: they are timelines, not
 * intensities, and gamma there would distort the grid they encode.
 */
export function gammaDrive(value: number, gamma = 2.2): number {
  if (!Number.isFinite(value)) return 0;
  return Math.pow(Math.min(1, Math.max(0, value)), 1 / gamma);
}
