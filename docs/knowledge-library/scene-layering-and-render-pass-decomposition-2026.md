---
tags:
  - technical
  - frame-package
  - scene-spec
  - blender
aliases:
  - layering
  - render-layers
  - depth-compositing
cssclasses:
  - technical-guide
date: 2026-11-07
type: concept
---

> [!info] Purpose
> How layering works across the Native Media AI Studio video pipeline — from scene-spec spatial relations to Blender view layers to frame-package passes — and the current best-practice rules for decomposing a scene into layers without breaking budgets or determinism.

---

## Overview

"Layering" in this stack means four different things that are easy to conflate:

1. **Spec relations** — `in-front-of` / `behind` / `on` constraints in `scene-spec/v0` (§5 of `docs/plans/scene-spec-v0-2026-11.md`), resolved deterministically in spec order.
2. **Scene depth layers** — the classic foreground / midground / background decomposition that governs readability and controls what each render layer contains.
3. **Render layers (bpy View Layers)** — Blender's per-layer render isolation, the mechanism behind separate beauty/control renders.
4. **Package passes** — the `frame-package/v1` outputs (beauty, normals, depth, segmentation, pose) that downstream consumers (ControlNet lane, grading, conform) treat as aligned layers.

This document defines the layering contract across all four and records which parts are implemented vs designed.

## Why layering matters here

- **Iteration cost**: re-rendering a whole scene to fix one element is the #1 waste in CG pipelines. View Layers exist so a background change doesn't re-render the hero.
- **Control independence**: the Route B control-conditioned lane needs depth/normals/pose as *separate aligned images*, not baked into beauty — they are layers by definition.
- **Budget enforcement**: `config/asset-budgets.json` caps draw calls and triangles *per frame*; naive per-element layers can multiply draw calls past the cap.
- **Honesty**: a manifest must only claim passes that were actually emitted — the same rule applies to layers.

## The layering stack

```
spec relations  →  builder z-order  →  view-layer assignment
     (§5)            (resolved)          (collections per layer)
                                             │
                                             ▼
                              per-layer render (Eevee)
                                             │
                                             ▼
                        compositor / package passes
                        (beauty + controls, aligned f%06d)
                                             │
                                             ▼
                        edit tracks (video-editor / Remotion)
```

### 1. Spec relations (implemented, design-level)

`scene-spec/v0` §5 defines `relations` as data — positions are *solved*, never written imperatively. Rules already in the spec:

- Relations resolve **in spec order, deterministically** — object order is part of the spec hash.
- `in-front-of`/`behind` bind to the shot's camera frame at spec time (documented decision).
- `on` targets must exist; cycles are a validation failure.

**Layering guidance added here:** treat relations as the *authoring* layer. They express intent ("the monolith behind the singer") without committing to world-space Z — builders resolve them per shot camera.

### 2. Depth-layer decomposition (design guidance)

Industry practice (arch-viz, film lookdev) converges on three depth bands:

| Band | Purpose | Typical budget role |
|---|---|---|
| **Foreground** | framing elements, atmosphere, lens interest | `hero` or `mid` |
| **Midground** | the subject and its immediate support | `hero` |
| **Background** | environment, set, sky | `background` / `far` |

Rules for this pipeline:

- **One hero read per shot.** Composition research is consistent: pick the primary subject, give it the best contrast/light, quiet everything else. The scene-spec `look`/`lighting` blocks (T-VID-15 rigs) should be authored around one hero, not evenly.
- **Negative space is a feature.** Calm background regions improve readability and give the grade (Route A) room to work.
- **Budget roles already encode bands**: `hero` ≤250K tris, `mid` ≤50K, `background` ≤10K, `far` = impostor/sprite. Assigning spec objects to bands *is* the layering decision — document the band in the spec, don't invent a parallel field.
- **`far` is not geometry.** The budget config already says far = sprite/impostor card; a spec that puts a real mesh in the far band will (correctly) fail validation.

### 3. Blender View Layers (partially implemented)

Blender 5.2 view layers render collections independently with film-transparent backgrounds, recombined in the compositor. Current implementation status in `tools/blender/frame_package.py`:

- **Implemented**: control passes via *material override* (normals) and *compositor File Output nodes* (depth via real Z `Depth` pass). This is the cheaper path — one render emits beauty + all data passes aligned per frame.
- **Not implemented**: true multi-view-layer decomposition (fg/mg/bg as separate collections re-rendered independently). Deferred because:
  - Eevee renders the whole layer anyway; splitting buys iteration speed, not correctness.
  - Our package is a *capture* contract, not an *edit* contract — consumers want aligned passes of the *same* frame, not separately-composited layers.
  - Draw-call cost multiplies per layer; on this hardware (6 physical cores, 8 GB VRAM) layer-per-band is likely slower than one render.

