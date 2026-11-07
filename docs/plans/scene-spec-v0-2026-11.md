# Scene Spec v0 — Design 2026-11

**Status:** Proposed
**Area:** Video Pipeline & Storyboard (T-VID-05)
**Source:** `docs/knowledge-library/3d-viz-code-harnesses-2026.md` (SceneCraft /
Holodeck patterns, spec-first argument);
`docs/plans/frame-package-contract-2026-11.md` (passes);
`docs/plans/lighting-look-rigs-2026-11.md` (lighting/lens/look);
`docs/plans/character-identity-layer-2026-11.md` (characters);
`docs/plans/scene-vocabulary-material-library-2026-11.md` (objects/materials/assets);
`docs/plans/camera-rig-presets-2026-11.md` (camera rigs);
`docs/plans/tasks/video-pipeline-and-storyboard.md` T-VID-03 (measured beat grid)
**Decides:** none — design only; schema implementation and builders wait on
the owner's word.
**Last Updated:** 2026-11-07

## 1. Scope and non-goals

The intro-recipe pattern, extended to scenes: **the model emits a
validated scene spec (JSON); a deterministic builder executes it.**
The model never writes bpy scripts, never places objects imperatively,
never touches an engine. Everything it can express is data the
validator can check before any engine starts.

This document is the capstone the session's vocabulary docs plug into:
camera rigs (T-VID-11), lighting/look rigs (T-VID-15), the frame
package (T-VID-13), character assets (T-VID-16), primitives +
materials + asset refs (T-VID-18). If a field here conflicts with one
of those, **those documents win** — this schema cites them, it does
not re-decide them.

Non-goals: no code, no renders, no builder implementation, no frontend
surface. The standing music-video hold is unaffected.

## 2. The architecture (unchanged from the survey)

```text
prompt/track ──► LLM ──► scene-spec JSON ──► VALIDATOR ──► builders
                              ▲                  │          ├─ Blender bpy → frame-package/v1 (T-VID-13)
                        spec_version          reject      ├─ Unity loader (Holodeck-style scene JSON)
                        + hashes                     └─ Three.js studio preview (existing)
```

