import { describe, it, expect } from "vitest";
import {
  assignStaging,
  anticipationContract,
  DEFAULT_ANTICIPATION,
  DEFAULT_SQUASH,
  DEFAULT_SUB_BASS_SWELL,
  DEFAULT_WHIP,
  focalBreathing,
  frequencyDispersionWhip,
  ImpulseTrigger,
  isStutterActive,
  orbitalRatchet,
  phaseLagElement,
  PhaseLagChain,
  preDropFreeze,
  secondsPerBeat,
  sectionMotionProfile,
  snareBackpedal,
  squashImpact,
  subBassSwell,
  shouldGateDetail,
  shouldGateMotion,
  shutterHoldTime,
  type Vec3,
} from "./motionMoves";

/**
 * Spec: docs/knowledge/gemini-motion-design-2026-10-02/README.md §5.
 *
 * These assertions are transcribed from the spec's defaults and claims, so a
 * change to the spec that is not mirrored here shows up as a failing test
 * rather than as silent drift between the doc and the code.
 */

const volumeOf = ([x, y, z]: Vec3) => x * y * z;

describe("secondsPerBeat", () => {
  it("converts tempo correctly", () => {
    expect(secondsPerBeat(120)).toBeCloseTo(0.5, 6);
    expect(secondsPerBeat(60)).toBeCloseTo(1, 6);
  });

  it("falls back rather than returning Infinity on bad tempo", () => {
    // 60/0 is Infinity, which becomes NaN two calls later. A tempo of 0 must
    // not be able to do that.
    for (const bad of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Number.isFinite(secondsPerBeat(bad))).toBe(true);
    }
  });
});

describe("staging / driver dominance", () => {
  it("gives exactly one onset the global channel", () => {
    // Spec: "never two stems driving global spatial vectors at once".
    const channels = assignStaging([{ energy: 0.9 }, { energy: 0.5 }, { energy: 0.2 }]);
    expect(channels.filter((c) => c === "global")).toHaveLength(1);
  });

  it("gives the loudest onset the global channel", () => {
    // Ranked loudest-first: 0.9 -> global, 0.5 -> local, 0.2 -> shader, then
    // mapped back to the caller's original array order.
    expect(assignStaging([{ energy: 0.2 }, { energy: 0.9 }, { energy: 0.5 }])).toEqual([
      "shader",
      "global",
      "local",
    ]);
  });

  it("refuses a fourth simultaneous onset entirely", () => {
    // The ladder is only three deep; a fourth simultaneous hit gets no channel
    // rather than being promoted into global motion.
    const channels = assignStaging([
      { energy: 0.9 },
      { energy: 0.8 },
      { energy: 0.7 },
      { energy: 0.6 },
    ]);
    expect(channels[3]).toBe("none");
    expect(channels.filter((c) => c === "global")).toHaveLength(1);
  });

  it("does not promote a silent onset", () => {
    expect(assignStaging([{ energy: 0 }, { energy: 0.9 }])).toEqual(["none", "global"]);
  });

  it("returns nothing for no onsets", () => {
    expect(assignStaging([])).toEqual([]);
  });
});

describe("1. anticipation-contract", () => {
  const beat = { timeSec: 4.0 };

  it("is a no-op with no lookahead event", () => {
    // Degrading to rest rather than guessing is deliberate: the frontend cannot
    // assume a future beat marker exists.
    expect(anticipationContract(3.0, null)).toEqual({ scale: 1, orbitSpeed: 1, snapped: false });
  });

  it("is a no-op outside the lead window", () => {
    // 120 BPM -> 0.5 s/beat, 2 beats of lead = 1.0 s. At t=1.5 the beat is 2.5 s away.
    expect(anticipationContract(1.5, { timeSec: 4.0 }).scale).toBe(1);
  });

  it("winds down toward minScale as the beat approaches", () => {
    const far = anticipationContract(3.0, beat).scale;
    const near = anticipationContract(3.9, beat).scale;
    expect(near).toBeLessThan(far);
    expect(near).toBeGreaterThanOrEqual(DEFAULT_ANTICIPATION.minScale);
  });

  it("decelerates the orbit as it winds up", () => {
    // At the end of the wind-up (one frame before the beat) the orbit must be
    // at (or extremely near) the dampened factor, and clearly below 1.
    const atBottom = anticipationContract(3.999, beat).orbitSpeed;
    expect(atBottom).toBeLessThan(0.25);
    expect(atBottom).toBeCloseTo(DEFAULT_ANTICIPATION.orbitDampenFactor, 2);
    // Monotonically decreasing across the wind-up.
    let previous = Infinity;
    for (let t = 3.0; t < 4.0; t += 0.02) {
      const speed = anticipationContract(t, beat).orbitSpeed;
      expect(speed).toBeLessThanOrEqual(previous + 1e-9);
      previous = speed;
    }
  });

  it("snaps back out to rest within snapOutDurationMs", () => {
    const justAfter = anticipationContract(4.01, beat);
    expect(justAfter.snapped).toBe(true);
    expect(justAfter.scale).toBeGreaterThan(DEFAULT_ANTICIPATION.minScale);
    // Past the release window it is fully at rest and no longer "snapping".
    const later = anticipationContract(4.0 + DEFAULT_ANTICIPATION.snapOutDurationMs / 1000 + 0.01, beat);
    expect(later.snapped).toBe(false);
    expect(later.scale).toBeCloseTo(1, 6);
  });

  it("never exceeds minScale during the wind-up", () => {
    for (let t = 3.0; t < 4.0; t += 0.01) {
      expect(anticipationContract(t, beat).scale).toBeGreaterThanOrEqual(
        DEFAULT_ANTICIPATION.minScale - 1e-9,
      );
    }
  });
});