**When to split layers anyway** (the cases where it earns its cost):

- A background element iterates 10× more often than the hero (lookdev churn).
- Holdout/shadow-catcher work: a ground plane that catches shadows but isn't seen by camera.
- Per-layer render settings genuinely differ (e.g., background at lower samples — legal for defocused/bg content).

If a future spec needs this, the path is: collections per band → `scene.view_layers` entries → one `bpy.ops.render.render(animation=True)` per layer → compositor merge. Record per-layer settings in the manifest.

### 4. Package passes as layers (implemented)

`frame-package/v1` passes are aligned layers over the same frame index:

| Pass | Encoding | Role |
|---|---|---|
| `beauty` | 8-bit sRGB PNG | display layer |
| `normals` | 8-bit RGB world-space `n*0.5+0.5` | shape/lighting control |
| `depth` | **16-bit gray PNG**, real Z normalized over `[near,far]` | geometry control (ControlNet-depth input after consumer-side normalization) |
| `segmentation` | (v1.1 — Cryptomatte decode) | region control |
| `pose` | (blocked — needs rigged character) | articulation control |

Layering rules for passes:

- **Same frame index, same camera** — `camera.jsonl` is the alignment authority; any pass not written per-frame from the same `frame_set(f)` is corrupt.
- **Data passes use `Standard` view transform**, beauty uses `AgX` — never grade control passes through the display transform.
- **Depth normalization bounds live in the manifest** (`near`/`far`) and `camera.jsonl` (`depth_near`/`depth_far`) — consumers must not re-derive them.
- **Storage valve**: `pass_scale < 1` downscales control passes only; beauty stays scene-native.

### 5. Edit-track layering (downstream, mostly Remotion/ffmpeg)

The video-editor/Remotion compositions layer: background scene render → character/foreground elements → captions → grade. Current state:

- Frame sequences enter via `frames_dir` + `frame_pattern` (`frame_%04d.png` convention, enforced by `frame_sequence.py` gap detection).
- The ffmpeg renderer **refuses gapped sequences** — a missing middle frame would silently shorten the video; layering integrity is checked before mux.
- Media Library hides raw frame dumps (`frame_NNNN` guard in `outputs_scanner.py`) — sequences surface as their composited video, not 360 grid tiles.

## Blender 5.2 layering gotchas (verified)

- Compositor is `scene.compositing_node_group` + `NodeGroupOutput` sink — no `scene.node_tree`.
- Output File node: `media_type='IMAGE'` unlocks PNG (default `MULTI_LAYER_IMAGE` forces EXR multilayer); `FLOAT` items force EXR — use `RGBA` items for gray data.
- `file_name` gets frame suffixes only in animation renders; still-mode needs per-frame `file_name`.
- RLayers sockets in 5.x: `Depth` (not `Z`), `Normal`, `Mist` — **no `IndexOB`**; object IDs come via Cryptomatte (`CryptoObject00-02`) which needs manifest decode.
- `use_nodes` deprecated on World/Material (removal in 6.0) — set `node_tree` directly where possible.

## Anti-patterns

- **Layer per object.** Draw calls and render time scale linearly; group by *band* and *iteration rate*, not by scene-graph node.
- **Compositor order bugs.** Render-layer stacking order in the compositor is what counts, not collection order — wrong order puts background mountains over foreground.
- **Grading control passes.** Depth/normals through AgX/OCIO display transform destroys the data; use `Standard`.
- **Claiming un-emitted passes.** The manifest rule applies to layers too — if a layer didn't render, it isn't in the manifest.
- **Spec-order dependence for layering.** Relations resolve in spec order by design (determinism); don't rely on collection order or outliner order — those aren't hashed.

## Status

| Piece | State |
|---|---|
| Spec relations (`in-front-of`/`behind`/`on`) | designed (scene-spec §5) |
| Depth bands ↔ budget roles | documented here; enforced via `check-asset-budget.py` |
| Multi-view-layer fg/mg/bg renders | not implemented (deliberate — capture contract doesn't need it yet) |
| Package passes as aligned layers | implemented (beauty/normals/depth/camera) |
| Cryptomatte segmentation decode | v1.1 |
| Edit-track layering + gap guard | implemented (`frame_sequence.py`, ffmpeg renderer) |

## Related

- [[3d-bones-ai-skin-pipeline-2026|3D bones / AI skin pipeline]] — the frame-package contract and the five gaps this layering model serves
- [[pascal-3d-budget-discipline-2026|Pascal 3D budget discipline]] — role caps that define the depth bands
- [[three-js-render-motion-2026|Three.js render + motion]] — determinism discipline mirrored bpy-side
- Plan docs (not KB): `docs/plans/frame-package-contract-2026-11.md`, `docs/plans/scene-spec-v0-2026-11.md`, `docs/plans/control-conditioned-lane-2026-11.md`
