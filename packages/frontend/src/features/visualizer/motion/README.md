# Motion vocabulary — module docs

The `motion/` module is the visualizer's motion vocabulary: ten
named, parameterised moves (`motionMoves.ts`), the easing
primitives they're built from (`motionEasing.ts`), and the
per-frame driver that composes them (`useMotionDriver.ts`).

Everything in `motionMoves.ts` is **pure** — a move takes the
audio state and returns channel values, holding no frame state of
its own — because the visualizer's timeline is precomputed and a
re-render must reproduce the same frame exactly. State that
genuinely needs to persist between frames lives in the classes at
the bottom of `motionMoves.ts` (`ImpulseTrigger`, `PhaseLagChain`)
or in the `MotionHistory` the caller owns.

## Consumer map

| Consumer | What it drives | Since |
|---|---|---|
| `ShaderVisualizer.tsx` (shader mode) | `cameraOffset` → `u_camera_offset` vec2 (UV shift) | plan 2.7 (2026-10) |

This table is the "re-tune per style" log D23 anticipates: each
style that adopts the vocabulary gets a row here recording *which*
channels it consumes and *how*, so a re-tune for one style is
visible next to the others instead of buried in a component.

## Mapping table — shader style (plan 2.7)

The shader canvas is a fullscreen quad: there is no camera, no
mesh, no orbit. The mapping from `MotionState` onto the shader is
therefore deliberately narrow — **camera offset only**, per the
plan's scope ("one style first"):

| `MotionState` channel | Shader mapping | Notes |
|---|---|---|
| `cameraOffset[0]` (X) | `u_camera_offset.x` | Yaw whip + snare backpedal, as a fractional UV shift. Range ≈ ±0.02 — a subtle frame drift, not a jump. |
| `cameraOffset[1]` (Y) | `u_camera_offset.y` | Currently always 0 (the vocabulary has no pitch channel yet); reserved so a future move can use it without a shader change. |
| `scale` | *not consumed* | A fullscreen quad has nothing to squash. A style with geometry (3D/LrcViz) should consume this instead. |
| `fov` | *not consumed* | No lens on a quad. |
| `motionMultiplier` | *not consumed* | Would gate `u_time` advancement — a pre-drop freeze for the shader is a follow-up, not part of 2.7. |
| `impulse` | *not consumed* | The shader already has its own transient channel (`u_transient`) from the reactivity processor; driving both would double-count the same onset. |
| `anticipation` / `swell` / `orbitAngle` | *not consumed* | No mesh to scale, no orbit to ratchet. |

### `MotionInput` ← this repo's audio

The spec caveat applies: the handoff was written without access to
this repo, so the mapping from this repo's audio onto `MotionInput`
is **our** choice and is the thing to re-tune per style:

| `MotionInput` field | Source in the shader loop |
|---|---|
| `nowSec` | latency-compensated audio clock (`sampleAudio()`) |
| `dtSec` | audio-clock delta, capped at 250 ms (never the wall clock — D14 rule 2) |
| `bpm` | `analysisData.tempo_bpm`, else 120 (plan 2.10) |
| `bass` / `mid` / `high` | spectral frame's `sub` / `mid` / `high` (timeline, or the live FFT fallback — plan 2.11) |
| `section` | LRC sync's `currentSection` (uppercase label, e.g. `"PRE-CHORUS"`) |
| `nextBeat` | first `analysisData.beat_times[i] > elapsed`, else `null` |

### Why the camera offset lands on a UV shift

The vocabulary's camera moves (`snare-backpedal`,
`frequency-dispersion-whip`) are specified against a **camera
offset node** — a child of the rig, never the rig itself, so a
recoil can never accumulate into the "unanchored drunk camera"
drift. A fullscreen shader has no node graph; the equivalent of
"apply to the offset node, not the rig" is "apply to a per-frame
uniform, not to the accumulated `u_time`". That is why the offset
is a vec2 uniform and why it is *additive per frame* — it cannot
drift, by construction.

## Testing

`motionMoves.test.ts` (129 assertions) and `motionEasing.test.ts`
pin the pure maths; `useMotionDriver.test.ts` pins the driver's
composition (silence is still, flat levels don't jitter, volume is
conserved on every frame of a kick). The *wiring* — that the shader
loop actually feeds the driver and applies its offset — is pinned by
`shaderMotionWiring.test.ts`, the driver-composition test plan 2.7
requires alongside the existing 151 assertions.
