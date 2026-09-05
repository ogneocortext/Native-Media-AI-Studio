/**
 * Shared audio-timing utilities for the visualizer.
 *
 * Why this module exists: beat/LRC synchronization was drifting because
 * - `HTMLMediaElement.currentTime` ticks coarsely (browser-dependent, often
 *   50–250 ms steps), so beat_times/LRC matching was steppy and late;
 * - audio output latency (base + device) was never compensated, adding a
 *   systematic bias between timed events and what you actually hear;
 * - smoothing constants were copy-pasted between Visualizer.tsx and
 *   audioHooks.ts and could drift apart silently.
 *
 * All timed lookups (beats, LRC, sections) must go through the interpolated,
 * latency-compensated clock below — never raw `el.currentTime`.
 */

/** AnalyserNode temporal smoothing. 0.8 trailed ~100ms; 0.55 was still ~40ms. 0.25 gives tight transient without self-smoothing. */
export const ANALYSER_SMOOTHING = 0.25;
/** Attack per frame @60fps — 0.9 hits onsets within 1 frame (2026 tight sync). */
export const ATTACK = 0.88;
/** Release per frame @60fps — 0.15 decays in ~6 frames, not 15. */
export const RELEASE = 0.15;

/**
 * Estimate total audio output latency in seconds: time between a sample being
 * rendered and it reaching your ears. Heard media-time ≈ currentTime − latency.
 */
export function estimateOutputLatency(ctx: BaseAudioContext | null): number {
  if (!ctx) return 0;
  const full = ctx as AudioContext;
  const output = full.outputLatency ?? 0;
  const base = full.baseLatency ?? 0;
  const total = output + base;
  if (!Number.isFinite(total) || total < 0) return 0;
  return Math.min(total, 0.5);
}

export interface AudioClock {
  /**
   * Sample the media element and return the estimated *heard* position in
   * seconds: currentTime interpolated between coarse ticks via performance.now(),
   * minus output latency. Safe to call every rAF/useFrame.
   */
  sample(el: HTMLMediaElement | null, latencySec: number): number;
  reset(): void;
}

/** Interpolated, latency-compensated audio clock. One instance per playback pipeline. */
export function createAudioClock(): AudioClock {
  let lastT = 0;
  let lastP = 0;
  let cur = 0;
  return {
    sample(el, latencySec) {
      if (!el) return cur;
      const t = el.currentTime || 0;
      const p = performance.now();
      if (t !== lastT) {
        lastT = t;
        lastP = p;
      }
      const rate = el.playbackRate || 1;
      const interp = lastT + (Math.max(0, p - lastP) / 1000) * rate;
      // Guard against stalls/seeks: never run more than 0.5 s past the last tick.
      const clamped = t > 0 ? Math.min(interp, t + 0.5) : interp;
      const latency = Number.isFinite(latencySec) ? Math.max(0, latencySec) : 0;
      cur = Math.max(0, clamped - latency);
      return cur;
    },
    reset() {
      lastT = 0;
      lastP = 0;
      cur = 0;
    },
  };
}
