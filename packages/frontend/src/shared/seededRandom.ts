/**
 * mulberry32 — a small, fast, seedable PRNG.
 *
 * Same seed → same sequence, which is the whole point: a deterministic export
 * frame's jitter must be a function of the seed and the number of prior draws,
 * nothing else. Two render paths (the three-js studio lane and the 2D canvas
 * lane) need exactly this, so it lives in `shared/` rather than being copied —
 * a second implementation would be a second sequence to keep in sync.
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