describe("2. squash-impact", () => {
  it("is anisotropic, not a uniform zoom", () => {
    // The amateur tell this move exists to fix: uniform XYZ scale on a kick
    // reads as a 2D camera zoom, not as mass.
    const [, y, ] = squashImpact(0);
    const [x, , z] = squashImpact(0);
    expect(x).toBeCloseTo(z, 9);
    expect(y).not.toBeCloseTo(x, 3);
  });

  it("conserves volume at the moment of impact", () => {
    // x·y·z ≈ 1 is the spec's invariant, asserted rather than trusted.
    expect(volumeOf(squashImpact(0))).toBeCloseTo(1, 9);
  });

  it("conserves volume throughout the settle", () => {
    for (let t = 0; t < 0.6; t += 0.005) {
      expect(volumeOf(squashImpact(t))).toBeCloseTo(1, 6);
    }
  });

  it("compresses on Y at t=0 by the spec default", () => {
    expect(squashImpact(0)[1]).toBeCloseTo(DEFAULT_SQUASH.compressionY, 9);
  });

  it("rings back through rest toward neutral", () => {
    // Underdamped spring: it must overshoot past 1, which is what separates
    // this from a plain ease-out.
    let sawOvershoot = false;
    for (let t = 0.01; t < 0.6; t += 0.002) {
      if (squashImpact(t)[1] > 1.0) {
        sawOvershoot = true;
        break;
      }
    }
    expect(sawOvershoot).toBe(true);
  });

  it("settles back to neutral", () => {
    const [, y] = squashImpact(0.6);
    expect(y).toBeCloseTo(1, 2);
  });

  it("never returns NaN", () => {
    for (const t of [-1, 0, 1e6, Number.NaN]) {
      for (const v of squashImpact(t)) expect(Number.isNaN(v)).toBe(false);
    }
  });
});

