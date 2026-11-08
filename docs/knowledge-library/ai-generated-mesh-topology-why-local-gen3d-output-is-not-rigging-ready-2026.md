---
tags:
  - technical
aliases:
  - AI-Generated Mesh Topology: Why Local gen3d Output Is Not Rigging-Ready
cssclasses:
  - technical-guide
date: 2026-11-07
type: synthesis
---

> [!info] Purpose
> Diagnose why locally generated 3D meshes (Hunyuan3D-2mini/mv, TripoSR,
> Stable Fast 3D, Point-E, Shap-E) are unusable for rigging, and define
> the asset-intent contract + intake gate that keeps them in their
> correct role: props, blockouts, and texture references — not
> deforming characters.

---

## Overview

The generated "DJ character" failure (recognizable silhouette,
"extremely fragmented, chaotic topology, spindly limbs") is **expected
behavior, not a pipeline bug**. Every local generator we run produces
*visual-plausibility geometry*, not *deformation-ready topology*.

This document records the root cause, the 2025–2026 state of the art
for animation-ready AI characters, what can realistically run on the
GTX 1070 Ti (8 GB, sm_61), and the concrete contract this repo should
adopt.

## 1. Root cause: the representation cannot express animation topology

Feed-forward image/text-to-3D models do not generate "meshes" in the
artist sense. They generate a latent field — triplane NeRF (TripoSR),
SDF/octree + diffusion (Hunyuan3D-2.x), implicit functions (Shap-E),
point clouds (Point-E) — then extract a dense triangle surface:

- **TripoSR**: image encoder → triplane decoder → mesh extraction.
  Fast feed-forward reconstruction, not a topology model
  (arxiv.org/abs/2403.02151).
- **Stable Fast 3D**: adds UV unwrapping + optional remeshing, but its
  own CVPR 2025 supplement states the topology "is still not ideal for
  downstream applications" and a simple quad remesh is needed.
- **Hunyuan3D-2.x/2.1**: shape generation ~10 GB VRAM, texture ~21 GB —
  already over this machine's budget for the full pipeline.
- **Point-E / Shap-E**: prototype-grade; Point-E warns of noise,
  outliers, cracks; Shap-E is older research code.

The output optimizes for **shape/appearance reconstruction**, never
for:

- edge loops around shoulders, elbows, knees, hips, mouth, eyes;
- predictable deformation under skeletal motion;
- quad-dominant or animation-friendly topology;
- separated rigid parts, canonical T/A-pose, skin weights.

MeshAnything frames it academically: current extraction methods "rely
on dense faces and ignore geometric features" (arxiv.org/abs/2406.10163).

### Marching cubes makes it worse, not better

Marching-cubes extraction follows the scalar field grid, not
anatomical or mechanical logic. Even watertight output tears at joints
because polygons do not follow deformation zones. Blender's own manual:
automatic remeshers "do not produce topology suitable for deformation…
no perfect automatic tools exist for this right now; it has to be done
manually" (docs.blender.org retopology page).

**Watertight and riggable are different properties.**

### Single-image conditioning amplifies the problem

