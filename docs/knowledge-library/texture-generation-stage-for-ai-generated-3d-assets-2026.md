---
tags:
  - technical
aliases:
  - Texture generation stage for AI-generated 3D assets
cssclasses:
  - technical-guide
date: 2026-11-07
type: concept
---

> [!info] Purpose
> Spec for the missing stage between "AI generates a mesh" and "mesh looks like
> an asset": texture synthesis for gen3d output. Written 2026-11-07 after the
> asset inventory showed every generated GLB is untextured gray geometry.

---

## Problem

Every backend in `gen3d_service.py` (Hunyuan3D-2mini/mv, TripoSR,
Stable-Fast-3D, Point-E, Shap-E) emits geometry-first meshes. Hy3D outputs
are explicitly "geometry only" (`supports_texture: False` in
`MODEL_BACKENDS`); TripoSR/SF3D carry **vertex colors**, not UV textures.
Result: generated assets render as gray clay in `ModelPreview` (which
overwrites materials with a flat `MeshStandardMaterial`) and would look
identical in the visualizer stage. The `_apply_chrome_material` hack in
`_postprocess_glb` is a symptom, not a fix.

The pipeline today is: generate → decimate → KTX2 texture ingest →
budget check. **There is no step that creates textures.** KTX2 ingest only
compresses textures that already exist.

## Options (2026 landscape, GTX 1070 Ti / 8 GB Pascal constraints)

| Approach | Quality | VRAM/time cost | Fit for this stack |
|---|---|---|---|
| **Concept-image projection bake** (Blender headless: smart UV → project the SD1.5 concept image the pipeline already renders → bake) | Low–medium; single view, stretching on unseen sides | ~0 (CPU/GPU-light, Blender already installed) | **Best first stage** — the concept image already exists for text-to-3D; projection is deterministic and cheap |
| **Text2Tex / TEXTure-style iterative inpainting** (per-view diffusion + projection fusion) | High; multi-view consistent-ish | Heavy — needs a diffusion model resident; ~6–8 GB, slow on Pascal | Phase 2; may need cloud or careful VRAM scheduling via `vram_manager` |
| **SyncMVD / CRM texture models** | High | Very heavy (multi-view diffusion) | Not viable on 8 GB without cloud offload |
| **Hunyuan3D-Paint / Hy3DPaint texture branch** | High; same family as geometry model | ~8+ GB — exceeds budget alongside geometry stage | Only as a separate post-pass with full VRAM free; ComfyUI wrapper availability must be verified (vendor-drift check) |
| **Meshy/Tripo/Rodin cloud APIs** | High | None local | Requires API keys + sends prompts off-box; user has said cloud vision is dead/paid — treat as optional, not default |
| **Vertex-color → texture bake** (TripoSR/SF3D already emit vertex colors) | Low; soft blurry color | ~0 | Cheap win: bake vertex colors to a low-res texture so KTX2 ingest has something to compress and materials aren't flat gray |

## Recommended architecture

Insert a **texture stage** into `_postprocess_glb` between decimate and
`ingest-texture.py` (order matters: decimate first so UV/bake work happens on
the final polycount; KTX2 last so it compresses the result):

```
generate → decimate → TEXTURE STAGE → ingest-texture (KTX2) → budget check
```

Stage tiers, gated by role:

- **T0 — vertex-color bake (all roles, ~free):** if the mesh has COLOR_0 but
  no base-color texture, bake to a 512–1024 px texture in Blender headless.
  Fixes TripoSR/SF3D/Point-E outputs immediately.
- **T1 — concept projection (hero/mid):** the text-to-3D path already renders
  an SD1.5 concept image (`_build_hunyuan_text23d_workflow` stage 1). Reuse
  it: smart-UV-project the decimated mesh, project the concept image from the
  canonical 3/4 view, bake. For image-to-3D, project the user's reference
  image. Expected result: recognizable color/layout, imperfect but miles
  ahead of gray clay. Runs in the existing Blender headless pattern
  (`decimate_glb.py` precedent).
- **T2 — iterative refinement (hero only, opt-in):** per-view inpainting
  diffusion pass. Defer until T0+T1 prove the contract; requires a
  `vram_manager.work_lane` slot and a ComfyUI texture workflow.

## Contract

- New tool `tools/gen3d-texture.py` (mirrors `ingest-texture.py` structure:
  `glb` mode in/out in place, `--role`, non-fatal, reports under
  `texture_stage` in the generation result alongside `texture_ingest`).
- Output must carry `KHR_texture_basisu`-compatible PNG/JPEG sources that
  `ingest-texture.py` then compresses — the texture stage never emits KTX2
  itself.
- Budget: texture stage adds ≤ ~30 s (T0/T1) to post-processing; T2 is
  explicitly opt-in via request flag, never default.
- Deterministic where possible: fixed projection angle, seeded inpainting.

## Acceptance criteria

- A text-to-3D generation result includes a `texture_stage` report
  (ran/skipped/failed + method used).
- TripoSR output shows baked color instead of flat gray in ModelPreview.
- Hunyuan3D text-to-3D output shows concept-image colors on visible surfaces.
- `check-asset-budget.py` still passes/fails identically — texture stage
  must not change triangle counts (UV unwrap adds no geometry).
- Visual verification via the visualizer-mode-qa / ModelPreview screenshot
  loop, not assertion.

## Related

- [[texture-pipeline-ktx2-authoring-and-ingest-2026]]:see-also — downstream
  compression contract this stage feeds.
- [[pascal-3d-budget-discipline-2026]]:see-also — role caps the stage respects.
- [[stylized-3d-character-design-for-audio-reactive-visualization-2026]]:see-also
  — why untextured gray characters fail the silhouette-first design rules.
