# Motion Design for Audio-Reactive Visuals — Gemini Research Handoff (2026-10-02)

**For the implementing agent:** this is motion DESIGN craft, not rendering
tech. The stack (Three.js/WebGL2, precomputed frame-JSON timelines,
exponential smoothing) is assumed — this doc is about what to *do* with it.
Pairs with gap #16 in `docs/knowledge-library/app-research-gaps-2026.md`.

## Provenance

- Source: Gemini 3.8 Flash (`gemini-3.8-flash`), free tier, via Google AI Studio
- Date: 2026-10-02. Chat: https://aistudio.google.com/prompts/15ztHX8ciOdnK4ZqlS1nmfCgj6khl88ot
- Direct craft question (no video). Brief demanded 8–12 implementable moves;
  Gemini delivered exactly 10.
- **Caveat:** AI Studio's URL-context tool was not enabled, so Gemini did NOT
  read the repo. Stack assumptions (frame-JSON timelines, smoothing) are
  generic, not verified against our code. Validate each move against the
  actual timeline schema before implementing.

## The core diagnosis

When visuals mirror continuous audio levels directly, they read as an
oscilloscope, not an organism. Our current mappings (bass→scale,
mids→rotation, highs→glitch) are technically reactive but lifeless because
everything shares one trigger source, one direction, and one easing curve.
Fix = choreography, not more parameters.

## 1. Animation principles, adapted

**Anticipation (lookahead pre-roll).** Mass can't move instantly — wind up
before the hit. Our timelines are precomputed: zero-latency lookahead is
free, use it everywhere. For a downbeat/drop at beat N, start counter-motion
at N−2: shrink scale 1.0→0.88, drop exposure 0.3 EV, slow orbit 60%. Snap
outward on beat N.

**Follow-through / overlapping action.** Split the scene graph: Primary Mass
(main subject/camera) peaks at t₀ and settles in ~120 ms; Secondary
structures start at t₀+2 frames, peak at t₀+6 with elastic overshoot;
particles react to velocity only, drifting after the mesh rests.

**Squash & stretch (volume conservation).** Never scale uniformly on a kick
— that's a 2D zoom, not mass. Compress along the motion vector and expand
laterally (e.g. S = (1.18, 0.72, 1.18)), swing through overshoot inversion
(0.94, 1.08, 0.94), settle via underdamped spring. X·Y·Z ≈ 1 always.

**Staging (driver dominance).** One kinetic thought at a time. If kick, snare
and synth land in the same 100 ms: the dominant stem (by RMS) takes global
translation/camera/FOV; the secondary is confined to shader params or local
rotation; the tertiary to bloom/chromatic aberration. Never two stems driving
global spatial vectors at once.

## 2. Breaking the kick monoculture

Three techniques:

1. **Directional inversion** — kick pushes camera +Z, snare cracks −Z or +Y.
   Downbeats compress; backbeats lift.
2. **Transform decoupling** — sub-bass → camera focal length / barrel
   distortion (not global scale); snare → roll-axis kick (±1.5°); hi-hats →
   stepped orbit ratchets (+45° per hit).
3. **Phase-shifted counterpoint** — when energy is highly regular
   (four-on-the-floor), suppress reactivity on beats 1 and 3 and accent the
   off-beat upbeats. Reacting to the *absence* of bass reads more rhythmic
   than tracking every transient.

**Sectional easing palette:**

| Section | Easing | Objective |
|---|---|---|
| Verse | easeInOutSine → easeInOutCubic | Drifting, observational; motion resolves over 2–4 bars |
| Pre-chorus / build | easeInQuad → easeInExpo | Ratcheting tension; decay windows shorten progressively |
| Chorus / drop | Instant attack + easeOutElastic / damped harmonic | Violent displacement, resonant decay: f(t) = e^(−γt)·cos(ωt) |
| Bridge / outro | easeOutQuad rise + linear drift | Weightless, decoupled from rhythm |

## 3. Structural arcs: tension, release, negative space

Visual fatigue = same hyperactivity at 0:15 and at the final drop. Hold
kinetic energy in reserve:

- **Pre-drop vacuum.** 1–2 beats before a major drop: absolute kinetic
  clamp — freeze scale/rotation/particles, lock camera (or flat
  orthographic), cut bloom to baseline. Dead space magnifies the drop.
- **Build without displacement.** In builds, don't move the camera — boil
  under the surface: raise shader noise frequency, tighten particle bounds
  + jitter, increase chromatic aberration and vignette. Geometry still,
  surface boiling.
- **Motion gates.** Running 8-bar RMS window; if section RMS < 35th
  percentile of song range (ambient verses, breakdowns): gate off transient
  impulses, switch camera to smooth Bezier drift, let transients drive only
  low-amplitude shader emission. Let the music breathe.

## 4. Amateur tells and fixes

| Tell | Fix |
|---|---|
| **Jittering oscilloscope** — meshes twitch every frame from raw energy mapping | First-derivative triggering: bind to max(0, dE/dt) with a noise gate τ; spike to 1.0 in one frame, decay via spring in the precomputed timeline |
| **Isotropic balloon scaling** — uniform XYZ scale on kicks | Anisotropic volume-preserving squash (see §1); orthogonal axes compress ~12.6% when primary grows 30% |
| **Triangular hit curves** — attack = decay, feels mushy | Asymmetric envelopes: 0–16 ms attack, 120–600 ms decay. Smooth AFTER the transient step, never before (except deliberate anticipation ramps) |
| **Unanchored drunk camera** — translation + rotation + FOV + roll all shaking | Rig separation: CameraRigNode (parent, smooth macro splines, easeInOutCubic) + CameraOffsetNode (child, transients only, rest pose always (0,0,0)) |