Three consumers, one spec: **Blender bpy** is the package authority
(T-VID-17 capture spec), **Unity** is the Holodeck-style interactive
route, **Three.js Studio** is preview (its builder consumes the same
vocabulary — T-VID-18's factory refactor). A spec valid for one is
valid for all; builders differ only in what they can express, and
`spec.features_used` records which optional blocks were exercised.

## 3. Schema v0

```jsonc
{
  "schema": "scene-spec/v0",
  "id": "scene-<slug>",
  "version": 1,
  "title": "free text",
  "duration_seconds": 30.0,               // ≤ song length; trimmed at conform
  "fps": 24,

  "stage": {                              // the room everything lives in
    "bounds": { "radius": 6.0, "floor_y": 0.0 },
    "environment": "studio-void | stage | room-<id>",
    "background": "#0a0a12"
  },

  "camera": {
    "rig": "<T-VID-11 camera-rig id | null>",
    "lens": "<T-VID-15 lens-set id | {focal_mm: n}>",
    "move_path": null,                    // T-VID-10 path ref, reserved
    "shot_list": null                     // v0: single shot; multi-shot = v1
  },

  "lighting_rig": "<T-VID-15 lighting-rig id>",
  "look": "<T-VID-15 look id>",
  "grade_strength": 0.85,                 // 0–1, Route A grade step

  "objects": [
    {
      "id": "obj-<slug>",                 // spec-local, unique
      "type": "cylinder",                 // T-VID-18 primitive…
      "params": { "radiusTop": 0.6, "radiusBottom": 0.6, "height": 3.4 },
      // …or "asset": {"id","version"} (T-VID-18 asset / T-VID-16 character),
      "material": "mat-brushed-steel",    // T-VID-18 material id, or inline {…}
      "transform": { "position": [0,0,0], "rotation": [0,0,0], "scale": [1,1,1] },
      "relations": [                      // §5 spatial constraints
        { "rel": "on", "target": "stage-floor" }
      ],
      "bindings": [                       // §6 audio-reactive
        { "prop": "scale.y", "feature": "kick", "curve": "pulse", "amount": 0.15 }
      ]
    }
  ],

  "characters": [                          // T-VID-16 instances
    { "instance_id": "hero-1",
      "asset": { "id": "char-veyra", "version": "1.2.0" },
      "transform": {…}, "overrides": {…} }
  ],

  "passes": {                              // T-VID-13 §6, verbatim shape
    "beauty": true, "depth": {"scale": 0.5, "near": 0.5, "far": 10.0},
    "normals": {"scale": 1.0},
    "segmentation": {"granularity": "object"},
    "pose": "auto", "camera": true
  },

  "analysis": {                            // measured-grid binding (T-VID-03)
    "beat_grid": "output/beat_data/<hash>.json",
    "stems": "output/stems/<track>/"
  },

  "features_used": []                     // filled by validator, §8
}
```

## 4. Field authority map (who decides what)

| Spec field | Authority doc | Rule |
|------------|---------------|------|
| `objects[].type/params` | T-VID-18 §2 | primitive vocabulary + bounds |
| `objects[].material` | T-VID-18 §3 | material-library ids or inline overrides |
| `objects[].asset` / `characters[]` | T-VID-18 §4 / T-VID-16 §5 | asset refs, pinned versions, override whitelist |
| `camera.*` | T-VID-11 + T-VID-15 §4 | rig ids, shared `focal_mm` lens vocabulary |
| `lighting_rig`, `look`, `grade_strength` | T-VID-15 §6–§7 | rig ids, dynamic-light cap proven per rig |
| `passes` | T-VID-13 §6 | pass block verbatim; validator cross-checks caps |
| `relations`, `bindings` | **this doc** §5–§6 | new — the only fields v0 owns outright |

## 5. Spatial constraints (`relations`)

SceneCraft's lesson: relations are data, positions are solved. v0 keeps
this **declarative and builder-resolved**, not a numerical solver:

| `rel` | Meaning | Builder resolution |
|-------|---------|--------------------|
| `on` | rests on target surface | target's top face + object half-height |
| `above` / `below` | vertical offset from target | target center ± (halfHeights + gap) |
| `left-of` / `right-of` | horizontal offset (camera-relative) | target center ∓ x, preserving z |
| `in-front-of` / `behind` | depth offset | target center ± z |
| `aligned` | shares target's axis | copy target rotation/position axis |
| `facing` | yaw toward target | compute yaw from positions |
| `near` | within radius of target | clamp distance ≤ radius |

- Relations are **resolved in spec order, deterministically** — object
  order is part of the spec hash; two builders resolving the same spec
  produce the same transforms because the resolution rules are pure
  functions of spec data.
- **Conventions (fixed, not per-builder):** units metres, Y-up,
  right-handed glTF frame; rotations in **degrees**; character/asset
  `position` is **feet-at-origin** (glTF convention); `left-of`/
  `right-of`/`in-front-of`/`behind` bind to the shot's camera frame at
  spec time — resolved once at build, never per-frame.
- **No cycles**: `a on b`, `b on a` is a validation error.
- **Ambiguity the schema must resolve** (walked in §10): which "top"
  face for composite assets; what `left-of` means under camera moves
  (answer: spec-time camera frame — relations bind to the *shot's*
  camera, resolved once at build, not per-frame); units are meters,
  Y-up, right-handed (glTF convention — matches T-VID-13 §3.7).
- A full constraint *solver* (SceneCraft-style numerical optimization)
  is v1+ — v0's table covers the placements music-video scenes
  actually need, and every relation is inspectable data.

## 6. Audio-reactive bindings (`bindings`)

The spec field that ties scenes to the measured track — **measured
grid only, never metadata BPM** (ledger rule, T-VID-03):

```json
{ "prop": "scale.y", "feature": "kick", "curve": "pulse",
  "amount": 0.15, "stems": ["drums"] }
```

- `feature` vocabulary v0: `kick`, `snare`, `beat`, `bar`,
  `section.<name>`, `stem_energy.<stem>`, `loudness` — all resolved
  from `output/beat_data/` + stem analysis at build time, never
  re-derived inside the builder.
- `prop` is a transform/material property path (`scale.y`,
  `position.y`, `material.emissive.intensity`, `rotation.z`); the
  builder maps feature → envelope → property offset × `amount`.
- `curve` names an envelope shape (`pulse`, `swell`, `hold`,
  `ramp`) — data, not code; the builder's envelope table is fixed.
- Determinism: bindings resolve to **frame-indexed value tracks** at
  build time (beat times → frame numbers, the web-side rule applied
  to bpy) — the rendered result is a pure function of spec + measured
  analysis, reproducible forever.

## 7. Validator rules (before any engine starts)

Ordered; first failure wins with the field path named:

1. **Schema shape** — required fields, types, enum memberships.
2. **Reference membership** — camera rig, lens, lighting rig, look,
   material, primitive type, asset ids+versions all resolve in their
   registries (T-VID-11/15/18/16 loaders).
3. **Budget bounds** — primitive params vs T-VID-18 bounds; object
   count vs stage budget; character count vs skinned-mesh cap (≤8);
   dynamic lights = lighting rig's declared count ≤3.
4. **Pass sanity** — `passes` block valid per T-VID-13 §6; write-
   bandwidth estimate vs `asset-budgets.json` scene caps.
5. **Relations** — targets exist, no cycles, `on`-targets have a
   definable surface.
6. **Bindings** — `feature` names exist in the track's measured
   analysis; `prop` paths are whitelisted; `amount` within ±0.5.
7. **Identity integrity** — character overrides touch only the
   T-VID-16 whitelist; asset sha256s verify at build (not spec time —
   files may not be local to the validator).
8. **Features declaration** — validator emits `features_used`
   (which optional blocks fired) so builders can refuse gracefully.

## 8. Builder outlines

### 8.1 Blender bpy (package authority)

Project code generates the bpy script **from the spec** — the model
never writes Python:

1. Load spec + registries; run §7 validator (shared Python module).
2. Emit `build_scene.py`: stage → lights (rig resolved to light
   objects) → objects (primitives via bpy.ops/mesh-from-scratch,
   assets via `bpy.ops.import_scene.gltf`, characters via armature +
   mesh bind) → relations resolved to transforms → bindings baked to
   per-frame fcurves/offset objects.
3. Render layers per `passes` block (T-VID-17 settings, T-VID-13
   encodings) → frame-package/v1 directory + manifest.
4. Determinism: `frame_set(f)` stepping, seeded RNG, builder version
   stamped (T-VID-17 §3).

### 8.2 Unity loader (Holodeck-style)

Holodeck's shape: LLM designs constraints → solver places → scene
JSON. Our variant inverts correctly — **the spec IS the scene JSON**;
Unity's job is interpretation, not generation:

1. Same validator (shared spec module — validation is
   engine-agnostic).
2. `SpecLoader.cs`: spec JSON → Unity GameObjects — primitives map
   to Unity primitives + scaled params; materials to URP Lit with the
   same PBR fields; lighting rig to Unity light components (≤3
   dynamic — URP additional lights cap aligns);
   characters to the imported rigged GLB + Animator controller from
   `animation.clip`.
3. Bindings → Unity Timeline/AnimationCurve tracks baked at import.
4. Output: Unity scene for interactive use — **not** a frame package
   (Unity capture is a separate, later question; v0 Unity is preview/
   interactive, matching Three.js's role).

### 8.3 Three.js Studio (preview)

Existing factory consumes the same vocabulary post-T-VID-18: spec →
object list → `useMeshFactory` resolver → stage. Preview only —
never emits frame packages in v0.

## 9. The GLSL gate note (carried from T-PLT-10)

If a future Three.js builder path emits custom GLSL (shader materials
for looks/effects), that source routes through the `glsl` gate as
**ESSL 1.00** before browser preview — `glslangValidator` checks
shader source only, not scene JSON, ShaderLab, or runtime WebGL
behavior. Recorded here so the requirement travels with the spec.

## 10. Worked example — one spec, walked through

Spec: a 30-second visualizer scene for a mid-tempo track — a stage
with a hero cylinder "monolith", a ring of emissive bars reacting to
kick, three supporting spheres, one character, three-point lighting,
teal-orange look, full pass set.

```json
{
  "schema": "scene-spec/v0", "id": "scene-monolith-preview",
  "version": 1, "duration_seconds": 30.0, "fps": 24,
  "stage": { "bounds": {"radius": 6.0, "floor_y": 0.0},
             "environment": "studio-void", "background": "#0a0a12" },
  "camera": { "rig": "orbit", "lens": "lens-35" },
  "lighting_rig": "lighting-three-point",
  "look": "look-teal-orange", "grade_strength": 0.8,
  "objects": [
    { "id": "monolith", "type": "cylinder",
      "params": {"radiusTop":0.7,"radiusBottom":1.0,"height":4.2},
      "material": "mat-brushed-steel",
      "transform": {"position":[0,2.1,0]},
      "relations": [{"rel":"on","target":"stage-floor"}],
      "bindings": [{"prop":"material.emissive.intensity",
                    "feature":"kick","curve":"pulse","amount":0.4}] },
    { "id": "bars-ring", "type": "bars",
      "params": {"count":32,"spacing":0.5,"heightVar":0.6,
                 "heightVar_dist":"uniform"},
      "material": "mat-emissive-strip",
      "transform": {"position":[0,0.5,0],"rotation":[0,0,0]},
      "relations": [{"rel":"aligned","target":"monolith"}],
      "bindings": [{"prop":"scale.y","feature":"stem_energy.drums",
                    "curve":"swell","amount":0.5}] },
    { "id": "sat-a", "type": "sphere", "params": {"radius":0.5},
      "material": "mat-ceramic",
      "transform": {"position":[-2.5,0.5,-1.0]},
      "relations": [{"rel":"on","target":"stage-floor"}] },
    { "id": "sat-b", "type": "sphere", "params": {"radius":0.35},
      "material": "mat-glass-frosted",
      "transform": {"position":[2.5,0.35,0.8]},
      "relations": [{"rel":"on","target":"stage-floor"}] }
  ],
  "characters": [
    { "instance_id": "hero-1", "asset": {"id":"char-veyra","version":"1.2.0"},
      "transform": {"position":[0,0,-2.2],"rotation":[0,180,0]},
      "overrides": {"animation.clip":"idle_sway"} }
  ],
  "passes": { "beauty": true,
              "depth": {"scale":0.5,"near":0.5,"far":10.0},
              "normals": {"scale":1.0},
              "segmentation": {"granularity":"object"},
              "pose": "auto", "camera": true },
  "analysis": { "beat_grid": "output/beat_data/<track-hash>.json",
                "stems": "output/stems/<track>/" }
}
```

**Validator walk:** all ids resolve; params within bounds (monolith
4.2 m < stage radius×3); dynamic lights = 3 (rig) ≤ cap; passes
estimate ≈ beauty + 3 controls ≈ within write budget at 30 s
(720 frames — small scene, no problem); `on stage-floor` resolves
(floor is a stage primitive the builder always creates); `kick`
feature resolves against the spec's `analysis.beat_grid` — the field
the walk added to §3 after catching that `feature` names are
track-relative: a spec is only valid against a *specific* measured
analysis, so the binding is explicit data, not ambient state.

**Blender walk:** stage floor plane → three-point rig → 4 objects
(primitives constructed, materials resolved) → `on` relations set
base Y → character GLB import + armature bind → `orbit` camera rig
→ bindings baked to fcurves from the analysis JSON → 5 render
layers per passes → 720 frames × 5 passes → manifest. The walk
surfaced three conventions now fixed in §5/§3 rather than left
ambiguous: `heightVar_dist` (added — `uniform` default named),
rotation units (**degrees**), character position (**feet-at-origin**).

**Unity walk:** same spec → primitives to scaled Unity primitives,
materials to URP Lit, rig → 3 lights + ambient, character → GLB +
Animator `idle_sway`, bindings → Timeline curves. One real
converter note survives: Unity's Y-up left-handed vs glTF
right-handed — the loader applies the standard z-flip; recorded so
nobody "fixes" it twice.

## 11. Open questions for the owner

1. **Asset-library source for refs** — where do non-character props
   come from? (gen3d pipeline output? curated pack? both — needs a
   decision before T-VID-18's asset vocabulary fills.)
2. **Third builder?** — does the frontend Three.js visualizer become
   a third *authoring* surface (edit spec visually), or stay
   preview-only? Affects whether spec edits round-trip through UI.
3. **`analysis` binding strength** — the field names beat-grid/stem
   paths; should it pin content hashes (full reproducibility) or
   paths (flexibility when re-analysis lands)? Recommend hashes,
   same posture as everything else here.
4. **Multi-shot v0?** — `shot_list` is reserved-null; a music video
   is inherently multi-shot. Confirm single-shot v0 is acceptable
   for the first builder iteration.

## 12. What implementation spins out (all owner-gated)

1. `scene-spec/v0` JSON Schema file + the §7 validator module
   (shared Python — builders consume it).
2. Registry loaders for T-VID-11/15/18/16 vocabularies.
3. Blender bpy builder (`build_scene.py` generator + render layers).
4. Unity `SpecLoader.cs` + material/lighting mapping.
5. Three.js preview consumer (post-T-VID-18 factory refactor).
6. `analysis` resolution + beat-grid → frame-track baker.
