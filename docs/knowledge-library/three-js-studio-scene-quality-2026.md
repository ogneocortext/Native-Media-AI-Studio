---
title: "Three.js Studio Scene Quality — Findings 2026"
date: 2026-11-06
type: synthesis
aliases:
  - Three.js Studio Scene Quality
  - Scene Quality Findings
cssclasses:
  - technical-audit
tags:
  - technical
  - 3d
  - three-js
---

# Three.js Studio Scene Quality — Findings 2026

> Why generated scenes in the Three.js Studio look like a mess,
> established by reading the actual generation path on 2026-11-06
> after the owner screen-recorded the studio's current output. The
> short version: the stage machinery works; the content pipeline
> feeding it has a hard vocabulary ceiling, no materials, and no
> validator. Companion to [[3d-bones-ai-skin-pipeline-2026]] — these
> findings are the present-day evidence under that analysis.

## 1. The exhibit

The recorded scene — a glowing orange ring, cone shapes, a pulsing
purple gem, two drifting colored lights — is **one object**: the mesh
factory's `crown` preset (`packages/frontend/src/features/three-js-studio/hooks/useMeshFactory.ts`):

- `TorusGeometry(1, 0.15)` + 8× `ConeGeometry(0.08, 0.5)` spikes + a
  violet `OctahedronGeometry(0.2)` gem, all sharing one material
- The studio status bar agrees: **Objects 1**
- Beat sync pulses the gem, but with no track loaded it follows a
  typed-in 150 BPM — `Beats: —`, no measured grid

## 2. The generation path as it actually is

```text
AISceneGenerator.tsx ──► useOllamaStream (frontend → Ollama,
   gemma4:e2b-it-qat) ──► prompt variations from track metadata
   ──► JSON ──► code applier ──► useMeshFactory ──► stage
```

The backend's dedicated endpoint is **not** part of this path:
`packages/backend/app/api/ai.py` `POST /generate-scene` is a
placeholder stub — a TODO comment and a hardcoded red-box scene;
its `apply` flag logs "not yet implemented". The codebase advertises
a route that does not exist.

## 3. The vocabulary and material inventory

Everything the builder can express, from `useMeshFactory.ts` (187 lines):

| Object type | Geometry | Notes |
|---|---|---|
| `crown` | torus + 8 cones + octahedron | composite preset, fixed proportions |
| `sphere` | r 0.8, 32×32 | fixed size |
| `box` | 1.2³ | fixed size |
| `cylinder` | r 0.6, h 1.4 | fixed size |
| `cone` | r 0.8, h 1.5 | fixed size |
| `torus` | r 0.8, tube 0.25 | fixed size |
| `bars` | 0.12 × 1 × 0.12 | single bar |
| `modelUrl` | GLTFLoader + AnimationMixer | **real assets, with animation clips, loop + speed control** |

Materials: one `MeshStandardMaterial` per object built from exactly
five scalars — `color`, `metalness`, `roughness`, `emissive`,
`emissiveIntensity`. **No texture maps of any kind** (no color, normal,
or roughness maps) exist in the factory.

Stage (`hooks/mountThreeScene.ts`): ambient (0x404060, 0.55) + one
shadow-casting directional + per-section lights; `UnrealBloomPass`
with configurable strength and selective bloom via a bloom layer.

## 4. Why scenes come out as a mess — four causes

1. **Vocabulary ceiling.** Seven shapes at factory-fixed sizes. Any
   generated scene is primitive soup by construction, before layout
   is even considered. *Owner: T-VID-18.*
2. **No materials.** Five scalars and no maps cap every surface at
   "flat colored plastic / flat emissive glow". Material diversity —
   a stated goal of the bones/skin pipeline — is inexpressible here.
   *Owner: T-VID-18.*
3. **No composition check.** A 4B-class local model emits object
   lists and nothing validates coherence, spacing, or hierarchy.
   This is the visible absence of T-VID-05's spec + validator.
   *Owner: T-VID-05.*
4. **Bloom without a rig.** High emissive values + bloom with no
   lighting discipline produces the blown-out hot spots in the
   recording. *Owner: T-VID-15 (lighting/look rigs), with T-VID-12's
   budgets unapplied to studio scenes so far.*

## 5. What already works — do not rebuild

- Transport, timeline scrub, beat pulse, selective bloom, section
  lights: the stage machinery is functional.
- The **GLTF path is real**: models load with animation mixers, clip
  selection, and loop/speed control, plus a procedural fallback
  character on load failure. Generated 3D assets (gen3d, T-VID-12's
  budgets) already have a door into the studio — the generator
  simply never routes through it.

## 6. The fix shape

T-VID-18 registers the vocabulary work: parameterized primitives
(sizes as spec fields, not factory constants), a named PBR material
library with texture sets (KTX2 per [[pascal-3d-budget-discipline-2026]]),
GLTF asset references as first-class vocabulary, and reconciliation
of the stub endpoint. The factory becomes a *consumer* of that
library. Composition quality then becomes T-VID-05's validator
problem — a problem that can only be posed once scenes have a
vocabulary worth validating.