Hidden sides, limb interiors, and contact areas are hallucinated:
fingers/ears/jacket edges collapse, arms fuse to torso, backs of heads
are inconsistent. Hunyuan3D-2.1's issue tracker documents related
failures (UV splits that tear rigged meshes #108, degraded watertight
conversion #117; ComfyUI RemeshMesh clipping #17516).

### Our post-processing cannot fix this

`generate → decimate → texture → KTX2 → budget` treats every GLB the
same. Collapse decimation *reduces* count but has no anatomical
awareness — it makes chaotic topology worse around thin limbs and
joints. `tools/check-asset-budget.py` checks triangle/texture/LOD/bone
budgets but **not** manifoldness, boundary edges, component count, or
deformation readiness.

## 2. State of the art for animation-ready AI characters (2025–2026)

### Cloud/production generators now target rig-ready topology

| Service | What it offers | Fit |
|---|---|---|
| **Tripo P2 / Smart Mesh** | Native quad topology, clean edge flow, ≤50K tris; Auto Rig v3.0 (biped→serpentine), Mixamo or Tripo bone naming, GLB/FBX | High quality; API credits |
| **Meshy Smart Topology (t2/t2.5) + Remesh + Auto-Rig** | Clean low-poly tris or quad remesh to 300K faces; humanoid auto-rig; FBX/GLB | Best cloud fit for stylized low-poly; caveat: quad remesh is an even grid, not artist edge flow |
| **Rodin Gen-2.5 / Hyper3D** | Geometry-first, quad/tri, T/A-pose options; auto-rigging reported late-2026 (verify) | High geometry, rigging less proven |
| **Hunyuan3D 3.x / PolyGen 1.5 / Auto-Rigging API** | Artist-grade quad retopo + skeleton detection/skinning/FBX + preset motions | Potentially highest quality; **hosted/API only — no open weights** |

### Character-specific and part-aware research models

- **CharacterGen** (SIGGRAPH 2024, Apache-2.0): single image →
  canonical multi-view → textured mesh, explicitly targets rigging.
  Anime/character-focused; VRAM risk on 8 GB.
- **PartCrafter** (MIT, min 8 GB claimed): image → 2–16 semantically
  separated part meshes — attacks the fused-limbs problem directly,
  but does not solve edge flow.
- **Hunyuan3D-Omni** (~10 GB): skeleton/pose control — over budget.
- **MeshAnything V2 / MeshFlow**: dense-mesh → artist-like low-poly
  (≤1,600 faces) — promising for blockouts; license ambiguity
  (S-Lab non-commercial vs MIT metadata) must be resolved.
- **DreamCharacter-1**: claims animation-ready output; open
  weights/code unconfirmed — watch-list only.

## 3. Post-processing and rigging toolbox

### Mesh cleanup (all CPU — GPU is not the bottleneck)

`manifold3d` (Rust, validation/repair), MeshLib (commercial SDK),
Blender 3D Print Toolbox + tyFlow tyMeshRepair (non-manifold/degen
cleanup), MeshLab, trimesh (already likely available for metrics).

Order of operations for badly fragmented AI meshes:
inspect components → remove floating debris → merge by distance →
delete degenerate → unify normals → repair/split non-manifold →
fill holes where shape should close → voxel/quad remesh if still
unusable → decimate → UV unwrap → rig/skin → deformation QA.

### Automatic retopology

Blender QuadriFlow (needs manifold input), voxel remesh (uniform grid —
bad for deformation), Instant Meshes (BSD, unmaintained, risky on
fragmented input), QRemeshify/ReQuad/QuadWild (Blender 4.2+, GPL,
promising), Quad Remesher (~$110, commercial benchmark), RetopoFlow
4 (~$60, manual gold standard), or cloud retopo APIs.

### Auto-rigging

Mixamo (free, web, biped, needs clean T/A-pose), Auto-Rig Pro ($25–50
Blender add-on), **UniRig** (MIT, open-source skeleton+skin, claims
CUDA ≥8 GB — plausible local candidate), Make-It-Animatable
(Apache-2.0/CVPR 2025, Mixamo-format output, Pascal unverified),
Tripo/Meshy/Hunyuan cloud auto-rig.

Target rig for this repo: **HouseRig_v1** (Mixamo-compatible
49/61-bone) per `browser-character-pipeline-verdicts-2026.md`; ≤64
bones, ≤4 influences/vertex per `config/asset-budgets.json`.

## 4. What runs on the GTX 1070 Ti (8 GB, sm_61)

Generation: Hunyuan3D-2mini/mv (~5–6 GB), TripoSR, SF3D fit; full
Hunyuan3D-2.1 (~10 GB shape) does not; TRELLIS.2 (24 GB official)
only via unverified community 8 GB paths; PartCrafter borderline.

Everything after generation — cleanup, retopo, UV, Mixamo — is
CPU/web and unaffected by VRAM. Learned rigging (UniRig, MIA) needs
separate CUDA env testing on Pascal.

## 5. Ranked pipeline options for the hero character

1. **Rigged stylized base + AI concept/texture overlay** (recommended):
   author or source a clean low-poly DJ → Mixamo/Auto-Rig Pro/UniRig →
   HouseRig_v1 → toon + KTX2 → use existing T1 texture projection for
   AI-generated surface detail. Generated meshes become concept art,
   props, and blockouts only.
2. **Cloud production path**: concept image → Meshy Smart Topology or
   Tripo P2 quad → auto-rig → GLB → Blender normalize to HouseRig_v1 →
   KTX2/toon ingest. Best AI-identity fidelity; API cost + license
   review required.
3. **Fully local automated path**: generate blockout → trimesh/
   manifold3d cleanup → QRemeshify/Instant Meshes/Quad Remesher →
   UV unwrap → UniRig/Mixamo → normalize. Medium effort, medium
   quality — expect manual retopo on a hero.
4. **PartCrafter part-separated generation**: experimental; separates
   limbs/props/head before cleanup.
5. **Watch-list**: CharacterGen, DreamCharacter-1, Hunyuan3D-Omni,
   MeshAnything V2 — VRAM/license/integration uncertainty.

**Not for rigging:** raw Point-E, Shap-E, TripoSR, Hunyuan3D-2mini/mv
output — blockouts/thumbnails/texture references/props only.

## 6. Repo contract to adopt

- **Asset intent on every gen3d result**: `prop_or_environment` (full
  postprocess OK), `blockout_reference` (never rigged),
  `hero_candidate` (must pass topology + rig gate).
- **Topology-quality gate** (`tools/check-mesh-topology.py` or extend
  `check-asset-budget.py`): component count, boundary/open edges,
  non-manifold edges/vertices, degenerate faces, self-intersection
  estimate, UV islands, skin/joint count, max influences, T/A-pose
  heuristic, optional deformation smoke test.
- **Suggested hero thresholds**: ≤20K tris, ≤64 bones (HouseRig_v1
  49/61), ≤4 influences/vertex, no unintended boundary/non-manifold,
  UV atlas, KTX2, passes squat/arm-raise/head-turn without tearing.
- **Blender retopo stage** (`services/gen3d/retopo_glb.py`, same
  headless pattern as `decimate_glb.py`): merge-by-distance → loose/
  degenerate cleanup → optional make-manifold → optional quad remesh →
  decimate → UV unwrap → export. Non-fatal, reported as
  `retopo_stage` beside `decimate`/`texture_stage`/`budget`.
- **Immediate DJ character**: do not rig the current fragmented
  Hunyuan output. Use it as concept reference only; build/source a
  clean base, rig to HouseRig_v1, apply Mixamo performance clips,
  project concept art via T1, ingest KTX2/toon.

## Related

- [[browser-character-pipeline-verdicts-2026|browser-character-pipeline-verdicts-2026]] — HouseRig_v1 decision, license intake rules
- [[3d-bones-ai-skin-pipeline-2026|3d-bones-ai-skin-pipeline-2026]] — Gap 6 names this exact intake/retopology gate (T-VIZ-26)
- [[stylized-3d-character-design-for-audio-reactive-visualization-2026|stylized-3d-character-design-for-audio-reactive-visualization-2026]] — ≤20K tri / ~65 bone / toon+rim budget the hero must meet
- [[texture-generation-stage-for-ai-generated-3d-assets-2026|texture-generation-stage-for-ai-generated-3d-assets-2026]] — T0/T1 texture pipeline the overlay path reuses
- [[3d-generation-options-2026|3d-generation-options-2026]] — backend registry + Pascal VRAM budgets
- [[ollama-prompting-2026|ollama-prompting-2026]] :extends

## Sources

- TripoSR: arxiv.org/abs/2403.02151 · SF3D: github.com/Stability-AI/stable-fast-3d, openaccess.thecvf.com CVPR2025 supplemental · Point-E model card · Shap-E: arxiv.org/abs/2305.02463 · MeshAnything: arxiv.org/abs/2406.10163
- Bad-topology explainer: tripo3d.ai/blog/why-ai-3d-models-have-bad-topology · Marching cubes: sci.utah.edu/~etiene/pdf/mc33.pdf · Blender retopology manual
- Hunyuan3D-2.1 issues #108/#117 · ComfyUI issue #17516
- Tripo P2/rig docs: developers.tripo3d.ai · Meshy: docs.meshy.ai (models/remesh), meshy.ai remesh-vs-smart-topology blog · Rodin: scenario.com/models/rodin-gen-25 · Hunyuan PolyGen/Auto-Rigging: tencentcloud.com docs
- CharacterGen: charactergen.github.io, arxiv.org/abs/2402.17214 · PartCrafter: github.com/wgsxm/PartCrafter, arxiv.org/html/2506.05573 · UniRig: github.com/VAST-AI-Research/UniRig · Make-It-Animatable: github.com/jasongzy/Make-It-Animatable
- Cleanup/retopo: github.com/elalish/manifold, meshlib.io, Blender 3D Print Toolbox, tyFlow docs, instant-meshes, QRemeshify, requad, quadwild-bimdf, exoside.com/quadremesher, RetopoFlow
- Repo: `packages/backend/app/services/gen3d/gen3d_service.py`, `decimate_glb.py`, `tools/check-asset-budget.py`, `config/asset-budgets.json`, `docs/plans/tasks/visualizer.md` (T-VIZ-54)