describe("3. pre-drop-freeze", () => {
  const drop = { timeSec: 10.0 };

  it("does nothing without a known drop", () => {
    // Freezing forever because the drop is unknown would be far worse than not
    // freezing at all.
    expect(preDropFreeze(9.5, null)).toEqual({
      motionMultiplier: 1,
      exposureEV: 0,
      particleVelocityClamp: 1,
    });
  });

  it("does nothing outside the lead window", () => {
    // 120 BPM, 1 beat lead = 0.5 s. At t=8 the drop is 2 s away.
    expect(preDropFreeze(8.0, drop).motionMultiplier).toBe(1);
  });

  it("clamps motion to a dead stop right before the drop", () => {
    const frozen = preDropFreeze(10.0, drop);
    expect(frozen.motionMultiplier).toBe(0);
    expect(frozen.particleVelocityClamp).toBe(0);
  });

  it("drops exposure while frozen", () => {
    expect(preDropFreeze(10.0, drop).exposureEV).toBeLessThan(0);
  });

  it("releases on the drop itself", () => {
    expect(preDropFreeze(10.001, drop).motionMultiplier).toBe(1);
  });

  it("ramps rather than slamming between 0 and 1", () => {
    // A step change here would be indistinguishable from a dropped frame.
    const values = [9.6, 9.7, 9.8, 9.9].map((t) => preDropFreeze(t, drop).motionMultiplier);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]);
      expect(values[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("4. snare-backpedal", () => {
  it("is at rest at the moment of the hit", () => {
    expect(snareBackpedal(0)).toBe(0);
  });

  it("recoils into the view vector", () => {
    // A negative offset is the recoil; a positive one would push the camera in.
    expect(snareBackpedal(0.02)).toBeLessThan(0);
  });

  it("returns to exactly zero within the recovery window", () => {
    // A decaying residue that never reaches rest is the "drunk camera" tell.
    expect(snareBackpedal(0.22)).toBe(0);
    expect(snareBackpedal(5)).toBe(0);
  });

  it("stays bounded by the kickback distance", () => {
    for (let t = 0; t < 0.25; t += 0.001) {
      expect(Math.abs(snareBackpedal(t))).toBeLessThanOrEqual(1.8 + 1e-9);
    }
  });

  it("never returns NaN", () => {
    for (const t of [-1, 0, 1, Number.NaN]) {
      expect(Number.isNaN(snareBackpedal(t))).toBe(false);
    }
  });
});

describe("5. orbital-ratchet", () => {
  it("returns nothing before the first hat", () => {
    expect(orbitalRatchet(0.5, 0)).toBe(0);
  });

  it("steps forward by stepAngle per hit", () => {
    const one = orbitalRatchet(0.0, 1);
    const two = orbitalRatchet(0.0, 2);
    expect(two - one).toBeCloseTo(2 * Math.PI / 32, 9);
  });

  it("advances as hats accumulate", () => {
    expect(orbitalRatchet(0.1, 8)).toBeGreaterThan(orbitalRatchet(0.1, 4));
  });

  it("never goes backwards", () => {
    let previous = -Infinity;
    for (let hits = 0; hits <= 32; hits++) {
      const v = orbitalRatchet(0.02, hits);
      expect(v).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = v;
    }
  });

  it("completes a full revolution in 32 steps", () => {
    // With the rounded 0.196 from the spec this came to 6.272 rad, leaving a
    // 0.011 rad seam that repeated every 32 hats.
    expect(orbitalRatchet(0.0, 32)).toBeCloseTo(2 * Math.PI, 9);
  });
});

describe("6. sub-bass-swell", () => {
  it("is still at silence", () => {
    expect(subBassSwell(1, 0)).toEqual({ fovDelta: 0, displacement: 0 });
  });

  it("swells with sustained sub energy", () => {
    const quiet = subBassSwell(1, 0.2);
    const loud = subBassSwell(1, 0.9);
    expect(loud.fovDelta).toBeGreaterThan(quiet.fovDelta);
    expect(loud.displacement).toBeGreaterThan(quiet.displacement);
  });

  it("never exceeds the configured amplitudes", () => {
    for (const e of [0, 0.25, 0.5, 0.75, 1]) {
      const r = subBassSwell(1, e);
      expect(r.fovDelta).toBeLessThanOrEqual(DEFAULT_SUB_BASS_SWELL.fovDelta + 1e-9);
      expect(r.fovDelta).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps out-of-range and NaN energy", () => {
    expect(subBassSwell(1, 5).fovDelta).toBe(subBassSwell(1, 1).fovDelta);
    const nan = subBassSwell(1, Number.NaN);
    expect(Number.isNaN(nan.fovDelta)).toBe(false);
  });
});

describe("7. frequency-dispersion-whip", () => {
  it("starts at the origin", () => {
    expect(frequencyDispersionWhip(0)).toEqual({ yaw: 0, roll: 0 });
  });

  it("accelerates rather than moving linearly", () => {
    // The whip/pan distinction: at the halfway point a linear ramp would
    // already be at 50%, an easeInQuint ramp is at ~3%.
    const half = frequencyDispersionWhip(0.5, DEFAULT_WHIP, 1.0);
    expect(half.yaw).toBeLessThan(DEFAULT_WHIP.whipAngleYaw * 0.1);
  });

  it("lands at the full yaw on the downbeat", () => {
    const landed = frequencyDispersionWhip(1.0, DEFAULT_WHIP, 1.0);
    expect(landed.yaw).toBeCloseTo(DEFAULT_WHIP.whipAngleYaw, 9);
    expect(landed.roll).toBeCloseTo(DEFAULT_WHIP.whipRollKick, 9);
  });

  it("does not overshoot past the landing point", () => {
    expect(frequencyDispersionWhip(10, DEFAULT_WHIP, 1.0).yaw).toBeCloseTo(
      DEFAULT_WHIP.whipAngleYaw,
      9,
    );
  });

  it("never returns NaN", () => {
    for (const t of [-1, 0, 1e9, Number.NaN]) {
      expect(Number.isNaN(frequencyDispersionWhip(t, DEFAULT_WHIP, 1).yaw)).toBe(false);
    }
  });
});

describe("8. phase-lag-pendulum", () => {
  it("mirrors the source at element 0", () => {
    expect(phaseLagElement([0.5], 0)).toBe(0.5);
  });

  it("holds at zero before the history is long enough", () => {
    // Clamping to the oldest sample instead would make the whole chain jump.
    expect(phaseLagElement([1], 5)).toBe(0);
  });

  it("attenuates by scaleAttenuation per element", () => {
    const chain = new PhaseLagChain();
    // Push enough frames that every element has a valid delayed sample.
    for (let i = 0; i < 20; i++) chain.update(1);
    const out = chain.update(1);
    expect(out).toHaveLength(4);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(out[i - 1] * 0.85, 6);
    }
  });

  it("lags behind the source", () => {
    const chain = new PhaseLagChain();
    for (let i = 0; i < 30; i++) chain.update(0);
    const out = chain.update(1);
    expect(out[0]).toBe(1);
    // Later elements have not seen the jump yet.
    expect(out[3]).toBe(0);
  });

  it("does not grow its history without bound", () => {
    const chain = new PhaseLagChain();
    for (let i = 0; i < 5000; i++) chain.update(i % 2);
    expect(() => chain.update(1)).not.toThrow();
  });

  it("resets cleanly", () => {
    const chain = new PhaseLagChain();
    chain.update(1);
    chain.reset();
    expect(chain.update(1)).toEqual([1, 0, 0, 0]);
  });
});

describe("9. shutter-stutter", () => {
  it("passes time through when inactive", () => {
    expect(shutterHoldTime(0.37, false)).toBe(0.37);
  });

  it("quantises to 12 FPS when active", () => {
    // 1/12 s steps: 0.37 s -> 4 whole steps -> 0.3333...
    expect(shutterHoldTime(0.37, true)).toBeCloseTo(4 / 12, 9);
  });

  it("holds the same value across frames within a step", () => {
    expect(shutterHoldTime(0.34, true)).toBe(shutterHoldTime(0.36, true));
  });

  it("passes a NaN time through untouched", () => {
    // A NaN time must not become a bogus sample index that could read past the
    // end of the timeline array.
    expect(shutterHoldTime(Number.NaN, false)).toBeNaN();
  });

  it("reports the active window from its start", () => {
    expect(isStutterActive(5.0, 5.0)).toBe(true);
    expect(isStutterActive(5.2, 5.0)).toBe(true);
    expect(isStutterActive(5.5, 5.0)).toBe(false);
    expect(isStutterActive(4.9, 5.0)).toBe(false);
  });
});

describe("10. focal-breathing", () => {
  it("starts at minFOV with no dolly offset", () => {
    const start = focalBreathing(0);
    expect(start.fov).toBeCloseTo(35, 9);
    expect(start.cameraZ).toBeCloseTo(0, 9);
  });

  it("reaches maxFOV at the end of the phrase", () => {
    expect(focalBreathing(1).fov).toBeCloseTo(85, 9);
  });

  it("holds the subject framing by dollying back as FOV widens", () => {
    // Dolly zoom: the camera must translate or the subject changes size.
    const mid = focalBreathing(0.5);
    expect(mid.cameraZ).toBeGreaterThan(0);
    expect(focalBreathing(1).cameraZ).toBeGreaterThan(mid.cameraZ);
  });

  it("clamps out-of-range progress", () => {
    expect(focalBreathing(-1).fov).toBeCloseTo(35, 9);
    expect(focalBreathing(2).fov).toBeCloseTo(85, 9);
  });

  it("never returns NaN", () => {
    const nan = focalBreathing(Number.NaN);
    expect(Number.isNaN(nan.fov)).toBe(false);
    expect(Number.isNaN(nan.cameraZ)).toBe(false);
  });
});

describe("impulse-decay trigger (amateur tell #1)", () => {
  const dt = 1 / 60;

  it("does not fire on a flat energy level", () => {
    // The core fix: a *constant* energy must produce no motion, which is what
    // stops a mesh twitching every frame.
    const t = new ImpulseTrigger();
    t.update(0.5, dt, 0);
    let peak = 0;
    for (let i = 1; i <= 20; i++) peak = Math.max(peak, t.update(0.5, dt, i * dt));
    expect(peak).toBe(0);
  });

  it("fires hard on a sharp rise", () => {
    const t = new ImpulseTrigger();
    t.update(0.05, dt, 0);
    expect(t.update(0.9, dt, dt)).toBeGreaterThan(0.4);
  });

  it("ignores a fall", () => {
    // Only rises trigger; a decaying signal must not retrigger.
    const t = new ImpulseTrigger();
    t.update(0.9, dt, 0);
    t.update(0.05, dt, dt);
    expect(t.update(0.0, dt, 2 * dt)).toBeLessThan(0.2);
  });

  it("suppresses sub-gate noise", () => {
    const t = new ImpulseTrigger();
    t.update(0.5, dt, 0);
    // 0.001 / (1/60) = 0.06 rise per second, far below the 0.35 gate.
    expect(t.update(0.501, dt, dt)).toBe(0);
  });

  it("rings down to rest after the transient", () => {
    const t = new ImpulseTrigger();
    t.update(0.0, dt, 0); // prime
    t.update(1.0, dt, dt); // attack
    let now = dt;
    let v = 1;
    for (let i = 0; i < 120; i++) {
      now += dt;
      v = t.update(0.5, dt, now);
    }
    // The envelope is tapered to exactly 0 at `decayMs`, so it genuinely
    // arrives at rest rather than decaying toward zero forever. A residual rest
    // offset is what keeps a scene twitching in silence.
    expect(v).toBe(0);
  });

  it("always stays within [0,1]", () => {
    const t = new ImpulseTrigger();
    for (let i = 0; i < 300; i++) {
      const v = t.update(i % 7 === 0 ? 1 : i % 13 / 13, dt, i * dt);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it("survives a bad frame time", () => {
    const t = new ImpulseTrigger();
    t.update(0.1, 0, 0);
    expect(Number.isNaN(t.update(1, 0, 0.1))).toBe(false);
    expect(Number.isNaN(t.update(1, Number.NaN, 0.2))).toBe(false);
  });

  it("resets to rest", () => {
    const t = new ImpulseTrigger();
    t.update(1, dt, 0);
    t.reset();
    expect(t.update(1, dt, dt)).toBe(0);
  });
});

describe("motion gates", () => {
  const song = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  it("gates motion in a quiet passage", () => {
    expect(shouldGateMotion(0.05, song)).toBe(true);
  });

  it("does not gate motion in a loud passage", () => {
    expect(shouldGateMotion(0.95, song)).toBe(false);
  });

  it("does not gate without enough track context", () => {
    // Gating on a 2-sample "song range" would freeze a track just starting up.
    expect(shouldGateMotion(0.0, [0.1, 0.9])).toBe(false);
  });

  it("gates detail below the flow threshold", () => {
    expect(shouldGateDetail(0.01)).toBe(true);
    expect(shouldGateDetail(0.5)).toBe(false);
  });
});

describe("sectionMotionProfile", () => {
  it("maps the labels the analyzer actually emits", () => {
    expect(sectionMotionProfile("VERSE").transientGain).toBeLessThan(
      sectionMotionProfile("DROP").transientGain,
    );
    expect(sectionMotionProfile("PRE-CHORUS").transientGain).toBeGreaterThan(
      sectionMotionProfile("VERSE").transientGain,
    );
  });

  it("treats BUILD-UP as a pre-chorus and FINAL DROP as a drop", () => {
    // Both are the same musical function; letting them fall back to verse is
    // what made the biggest moments on a track feel the quietest.
    expect(sectionMotionProfile("BUILD-UP").transientGain).toBe(
      sectionMotionProfile("PRE-CHORUS").transientGain,
    );
    expect(sectionMotionProfile("FINAL DROP").transientGain).toBe(
      sectionMotionProfile("DROP").transientGain,
    );
    expect(sectionMotionProfile("FINAL CHORUS").transientGain).toBe(
      sectionMotionProfile("CHORUS").transientGain,
    );
  });

  it("is case- and whitespace-insensitive", () => {
    expect(sectionMotionProfile("  chorus ").label).toBe(
      sectionMotionProfile("CHORUS").label,
    );
  });

  it("falls back to verse for unknown or missing labels", () => {
    const fallback = sectionMotionProfile("VERSE").transientGain;
    expect(sectionMotionProfile("KALEIDOSCOPE").transientGain).toBe(fallback);
    expect(sectionMotionProfile(null).transientGain).toBe(fallback);
  });

  it("always returns a usable easing function", () => {
    for (const label of ["VERSE", "DROP", "BRIDGE", "nonsense", ""]) {
      const p = sectionMotionProfile(label);
      expect(Number.isNaN(p.ease(0.5))).toBe(false);
      expect(p.ease(0)).toBeCloseTo(0, 6);
      expect(p.ease(1)).toBeCloseTo(1, 6);
    }
  });
});