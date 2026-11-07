---
tags:
  - performance
  - hardware-pascal
  - 3d
  - three-js
aliases:
  - Pascal 3D Budget Discipline 2026
  - Real-Time 3D Budgets
cssclasses:
  - performance-guide
date: 2026-11-06
type: source
status: current
---

# Real-Time 3D Budget Discipline for Pascal-Class Hardware

Companion to [[pascal-gpu-optimization-2026]]: that doc covers the
*inference* side of the GTX 1070 Ti (PyTorch, attention, VRAM stack for
generation models). This one covers the *render* side — the budgets a
real-time 3D scene must respect on the same card, and the pipeline rules
that enforce them. It exists because the studio's 3D content is
AI-generated, and generated content arrives with the opposite profile
of what this hardware renders well.

## 1. The inversion: generated assets are anti-budget

Classic-era games run at playable framerates in a browser tab (the
OpenLara engine reimplementation running 1996 Tomb Raider content over
WebGL/WebAssembly is the standing example) not because of any
rendering trick, but because their content was authored to brutal
budgets: small textures, models in the hundreds-to-thousands of
triangles, levels pre-partitioned for visibility, lighting baked or
per-vertex, no dynamic shadow stacks. The PS2 shipped with 4 MB of
VRAM; nothing was ever "just loaded at full size."

This studio's assets invert every one of those properties. A TripoSR /
Hunyuan output is a dense mesh with a large uncompressed texture, no
LOD chain, no atlas, lit dynamically. The one budget mechanism that
exists today is a single flat decimation target —
`decimate_glb.py` defaults to 50,000 faces and `gen3d_service.py`
applies one target regardless of the asset's role — and there is no
texture budget at all. A background prop and a hero asset currently
cost the same by construction.

## 2. What is actually scarce on a 1070 Ti

The card's raster throughput (~6.5 TFLOPS FP32) is not the constraint
for scene rendering; it is stronger than the hardware the classic
techniques below were written for. The scarce resources are:

- **Memory bandwidth** — 256 GB/s. At 60 fps that is ~4.3 GB of total
  traffic per frame for *everything* (geometry, textures,
  framebuffers). Oversized uncompressed textures spend it fastest.
- **VRAM capacity** — 8 GB, shared with whatever generation workload
  is resident. Scene textures must leave room, not take the card.
- **CPU frame time** — every draw call and state change is CPU work
  before it is GPU work; in a JavaScript runtime it is also GC-visible
  work. Draw calls are a CPU budget first.
- **Absent features** — no mesh shaders, no ray tracing, no tensor
  path. The DX9/PS3-era playbook is not a compromise on this card; it
  is the native literature for it.

## 3. The budgets (1080p, 60 fps target, real-time surfaces)

Starting budgets for Three.js / Unity real-time scenes, to be tuned by
measurement (§7), not treated as laws:

| Budget | Target | Hard cap / rule |
|---|---|---|
| Draw calls per frame | ≤ 150 | 300 |
| Visible triangles per frame | ≤ 1.5M | — |
| Triangles per asset, by role | hero ≤ 250K · mid ≤ 50K · background ≤ 10K | far = impostor card, not a mesh |
| Scene texture memory | ≤ 1 GB | KTX2 for every shipped texture |
| Single texture size | hero ≤ 2048² · background ≤ 1024² | — |
| Unique materials per scene | ≤ 40 | share before adding |
| Dynamic lights | ≤ 3 | everything else baked (lightmap / AO) |
| Bones per skinned mesh | ≤ 64 | active skinned meshes ≤ 8 |
| Repeated element (≥ 4 instances) | InstancedMesh | never N separate meshes |

Offline Blender renders relax the per-frame numbers, but texture
memory still binds on 8 GB — the texture rules above apply there too.

## 4. Pipeline rules (generation → asset)

1. **Decimation is per-role, not flat.** `target_faces` becomes a role
   lookup (hero / mid / background per §3). The flat 50K default is
   the mid role wearing a universal costume.
2. **Textures are post-processed at generation time**: downscale to
   the role cap and convert to KTX2 before the asset enters the
   library. An asset that skips this step is unfinished.
3. **LOD ships with the asset**: LOD0 / LOD1 / LOD2 plus a rendered
   sprite card for the far tier, generated once at ingest — never
   authored by hand per scene.
