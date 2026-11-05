import { describe, expect, it } from "vitest";
import { QualityGovernor, DEFAULT_GOVERNOR_CONFIG } from "./qualityGovernor";

const FAST = 8; // ms — well under budget
const SLOW = 40; // ms — over the 20 ms budget

describe("QualityGovernor (T-VIZ-18)", () => {
  it("stays at top level when frames are fast", () => {
    const g = new QualityGovernor();
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t += 16;
      expect(g.sample(FAST, t)).toBeNull();
    }
    expect(g.level).toBe(2);
    expect(g.levelIndexValue).toBe(0);
  });

  it("steps down after sustained breach, not on a single spike", () => {
    const g = new QualityGovernor();
    let t = 0;
    // Warm up with fast frames.
    for (let i = 0; i < 60; i++) {
      t += 16;
      g.sample(FAST, t);
    }
    // One slow frame must not trigger.
    t += 16;
    expect(g.sample(SLOW, t)).toBeNull();
    // Sustained breach past breachMs (2000 ms) → step down.
    let stepped: number | null = null;
    for (let i = 0; i < 200 && stepped === null; i++) {
      t += 16;
      stepped = g.sample(SLOW, t);
    }
    expect(stepped).toBe(1.5);
    expect(g.levelIndexValue).toBe(1);
  });

  it("walks the full DPR ladder under persistent load", () => {
    const g = new QualityGovernor();
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 16;
      g.sample(FAST, t);
    }
    const seen: number[] = [];
    for (let i = 0; i < 3000 && g.levelIndexValue < 3; i++) {
      t += 16;
      const lvl = g.sample(SLOW, t);
      if (lvl !== null) seen.push(lvl);
    }
    expect(g.levelIndexValue).toBe(3);
    expect(g.level).toBe(1);
    expect(seen).toEqual([1.5, 1.25, 1]);
  });

  it("steps back up only after recoverMs of headroom", () => {
    const g = new QualityGovernor(DEFAULT_GOVERNOR_CONFIG, 2); // DPR 1.25
    let t = 0;
    // Clean fast window — p95 already under budget, so the recover timer
    // starts on the first sample. It must still wait the full recoverMs.
    let stepped: number | null = null;
    for (let i = 0; i < 700 && stepped === null; i++) {
      t += 16;
      stepped = g.sample(FAST, t);
    }
    // 700 frames ≈ 11.2 s > recoverMs (10 s) → one step up to DPR 1.5.
    expect(stepped).toBe(1.5);
    expect(g.levelIndexValue).toBe(1);
  });

  it("does not oscillate: headroom shorter than recoverMs never steps up", () => {
    const g = new QualityGovernor();
    let t = 0;
    // Warm up fast so the window is clean.
    for (let i = 0; i < 60; i++) {
      t += 16;
      g.sample(FAST, t);
    }
    // Drive down one rung with sustained breach.
    let stepped: number | null = null;
    for (let i = 0; i < 400 && stepped === null; i++) {
      t += 16;
      stepped = g.sample(SLOW, t);
    }
    expect(stepped).toBe(1.5);
    // ~8 s of headroom — under recoverMs (10 s) — then breach again.
    for (let i = 0; i < 500; i++) {
      t += 16;
      g.sample(FAST, t);
    }
    for (let i = 0; i < 400; i++) {
      t += 16;
      g.sample(SLOW, t);
    }
    // Never returned to the top rung; breach resumed from rung 1.
    expect(g.levelIndexValue).toBeGreaterThanOrEqual(1);
    expect(g.level).not.toBe(2);
  });

  it("setLevel forces a rung and resets timers", () => {
    const g = new QualityGovernor();
    expect(g.setLevel(2)).toBe(1.25);
    expect(g.setLevel(2)).toBeNull();
    expect(g.level).toBe(1.25);
  });
});
