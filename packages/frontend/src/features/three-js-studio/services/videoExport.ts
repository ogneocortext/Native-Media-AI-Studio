/**
 * Deterministic export planning for the three-js-studio (plan F5).
 *
 * The mux/encode lives in the visualizer's `frameAccurateExport.ts`
 * (generic canvas → mediabunny path, reused rather than duplicated).
 * This module holds the two studio-lane pieces that must be *pure*,
 * because they are what makes two exports of the same scene agree:
 *
 * 1. `planExport` — the frame grid. Frame `i` always lands at `i / fps`
 *    and the count is always `round(durationSec * fps)`, never
 *    whatever the wall clock managed to capture.
 * 2. `createSeededRandom` — the render loop draws randomness per frame
 *    (handheld camera walk, beat shake, particle wrap). Live frames
 *    keep `Math.random`; export frames advance a fixed seed so the same
 *    frame index produces the same jitter in every run.
 */

/** A deterministic export grid. */
export interface ExportPlan {
  fps: number;
  durationSec: number;
  /** Exact frame count: `round(durationSec * fps)`, at least 1. */
  totalFrames: number;
  /** Seconds per frame (`1 / fps`) — the dt each frame steps by. */
  dtSec: number;
  /** Timestamp of frame `i` in the export timeline. */
  timeAt: (frame: number) => number;
}

/**
 * Build the export grid. Defaults match the plan's acceptance case:
 * 10 s at 30 fps → exactly 300 frames.
 */
export function planExport(durationSec = 10, fps = 30): ExportPlan {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 10;
  const totalFrames = Math.max(1, Math.round(safeDuration * safeFps));
  return {
    fps: safeFps,
    durationSec: safeDuration,
    totalFrames,
    dtSec: 1 / safeFps,
    timeAt: (frame: number) => {
      const f = Number.isFinite(frame) && frame > 0 ? Math.floor(frame) : 0;
      return Math.min(f / safeFps, safeDuration);
    },
  };
}

/**
 * mulberry32: a small, fast, seedable PRNG. Same seed → same sequence,
 * which is the whole point — an export frame's jitter must be a
 * function of the seed and the number of prior draws, nothing else.
 */
export function createSeededRandom(seed = 0x9e3779b9): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
