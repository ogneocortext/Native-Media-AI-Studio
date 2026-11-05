/**
 * Adaptive quality governor (T-VIZ-18).
 *
 * Peak quality is not the goal — *held* frame time is. The governor tracks
 * a rolling window of frame times, computes p95, and steps a quality level
 * down when p95 stays above budget for `breachMs`, stepping back up only
 * after `recoverMs` of headroom. Hysteresis prevents oscillation.
 *
 * Pure logic — no DOM/R3F — so the ladder and thresholds are unit-testable.
 * Each surface maps `level` onto its own knobs:
 *   Canvas2D: DPR cap ladder, then particle budget, then trail persistence
 *   R3F:      pixelRatio ladder + post-processing toggles
 */

export interface QualityGovernorConfig {
  /** Frame-time budget in ms (16.7 ≈ 60 fps). Breach measured on p95. */
  budgetMs: number;
  /** Rolling window of frame samples used for the p95 estimate. */
  windowSize: number;
  /** p95 must exceed budgetMs for this long before stepping down. */
  breachMs: number;
  /** p95 must stay under budgetMs for this long before stepping up. */
  recoverMs: number;
  /** Quality levels, index 0 = highest. Surfaces map these to knobs. */
  levels: readonly number[];
}

export const DEFAULT_GOVERNOR_CONFIG: QualityGovernorConfig = {
  budgetMs: 20,
  windowSize: 120, // ~2 s at 60 fps
  breachMs: 2000,
  recoverMs: 10000,
  // DPR ladder per the plan: 2 → 1.5 → 1.25 → 1
  levels: [2, 1.5, 1.25, 1],
};

export class QualityGovernor {
  private samples: number[] = [];
  private head = 0;
  private count = 0;
  private levelIndex: number;
  private breachStart: number | null = null;
  private recoverStart: number | null = null;

  constructor(
    private config: QualityGovernorConfig = DEFAULT_GOVERNOR_CONFIG,
    startLevel = 0,
  ) {
    this.levelIndex = Math.min(startLevel, config.levels.length - 1);
  }

  /** Current quality level value (e.g. a DPR). */
  get level(): number {
    return this.config.levels[this.levelIndex];
  }

  get levelIndexValue(): number {
    return this.levelIndex;
  }

  /**
   * Record one frame's duration and evaluate the governor.
   * Returns the new level when it changed, else null.
   */
  sample(frameMs: number, nowMs: number): number | null {
    // Ring buffer of the last windowSize frame times.
    if (this.samples.length < this.config.windowSize) {
      this.samples.push(frameMs);
    } else {
      this.samples[this.head] = frameMs;
      this.head = (this.head + 1) % this.config.windowSize;
    }
    this.count += 1;

    // Need a full-ish window before judging — avoids cold-start flapping.
    if (this.count < Math.min(30, this.config.windowSize)) return null;

    const p95 = this.percentile(0.95);
    const breaching = p95 > this.config.budgetMs;

    if (breaching) {
      this.recoverStart = null;
      this.breachStart ??= nowMs;
      if (
        this.levelIndex < this.config.levels.length - 1 &&
        nowMs - this.breachStart >= this.config.breachMs
      ) {
        this.levelIndex += 1;
        this.breachStart = null;
        return this.level;
      }
    } else {
      this.breachStart = null;
      // Only step up from the bottom two rungs being clearly healthy is not
      // required — headroom for recoverMs is enough per the plan.
      if (this.levelIndex > 0) {
        this.recoverStart ??= nowMs;
        if (nowMs - this.recoverStart >= this.config.recoverMs) {
          this.levelIndex -= 1;
          this.recoverStart = null;
          return this.level;
        }
      } else {
        this.recoverStart = null;
      }
    }
    return null;
  }

  /** p95 of the rolling window (nearest-rank). */
  private percentile(p: number): number {
    const n = Math.min(this.count, this.samples.length);
    if (n === 0) return 0;
    const sorted = this.samples.slice(0, n).sort((a, b) => a - b);
    const idx = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
    return sorted[idx];
  }

  /** Force a level (e.g. user toggles quality override). */
  setLevel(index: number): number | null {
    const clamped = Math.max(0, Math.min(index, this.config.levels.length - 1));
    if (clamped === this.levelIndex) return null;
    this.levelIndex = clamped;
    this.breachStart = null;
    this.recoverStart = null;
    return this.level;
  }

  reset() {
    this.samples = [];
    this.head = 0;
    this.count = 0;
    this.levelIndex = 0;
    this.breachStart = null;
    this.recoverStart = null;
  }
}