4. **Small props are atlased** into shared sheets at ingest so a scene
   of fifty props is a handful of texture binds, not fifty.
5. **Every asset carries a budget report** (triangles, texture MB,
   material count, LOD presence) in its generation result, so a
   violation is visible at generation time instead of at render time.

## 5. Scene and runtime rules

1. **Instancing collapses repetition.** The reference result from the
   GPU Gems 3 crowd chapter: ~10,000 independently animating
   characters in ~13 draw calls at 30 fps on 2007 hardware (Core 2 Duo
   + 8800 GTX), by instancing submeshes, baking animation into a
   texture the vertex shader samples, and assigning LOD per instance
   per frame. The lesson that transfers: draw-call count is a design
   decision made in the scene spec, not a property of how much stuff
   is on screen.
2. **Impostors end the LOD chain.** A billboard card whose cost scales
   with screen pixels, not polygons (the impostor chapter rendered a
   quarter-million-object ring in real time on a GeForce 6800-class
   card). Swap by screen-size threshold: when the projected error of
   the card is below the visible threshold, the mesh goes away.
3. **Static geometry merges; materials are shared.** Scene assembly
   (T-VID-05's builder) merges static meshes by material and refuses
   to emit a scene over the material cap without an explicit override.
4. **Bake what does not move.** Static lighting and AO are textures,
   not per-frame light calculations; the dynamic-light cap in §3 is
   what remains for genuinely moving lights.
5. **Visibility is authored, not discovered.** Interiors use zone /
   portal partitioning declared in the scene spec (the room discipline
   classic engines were built on); frustum culling stays on
   everywhere else.
6. **Transparents are depth-sorted** and kept few — overdraw is a
   bandwidth spend, and §2 is the account it draws from.

## 6. CPU-side frame rules (the other half of the frame)

Distilled from *Game Programming Patterns*, Optimization Patterns:

1. **Dirty flags on scene updates.** A property driven by an
   audio-reactive binding recomputes only when its driving feature
   actually changed beyond an epsilon; a static scene graph costs ~0
   per frame, not one matrix pass per object per frame.
2. **Object pools for per-frame values.** Anything allocated per frame
   in the render loop (vectors, matrices, event payloads) comes from a
   pool; GC pauses are frame spikes, and they are self-inflicted.
3. **Data locality for hot loops.** Per-frame audio-reactive data
   lives in flat typed arrays processed in order (the visualizer's
   precomputed-envelope design already follows this — extend it, don't
   reinvent it). The book's measured demo of this point: the same
   computation runs ~50× slower when organized to miss the cache.
4. **Spatial partition for queries.** Anything that asks "what is
   near / visible / colliding" over a scene uses a partition
   structure, never a full-scene scan per query.

## 7. Measurement

These numbers are starting hypotheses under the repo's measure-first
rule. The meter already exists: RenderStatsBadge surfaces draw calls
and frame timing in the visualizer (T-VIZ-17/18 work). Each scene
class gets one headed measurement pass against §3; where measurement
and budget disagree, the budget moves and the change is recorded here
with its evidence — the same discipline as
[[pascal-gpu-optimization-2026]] applies to its own numbers.

## Sources and posture

Written under the [[external-book-sources-2026]] policy: sources were
studied privately; nothing here reproduces their text. Distilled from
NVIDIA *GPU Gems 3* (free HTML on the NVIDIA developer site) —
Chapter 2, Animated Crowd Rendering, and Chapter 21, True Impostors,
read in full; *Game Programming Patterns* (Nystrom, full text free
online) — Data Locality read in full, the remaining Optimization
Patterns applied from the book's pattern set; *LearnOpenGL*
(de Vries, free online) as the pipeline/instancing reference for what
Three.js r186 abstracts away. Implementation targets are the repo's
own surfaces: `packages/backend/app/services/gen3d/` (decimation,
ingest), the T-VID-05 scene builder, and the Three.js studio /
visualizer (InstancedMesh, KTX2Loader).

## Related

- [[pascal-gpu-optimization-2026]] — the inference-side companion
- [[three-js-render-motion-2026]] — deterministic export and motion
- [[external-book-sources-2026]] — the policy this doc was written under
- T-VID-05 (scene builder design) — consumes these budgets as spec validation
- T-VID-12 (task) — encodes these budgets in the asset + scene pipeline