## 5. Motion vocabulary — 10 implementable moves

Precompute as normalized [0,1] or offset channels in the Python timeline
generator; the frame loop reads them deterministically. Reference spring:

```js
function dampedSpring(current, target, velocity, stiffness, damping, dt) {
  const springForce = -stiffness * (current - target);
  const nextVelocity = velocity + (springForce - damping * velocity) * dt;
  return [current + nextVelocity * dt, nextVelocity];
}
```

### 1. anticipation-contract
Sucks geometry inward + decelerates scene 2→1 bars before a drop/downbeat.
Lookahead: yes. Targets: primary mesh scale, orbit speed. easeInCubic to
minimum, 1-frame snap out.
Defaults: `durationBeats: 2.0`, `minScale: 0.85`, `orbitDampenFactor: 0.2`,
`snapOutDurationMs: 60`.

### 2. squash-impact
Downbeat compression along world Y with XZ flare, underdamped spring settle.
Lookahead: no. Instant attack, harmonic recovery.
Defaults: `compressionY: 0.75`, `flareXZ: 1.154` (= 1/0.75, volume-preserving),
`springStiffness: 240`, `springDamping: 18`.

### 3. snare-backpedal
Camera recoils along local view vector on snare, magnetic pull back.
Targets: CameraOffsetNode.position.z. Curve: A·e^(−λt)·cos(ωt).
Defaults: `kickbackDistance: 1.8`, `attackTimeMs: 0` (instant),
`recoveryTimeMs: 220`, `easing: easeOutQuad`.

### 4. pre-drop-freeze
Clamps all kinematics to dead stop 0.5–1 beat before a drop; 1-frame release.
Lookahead: yes. Targets: global motion multiplier, shader time delta.
Defaults: `freezeLeadTimeBeats: 1.0`, `exposureDrop: -0.5 EV`,
`particleVelocityClamp: 0.0`.

### 5. orbital-ratchet
Quantized camera orbit stepping on hi-hat 8ths/16ths instead of smooth
rotation. easeOutExpo per step.
Defaults: `stepAngle: 0.196 rad` (11.25°, 32 steps/rev), `stepDurationMs: 45`,
`overshootAngle: 0.03`.

### 6. sub-bass-swell
Slow breathing displacement from sustained 808/sub-bass only (>60 Hz band),
ignoring mids/highs. easeInOutSine, heavily smoothed.
Defaults: `fovDelta: +8°`, `meshDisplacementAmplitude: 0.35`,
`attackTimeMs: 300`, `releaseTimeMs: 450`.

### 7. frequency-dispersion-whip
High-speed camera whip/tilt on fills, rolls, sweepers; lands on final strike
with elastic settle. Lookahead: yes (fill window over 1–2 bars).
Defaults: `whipAngleYaw: 1.5707 rad` (90°), `whipRollKick: 0.261 rad` (15°),
`durationBeats: 2.0`, accelerating easeInQuint into the downbeat.

### 8. phase-lag-pendulum
Child meshes mirror parent transforms with frame delay + damping penalty.
Evaluated via cyclic frame history buffer; no lookahead.
Defaults: `chainLength: 4`, `frameDelayPerElement: 3` (@60fps),
`scaleAttenuation: 0.85`, `dampingCoefficient: 0.12`.

### 9. shutter-stutter
Quantizes transform updates to 12 FPS stepped holds during vocal chops /
glitches / arps; render stays 60 FPS. Sample-and-hold:
T_active(t) = T_source(⌊t/Δt⌋·Δt).
Defaults: `quantizedFrameRate: 12`, `triggerBand: 2–8 kHz spectral flux`,
`durationMs: 350`, `motionBlurSimulatedOpacity: 0.8`.

### 10. focal-breathing (dolly zoom / vertigo)
Camera translates on local Z while FOV counter-compensates; subject framing
holds while background warps. Tied to section macro-energy or slow chord
changes. easeInOutQuad over 8–16 bar phrases.
Defaults: `minFOV: 35°`, `maxFOV: 85°`, `fixedSubjectDistance: 5.0`,
`transitionTimeBeats: 16`.

## Suggested implementation order

1. **Rig separation** (amateur tell #4) — parent/child camera nodes. Everything
   else builds on this.
2. **Impulse-decay triggers** (tell #1) — derivative + noise gate in the
   Python timeline generator; asymmetric envelopes.
3. **Three signature moves**: `anticipation-contract`, `squash-impact`,
   `pre-drop-freeze` — the anticipation/snap/vacuum trio is the highest
   impact-per-line trio in the set.
4. **Sectional easing palette** wired to the existing section detection.
5. Remaining moves in order of cost/benefit: `snare-backpedal`,
   `sub-bass-swell`, `orbital-ratchet`, `focal-breathing`,
   `phase-lag-pendulum`, `shutter-stutter`, `frequency-dispersion-whip`.

## Open questions for the implementing agent

- Map each move's parameters onto the actual frame-JSON timeline schema —
  Gemini never saw the repo; field names are proposals, not matches.
- `pre-drop-freeze` needs drop detection ahead of time: confirm the beat
  grid + section boundaries give reliable 1-beat lookahead.
- Anisotropic squash needs the primary motion vector per viz style — define
  per style, not globally.
