import { describe, it, expect } from "vitest";
import {
  buildShaderMotionInput,
  createMotionHistory,
  resolveMotion,
} from "./motion/useMotionDriver";
import type { SpectralFrame } from "./useSpectralTimeline";

/**
 * The driver-composition test plan 2.7 requires alongside the
 * motion module's own 151 assertions: it pins the *wiring* —
 * that the shader loop's mapping from this repo's audio onto
 * `MotionInput` (see `motion/README.md`) feeds the driver
 * correctly, and that a band onset actually moves the camera
 * offset the loop applies to `u_camera_offset`.
 *
 * The mapping itself lives in `buildShaderMotionInput` so this
 * test executes the real path rather than a copy of it.
 */

const FRAME: SpectralFrame = {
  frame: 0,
  time: 0,
  sub: 0,
  mid: 0,
  high: 0,
  transient: 0,
  centroid: 0,
  rms: 0,
};

describe("buildShaderMotionInput — the mapping", () => {
  it("maps the spectral bands onto bass/mid/high", () => {
    const input = buildShaderMotionInput({
      nowSec: 10,
      dtSec: 1 / 60,
      bpm: 100,
      spectral: { ...FRAME, sub: 0.2, mid: 0.5, high: 0.9 },
      section: "PRE-CHORUS",
      beatTimes: [],
    });
    expect(input.bass).toBe(0.2);
    expect(input.mid).toBe(0.5);
    expect(input.high).toBe(0.9);
    expect(input.bpm).toBe(100);
    expect(input.section).toBe("PRE-CHORUS");
  });

  it("derives the next-beat lookahead from the analyzed grid", () => {
    // 100 BPM → beats every 0.6 s. At t=1.0 the next beat is 1.2.
    const input = buildShaderMotionInput({
      nowSec: 1.0,
      dtSec: 1 / 60,
      bpm: 100,
      spectral: FRAME,
      section: null,
      beatTimes: [0, 0.6, 1.2, 1.8],
    });
    expect(input.nextBeat).toEqual({ timeSec: 1.2 });
  });

  it("yields no lookahead on an unanalyzed track (empty grid)", () => {
    const input = buildShaderMotionInput({
      nowSec: 1.0,
      dtSec: 1 / 60,
      bpm: 120,
      spectral: FRAME,
      section: null,
      beatTimes: [],
    });
    expect(input.nextBeat).toBeNull();
  });

  it("yields no lookahead once the grid is exhausted", () => {
    const input = buildShaderMotionInput({
      nowSec: 99,
      dtSec: 1 / 60,
      bpm: 120,
      spectral: FRAME,
      section: null,
      beatTimes: [0, 0.5, 1.0],
    });
    expect(input.nextBeat).toBeNull();
  });

  it("tolerates a null spectral frame (silence before first analysis)", () => {
    const input = buildShaderMotionInput({
      nowSec: 0,
      dtSec: 1 / 60,
      bpm: 120,
      spectral: null,
      section: "VERSE",
      beatTimes: [0, 0.5],
    });
    expect(input.bass).toBe(0);
    expect(input.mid).toBe(0);
    expect(input.high).toBe(0);
  });
});

describe("shader motion composition — onset moves the camera", () => {
  it("a kick onset produces a non-zero camera offset", () => {
    // The composition the rAF loop performs each frame:
    // buildShaderMotionInput → resolveMotion. A hard bass
    // onset must move the camera-offset channel, or the
    // wiring is dead (the exact failure 2.7 fixes: the
    // vocabulary existed with zero consumers).
    const history = createMotionHistory();
    // Prime the triggers with silence so the first frame's
    // derivative is measured against a real baseline.
    for (let i = 0; i < 30; i++) {
      resolveMotion(
        buildShaderMotionInput({
          nowSec: (i / 60),
          dtSec: 1 / 60,
          bpm: 120,
          spectral: FRAME,
          section: "VERSE",
          beatTimes: [],
        }),
        history,
      );
    }
    const kick = resolveMotion(
      buildShaderMotionInput({
        nowSec: 0.5,
        dtSec: 1 / 60,
        bpm: 120,
        spectral: { ...FRAME, sub: 1, mid: 0.1, high: 0.1 },
        section: "VERSE",
        beatTimes: [],
      }),
      history,
    );
    expect(kick.impulse).toBeGreaterThan(0);
    // The camera offset is the channel the shader consumes;
    // a kick must deflect at least one axis.
    const [x, y] = kick.cameraOffset;
    expect(Math.abs(x) + Math.abs(y)).toBeGreaterThan(0);
  });

  it("silence leaves the camera offset at rest", () => {
    const history = createMotionHistory();
    let state = resolveMotion(
      buildShaderMotionInput({
        nowSec: 0,
        dtSec: 1 / 60,
        bpm: 120,
        spectral: FRAME,
        section: "VERSE",
        beatTimes: [],
      }),
      history,
    );
    for (let i = 1; i < 120; i++) {
      state = resolveMotion(
        buildShaderMotionInput({
          nowSec: i / 60,
          dtSec: 1 / 60,
          bpm: 120,
          spectral: FRAME,
          section: "VERSE",
          beatTimes: [],
        }),
        history,
      );
    }
    expect(state.cameraOffset).toEqual([0, 0, 0]);
  });

  it("a analyzed grid arms anticipation before the next beat", () => {
    // With a real grid, the frame just before a beat carries a
    // nextBeat lookahead, which anticipation-contract reads.
    // 120 BPM → 0.5 s beats; at t=0.45 the next beat (0.5) is
    // 0.05 s away — inside the 2-beat lead window.
    const input = buildShaderMotionInput({
      nowSec: 0.45,
      dtSec: 1 / 60,
      bpm: 120,
      spectral: FRAME,
      section: "VERSE",
      beatTimes: [0, 0.5, 1.0],
    });
    expect(input.nextBeat).toEqual({ timeSec: 0.5 });
    const state = resolveMotion(input, createMotionHistory());
    // Anticipation winds the scale down inside the lead window.
    expect(state.anticipation).toBeLessThan(1);
  });
});
