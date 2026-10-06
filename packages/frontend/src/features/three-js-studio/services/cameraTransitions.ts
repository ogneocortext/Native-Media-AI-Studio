/**
 * Eased camera transitions (three-js-studio plan F1).
 *
 * Before this module, `useThreeScene.ts` applied the orbit /
 * dolly / handheld trajectories continuously, so switching
 * `cameraMode` was a hard cut — the camera teleported from
 * one trajectory to the next. This module blends position +
 * look-target from the old mode's pose onto the new mode's
 * live pose over ~600 ms using the `travel-balanced` anchor
 * (S-curve ease-in-out, the research doc's camera-move curve).
 *
 * The blend targets a *moving* pose: the new mode's trajectory
 * is evaluated at the current elapsed time each frame, so the
 * camera converges onto the new trajectory rather than onto a
 * frozen snapshot of it. Modes that don't control every axis
 * (dolly leaves x, handheld is a free walk) read the current
 * camera position for their uncontrolled axes, so those axes
 * persist across the blend by construction.
 *
 * Pure and allocation-light: `beginCameraTransition` copies the
 * from-pose once; `sampleCameraTransition` allocates one pose
 * object per frame while a transition is active (600 ms), then
 * returns `null` so the loop drives the camera directly.
 *
 * User drag/orbit input cancels the blend immediately — the
 * hook wires OrbitControls' `start` event to drop the state,
 * handing control back to the user.
 */

import { ease } from "./easing";
import type { CameraMode } from "../types";

/** A camera pose: world position + look-target. */
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Active transition state. `from` is the pose captured at the
 *  mode switch; `startSec` is in the render loop's clock
 *  (THREE.Timer elapsed seconds), never the wall clock. */
export interface CameraTransitionState {
  from: CameraPose;
  startSec: number;
  durationSec: number;
}

/** Default blend duration (~600 ms, per the plan). */
export const CAMERA_TRANSITION_SEC = 0.6;

/**
 * Begin a transition from `from` (the pose at the mode
 * switch). `nowSec` is the loop clock at the moment of the
 * switch. The from-pose is copied, so the caller can keep
 * mutating its own pose object.
 */
export function beginCameraTransition(
  from: CameraPose,
  nowSec: number,
  durationSec = CAMERA_TRANSITION_SEC,
): CameraTransitionState {
  return {
    from: {
      position: [from.position[0], from.position[1], from.position[2]],
      target: [from.target[0], from.target[1], from.target[2]],
    },
    startSec: nowSec,
    durationSec: durationSec > 0 ? durationSec : CAMERA_TRANSITION_SEC,
  };
}

/**
 * Sample the blend toward `target` (the new mode's live pose).
 *
 * Returns the interpolated pose while the transition is in
 * flight, or `null` once it has completed — the caller should
 * then drive the camera directly and drop the state. A negative
 * elapsed (a clock reset) clamps to the start of the blend
 * rather than running it backwards.
 */
export function sampleCameraTransition(
  state: CameraTransitionState,
  nowSec: number,
  target: CameraPose,
): CameraPose | null {
  const raw = (nowSec - state.startSec) / state.durationSec;
  if (raw >= 1) return null;
  const t = raw < 0 ? 0 : raw;
  const k = ease("travel-balanced", t);
  const fp = state.from.position;
  const tp = target.position;
  const ft = state.from.target;
  const tt = target.target;
  return {
    position: [
      fp[0] + (tp[0] - fp[0]) * k,
      fp[1] + (tp[1] - fp[1]) * k,
      fp[2] + (tp[2] - fp[2]) * k,
    ],
    target: [
      ft[0] + (tt[0] - ft[0]) * k,
      ft[1] + (tt[1] - ft[1]) * k,
      ft[2] + (tt[2] - ft[2]) * k,
    ],
  };
}

/** True while a transition is still in flight. */
export function isTransitionActive(
  state: CameraTransitionState | null,
  nowSec: number,
): boolean {
  if (!state) return false;
  return nowSec - state.startSec < state.durationSec;
}

// ----------------------------------------------------------------------------
// Per-mode trajectory poses (F1 + F3)
// ----------------------------------------------------------------------------

/** Input for `computeModePose`. `currentPosition` is the
 *  camera's live position — modes that don't control
 *  every axis (dolly leaves x, handheld is a free walk)
 *  read it for their uncontrolled axes, so those axes
 *  persist across a blend by construction. */
export interface ModePoseInput {
  mode: CameraMode;
  /** Render-loop clock (THREE.Timer elapsed seconds). */
  elapsedSec: number;
  currentPosition: [number, number, number];
  /** Per-frame camera-shake offsets, applied on the
   *  controlled axes only. */
  shakeX: number;
  shakeY: number;
}

/**
 * The pose a camera mode targets at `elapsedSec`.
 *
 * Extracted from `useThreeScene.ts`'s render loop so the
 * transition blend (above) and the direct drive share one
 * pose source — the blend converges onto the *live*
 * trajectory, not a frozen snapshot of it.
 *
 * The dolly cycle is the F3 migration off linear
 * accumulation: its 8 s cycle used to be
 * `10 - t * 6` (constant velocity, so the wrap-back to
 * the start teleported mid-flight). It now runs on the
 * `travel-balanced` S-curve, easing in and out so the
 * wrap happens at near-zero velocity.
 */
export function computeModePose(input: ModePoseInput): CameraPose {
  const { mode, elapsedSec, currentPosition, shakeX, shakeY } = input;
  switch (mode) {
    case "orbit": {
      const a = elapsedSec * 0.25;
      return {
        position: [
          Math.sin(a) * 8 + shakeX,
          3 + Math.sin(a * 0.5) * 0.6 + shakeY,
          Math.cos(a) * 8,
        ],
        target: [0, 0.5, 0],
      };
    }
    case "dolly": {
      const t = (elapsedSec % 8) / 8;
      const k = ease("travel-balanced", t);
      return {
        position: [
          currentPosition[0],
          3 - k * 0.8 + shakeY,
          10 - k * 6,
        ],
        target: [0, 0.5, 0],
      };
    }
    case "handheld":
    default: {
      // Free walk / static: the loop accumulates the walk
      // on the live position before sampling, so the pose
      // simply carries it (and the look target is fixed).
      return {
        position: [
          currentPosition[0],
          currentPosition[1],
          currentPosition[2],
        ],
        target: [0, 0.5, 0],
      };
    }
  }
}
