import { describe, it, expect } from "vitest";
import {
  beginCameraTransition,
  computeModePose,
  isTransitionActive,
  sampleCameraTransition,
  CAMERA_TRANSITION_SEC,
} from "./cameraTransitions";
import { ease } from "./easing";

/**
 * Plan F1 acceptance: "mode switch produces no visible
 * pop (screenshot before/after at blend midpoint shows
 * interpolated pose); drag during blend cancels it".
 * These tests pin the blend math and the per-mode pose
 * source the render loop drives from — including the F3
 * dolly migration off linear accumulation.
 */

const FROM = {
  position: [0, 3, 8] as [number, number, number],
  target: [0, 0.5, 0] as [number, number, number],
};
const TARGET = {
  position: [8, 3, 0] as [number, number, number],
  target: [0, 0.5, 0] as [number, number, number],
};

describe("camera transition blend", () => {
  it("copies the from-pose so the caller can keep mutating it", () => {
    const mutable = {
      position: [1, 2, 3] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
    };
    const state = beginCameraTransition(mutable, 10);
    mutable.position[0] = 99;
    expect(state.from.position[0]).toBe(1);
  });

  it("returns the from-pose at the start of the blend", () => {
    const state = beginCameraTransition(FROM, 10);
    const pose = sampleCameraTransition(state, 10, TARGET);
    expect(pose).not.toBeNull();
    expect(pose!.position).toEqual(FROM.position);
    expect(pose!.target).toEqual(FROM.target);
  });

  it("returns null once the blend duration has elapsed", () => {
    const state = beginCameraTransition(FROM, 10);
    // Past the boundary by a hair: the exact boundary
    // value can land a float-ulp short of the duration
    // and return one final (essentially-target) pose.
    expect(
      sampleCameraTransition(
        state,
        10 + CAMERA_TRANSITION_SEC + 1e-6,
        TARGET,
      ),
    ).toBeNull();
    expect(
      sampleCameraTransition(state, 10 + CAMERA_TRANSITION_SEC + 1, TARGET),
    ).toBeNull();
  });

  it("blends the midpoint with the travel-balanced anchor", () => {
    const state = beginCameraTransition(FROM, 10);
    const mid = 10 + CAMERA_TRANSITION_SEC / 2;
    const pose = sampleCameraTransition(state, mid, TARGET);
    const k = ease("travel-balanced", 0.5);
    expect(pose!.position[0]).toBeCloseTo(0 + (8 - 0) * k, 10);
    expect(pose!.position[2]).toBeCloseTo(8 + (0 - 8) * k, 10);
  });

  it("clamps a negative elapsed (clock reset) to the blend start", () => {
    const state = beginCameraTransition(FROM, 10);
    const pose = sampleCameraTransition(state, 5, TARGET);
    expect(pose!.position).toEqual(FROM.position);
  });

  it("honours a custom duration", () => {
    const state = beginCameraTransition(FROM, 10, 2);
    expect(isTransitionActive(state, 11.9)).toBe(true);
    expect(isTransitionActive(state, 12.1)).toBe(false);
    expect(sampleCameraTransition(state, 12, TARGET)).toBeNull();
  });

  it("rejects a non-positive duration with the default", () => {
    const state = beginCameraTransition(FROM, 10, 0);
    expect(state.durationSec).toBe(CAMERA_TRANSITION_SEC);
  });

  it("isTransitionActive tracks the blend window", () => {
    const state = beginCameraTransition(FROM, 10);
    expect(isTransitionActive(null, 10)).toBe(false);
    expect(isTransitionActive(state, 10)).toBe(true);
    expect(isTransitionActive(state, 10 + CAMERA_TRANSITION_SEC - 0.01)).toBe(
      true,
    );
    expect(isTransitionActive(state, 10 + CAMERA_TRANSITION_SEC + 1e-6)).toBe(
      false,
    );
  });
});

describe("computeModePose", () => {
  const CURRENT = [1.5, 2.5, 3.5] as [number, number, number];

  it("orbit controls every axis from the trajectory", () => {
    const pose = computeModePose({
      mode: "orbit",
      elapsedSec: 0,
      currentPosition: CURRENT,
      shakeX: 0,
      shakeY: 0,
    });
    // a = 0: sin(0)=0, cos(0)=1
    expect(pose.position[0]).toBeCloseTo(0, 10);
    expect(pose.position[1]).toBeCloseTo(3, 10);
    expect(pose.position[2]).toBeCloseTo(8, 10);
    expect(pose.target).toEqual([0, 0.5, 0]);
  });

  it("dolly eases its cycle on travel-balanced (F3 migration)", () => {
    // At the cycle midpoint the linear pose would be
    // z = 10 - 0.5 * 6 = 7; the eased pose must differ
    // (travel-balanced(0.5) != 0.5 — it is an S-curve).
    const pose = computeModePose({
      mode: "dolly",
      elapsedSec: 4, // (4 % 8) / 8 = 0.5
      currentPosition: CURRENT,
      shakeX: 0,
      shakeY: 0,
    });
    const k = ease("travel-balanced", 0.5);
    expect(k).not.toBeCloseTo(0.5, 10);
    expect(pose.position[2]).toBeCloseTo(10 - k * 6, 10);
    expect(pose.position[1]).toBeCloseTo(3 - k * 0.8, 10);
  });

  it("dolly leaves the x axis to the live position", () => {
    const pose = computeModePose({
      mode: "dolly",
      elapsedSec: 2,
      currentPosition: CURRENT,
      shakeX: 0,
      shakeY: 0,
    });
    expect(pose.position[0]).toBe(CURRENT[0]);
  });

  it("dolly wraps its 8 s cycle", () => {
    const a = computeModePose({
      mode: "dolly",
      elapsedSec: 0,
      currentPosition: CURRENT,
      shakeX: 0,
      shakeY: 0,
    });
    const b = computeModePose({
      mode: "dolly",
      elapsedSec: 8,
      currentPosition: CURRENT,
      shakeX: 0,
      shakeY: 0,
    });
    expect(b.position[2]).toBeCloseTo(a.position[2], 10);
    expect(b.position[1]).toBeCloseTo(a.position[1], 10);
  });

  it("handheld and static carry the live position", () => {
    for (const mode of ["handheld", "static"] as const) {
      const pose = computeModePose({
        mode,
        elapsedSec: 100,
        currentPosition: CURRENT,
        shakeX: 0,
        shakeY: 0,
      });
      expect(pose.position).toEqual(CURRENT);
      expect(pose.target).toEqual([0, 0.5, 0]);
    }
  });
});
