import { describe, it, expect } from "vitest";
import {
  createMotionHistory,
  phaseLagChain,
  resetMotionHistory,
  resolveMotion,
  REST_MOTION,
  type MotionHistory,
  type MotionInput,
} from "./useMotionDriver";

/**
 * Integration tests for the frame-loop driver that composes the motion
 * vocabulary (spec: docs/knowledge/gemini-motion-design-2026-10-02/README.md
 * §"Suggested implementation order", steps 2-4).
 */

const SILENCE: MotionInput = {
  nowSec: 0,
  dtSec: 1 / 60,
  bpm: 120,
  bass: 0,
  mid: 0,
  high: 0,
  section: "VERSE",
};

/** Run `frames` frames of constant input and return the final state. */
function run(history: MotionHistory, base: MotionInput, frames: number): ReturnType<typeof resolveMotion> {
  let state = resolveMotion(base, history);
  for (let i = 1; i < frames; i++) {
    state = resolveMotion({ ...base, nowSec: base.nowSec + i * base.dtSec }, history);
  }
  return state;
}

describe("resolveMotion — silence", () => {
  it("is completely still at rest", () => {
    // The bug this guards: silence used to produce a *maximum* squash, because
    // a time-since-impact curve is at its peak at t=0. Audio-reactive visuals
    // must be inert when nothing is playing (D14 rule 2).
    const state = run(createMotionHistory(), SILENCE, 60);
    expect(state.scale).toEqual([1, 1, 1]);
    expect(state.cameraOffset).toEqual([0, 0, 0]);
    expect(state.impulse).toBe(0);
    expect(state.orbitAngle).toBe(0);
    expect(state.swell).toBe(0);
    expect(state.motionMultiplier).toBe(1);
  });

  it("stays still under a constant non-zero level", () => {
    // The jittering-oscilloscope tell: a flat 0.5 must not drive anything.
    const state = run(createMotionHistory(), { ...SILENCE, bass: 0.5, mid: 0.5 }, 60);
    expect(state.impulse).toBe(0);
    expect(state.scale).toEqual([1, 1, 1]);
  });

  it("does not report a section driver for silence", () => {
    expect(run(createMotionHistory(), SILENCE, 30).staging).toEqual(["none", "none", "none"]);
  });
});

describe("resolveMotion — transients", () => {
  it("deforms the mesh on a hard kick", () => {
    const history = createMotionHistory();
    run(history, SILENCE, 30);
    const kick = resolveMotion({ ...SILENCE, nowSec: 31 / 60, bass: 1 }, history);
    expect(kick.impulse).toBeGreaterThan(0);
    // Anisotropic: compressed on Y, flared on X/Z. Never a uniform zoom.
    expect(kick.scale[1]).toBeLessThan(1);
    expect(kick.scale[0]).toBeGreaterThan(1);
    expect(kick.scale[0]).toBeCloseTo(kick.scale[2], 9);
  });

  it("conserves volume on every frame of a kick", () => {
    const history = createMotionHistory();
    run(history, SILENCE, 30);
    for (let i = 0; i < 40; i++) {
      const s = resolveMotion({ ...SILENCE, nowSec: (30 + i) / 60, bass: 1 }, history);
      const [x, y, z] = s.scale;
      expect(x * y * z).toBeCloseTo(1, 6);
    }
  });

  it("returns to rest after the transient", () => {
    const history = createMotionHistory();
    run(history, SILENCE, 30);
    resolveMotion({ ...SILENCE, nowSec: 31 / 60, bass: 1 }, history);
    const after = run(history, { ...SILENCE, nowSec: 32 / 60 }, 60);
    expect(after.scale).toEqual([1, 1, 1]);
    expect(after.impulse).toBe(0);
  });

  it("gives the loudest onset the global staging channel", () => {
    const history = createMotionHistory();
    run(history, SILENCE, 30);
    const s = resolveMotion({ ...SILENCE, nowSec: 31 / 60, bass: 1, mid: 0.2 }, history);
    expect(s.staging.filter((c) => c === "global")).toHaveLength(1);
    expect(s.staging[0]).toBe("global");
  });
});

describe("resolveMotion — section budgeting", () => {
  it("lets a verse hit harder than a breakdown", () => {
    const hit = (section: string) => {
      const history = createMotionHistory();
      run(history, SILENCE, 30);
      return resolveMotion(
        { ...SILENCE, nowSec: 31 / 60, bass: 1, section },
        history,
      ).impulse;
    };
    expect(hit("VERSE")).toBeGreaterThan(hit("BREAKDOWN"));
    expect(hit("DROP")).toBeGreaterThan(hit("VERSE"));
  });

  it("reports the section's easing profile", () => {
    const s = resolveMotion({ ...SILENCE, section: "PRE-CHORUS" }, createMotionHistory());
    expect(s.profile.label).toContain("easeInQuad");
  });

  it("damps transients under reduced motion", () => {
    const withReduced = () => {
      const history = createMotionHistory();
      run(history, SILENCE, 30);
      return resolveMotion({ ...SILENCE, nowSec: 31 / 60, bass: 1 }, history, {
        reducedMotion: true,
      }).impulse;
    };
    const without = () => {
      const history = createMotionHistory();
      run(history, SILENCE, 30);
      return resolveMotion({ ...SILENCE, nowSec: 31 / 60, bass: 1 }, history).impulse;
    };
    expect(withReduced()).toBeLessThan(without());
  });
});

describe("resolveMotion — lookahead moves", () => {
  it("winds up before a known downbeat", () => {
    const beat = { timeSec: 4.0 };
    const near = resolveMotion(
      { ...SILENCE, nowSec: 3.9, nextBeat: beat },
      createMotionHistory(),
    );
    const far = resolveMotion(
      { ...SILENCE, nowSec: 2.0, nextBeat: beat },
      createMotionHistory(),
    );
    expect(near.anticipation).toBeLessThan(far.anticipation);
  });

  it("is inert with no lookahead events", () => {
    const s = resolveMotion({ ...SILENCE }, createMotionHistory());
    expect(s.anticipation).toBe(1);
    expect(s.motionMultiplier).toBe(1);
  });

  it("clamps every kinematic channel during the pre-drop vacuum", () => {
    const history = createMotionHistory();
    run(history, SILENCE, 30);
    const drop = { timeSec: 10.0 };
    // 120 BPM, 1 beat of lead => the freeze covers 9.5 s .. 10.0 s, and
    // easeInOutSine reaches a *full* dead stop exactly at the drop, ramping in
    // over the preceding half-beat. Sample the drop instant itself.
    const frozen = resolveMotion(
      { ...SILENCE, bass: 0.9, nextDrop: drop, nowSec: drop.timeSec },
      history,
    );
    expect(frozen.motionMultiplier).toBe(0);
    expect(frozen.scale).toEqual([1, 1, 1]);
    // The camera must stop too — a frozen scene that keeps drifting reads as a
    // bug rather than as deliberate negative space.
    expect(frozen.cameraOffset).toEqual([0, 0, 0]);
    expect(frozen.exposureEV).toBeLessThan(0);
  });

  it("ramp-freezes progressively across the lead window", () => {
    // The ramp is what distinguishes a deliberate vacuum from a dropped frame.
    const drop = { timeSec: 10.0 };
    const at = (t: number) =>
      resolveMotion({ ...SILENCE, nextDrop: drop, nowSec: t }, createMotionHistory())
        .motionMultiplier;
    expect(at(9.5)).toBeCloseTo(1, 6);
    const mid = at(9.75);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0);
    expect(at(9.99)).toBeLessThan(mid);
  });

  it("releases the vacuum on the drop itself", () => {
    const history = createMotionHistory();
    const drop = { timeSec: 10.0 };
    const after = resolveMotion({ ...SILENCE, bass: 0.9, nextDrop: drop, nowSec: 10.02 }, history);
    expect(after.motionMultiplier).toBe(1);
  });
});

describe("resolveMotion — clock handling", () => {
  it("resets its history on a seek", () => {
    // Without this, seeking backwards resumes with an envelope latched at full
    // amplitude and the scene lurches.
    const history = createMotionHistory();
    run(history, SILENCE, 30);
    resolveMotion({ ...SILENCE, nowSec: 31 / 60, bass: 1 }, history);
    const afterSeek = resolveMotion({ ...SILENCE, nowSec: 5, bass: 1 }, history);
    expect(afterSeek.impulse).toBe(0);
  });

  it("survives a large forward jump without NaN", () => {
    const s = resolveMotion({ ...SILENCE, nowSec: 600, bass: 1 }, createMotionHistory());
    for (const v of [...s.scale, ...s.cameraOffset, s.fov, s.impulse]) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it("survives a zero or negative frame delta", () => {
    for (const dtSec of [0, -1, Number.NaN]) {
      const s = resolveMotion({ ...SILENCE, dtSec, bass: 1 }, createMotionHistory());
      expect(Number.isNaN(s.impulse)).toBe(false);
    }
  });

  it("bounds its phase-lag history", () => {
    const history = createMotionHistory();
    for (let i = 0; i < 500; i++) {
      resolveMotion({ ...SILENCE, nowSec: i / 60, bass: i % 3 === 0 ? 1 : 0.4 }, history);
    }
    expect(history.phaseLag.length).toBeLessThanOrEqual(64);
  });
});

describe("phaseLagChain", () => {
  it("returns a fixed-length chain", () => {
    const history = createMotionHistory();
    run(history, SILENCE, 60);
    expect(phaseLagChain(history)).toHaveLength(4);
    expect(phaseLagChain(history, 6)).toHaveLength(6);
  });

  it("clears on reset", () => {
    const history = createMotionHistory();
    run(history, SILENCE, 60);
    resetMotionHistory(history);
    expect(history.phaseLag).toHaveLength(0);
    expect(phaseLagChain(history)).toEqual([0, 0, 0, 0]);
  });
});

describe("REST_MOTION", () => {
  it("is a complete neutral pose", () => {
    // Every channel must be a real number: a viz style destructuring an
    // undefined here gets NaN geometry rather than a visible no-op.
    for (const [key, value] of Object.entries(REST_MOTION)) {
      if (key === "staging" || key === "profile") continue;
      if (Array.isArray(value)) {
        for (const v of value) expect(Number.isFinite(v)).toBe(true);
      } else {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});