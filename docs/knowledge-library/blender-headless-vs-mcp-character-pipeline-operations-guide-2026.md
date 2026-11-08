---
tags:
  - technical
aliases:
  - Blender Headless vs MCP: Character Pipeline Operations Guide
cssclasses:
  - technical-guide
date: 2026-11-08
type: synthesis
---

> [!info] Purpose
> Decide how each step of the rigged hero-character build (stylized
> DJ for the visualizer stage-env) should run — headless
> `blender -b -P` scripts vs live blender-mcp sessions — and record
> the Blender 5.x API pitfalls that break naive scripts.

---

## Overview

This repo drives Blender 5.2.3 two ways that are **not
interchangeable**:

1. **Headless CLI** — `blender --background --python script.py -- args`,
   invoked via `subprocess` from backend services. Proven pattern:
   `gen3d_service.py` decimate (180 s timeout), `texture_glb.py`
   T0/T1 texture stage (300 s), `generate_thumbnail.py`,
   `frame_package.py`, `tri_ladder.py`.
2. **Two different MCP stacks share TCP port 9876** and must not both
   bind it:
   - *Repo-local*: `tools/mcp/blender-mcp-bridge.mjs` → raw TCP JSON →
     `tools/blender_mcp_addon.py` (custom fork, protocol 4). Consumed
     by `BlenderAdapter`/`BlenderService`.
   - *Upstream*: `uvx mcp-for-blender@2.0.0` in `opencode.json` —
     richer tools (`describe_node_type`, `bpy_api_lookup`,
     `asset_creation_strategy`, Sketchfab/PolyHaven). Addon protocol
     is now 15 upstream vs this fork's 4.

Both MCP stacks require a **GUI Blender** with the addon server
started; `blender_mcp_addon.py` explicitly refuses `-b`. MCP adds
live viewport screenshots (`GPUOffScreen.draw_view3d`) and
human-edit capture — the QA loop headless cannot do. Headless adds
reproducible, timeout-bounded subprocess calls the backend already
uses.

## Capability matrix (character pipeline steps)

| Step | `blender -b -P` | MCP | Notes |
|---|---|---|---|
| Mesh cleanup / decimate / retopo | ✅ proven | ✅ same bpy | identical either way |
| UV unwrap | ✅ `smart_project` proven | ✅ | only live-unwrap feedback lost |
| Materials / Principled nodes | ✅ proven | ✅ | — |
| Bone creation (EditBone data API) | ✅ pure data, no context | ✅ | HouseRig_v1's ~49 bones are a data table |
| Rigify metarig → generate | ✅ `rigify.generate.generate_rig`, enable addon headless | ✅ | needs `addon_enable(module="rigify")` |
| Weight painting | ⚠️ `ARMATURE_AUTO` + `vertex_groups[].add()` scriptable; heat weights low quality on stylized meshes | ✅ human can hand-paint between calls | GUI wins for touch-up |
| Mixamo FBX import | ✅ `import_scene.fbx` params verified | ✅ easier iterate | retarget is bespoke script either way |
| NLA/action management, clip baking | ✅ | ✅ | Slotted Actions (4.4+) — see pitfalls |
| GLB export (skins + animations) | ✅ repo precedent (`convert_blend_to_glb.py`) | ✅ | `export_animation_mode='ACTIONS'` + NLA-stash per clip |
| Still renders (Workbench/Cycles/Eevee) | ✅ proven | ✅ | EEVEE `-b` works on this GPU; verify `scene.eevee.*` names vs 4.x |
| Viewport screenshots / visual QA | ❌ no `screen`/`window` in `-b` (5.2 `gpu.init()` may help) | ✅ addon's screenshot path | **MCP's killer feature** |
| Interactive sculpting / manual modeling | ❌ | ✅ | stylized hero benefits enormously |
| Long ops (>2 min) | ✅ subprocess timeout, raise as needed | ⚠️ bridge caps `execute_code` ~120 s; Blender keeps running after client timeout (zombie, no cancel) | batch → headless; MCP → chunk |

**Bottom line:** every pipeline *step* is headless-scriptable; what
headless lacks is interactive authoring affordances, viewport
screenshots for agent QA, and safe long-running MCP ops.

## Blender 5.x API pitfalls (verified against release notes + repo code)

1. **Slotted Actions (mandatory 5.0):** `action.fcurves`,
   `action.groups`, `action.id_root` **removed**. F-curves live at
   `action.layers[i].strips[i].channelbag(slot).fcurves`.
   `keyframe_insert` still manages slots. The repo addon's
   `_snapshot_animation` (`blender_mcp_addon.py:860`) still reads
   `action.fcurves` — broken on 5.x, fix to channelbag API if world
   snapshots matter.
2. **Bone hide/select moved** to `pose.bones[i]`, not edit bones.
3. **Mist pass renamed** (`mist_settings.start/.depth`) — already
   handled in `frame_package.py`.
4. **Compositor changes:** `Output File` `media_type` must be set to
   `'IMAGE'` (defaults to multilayer EXR); no `IndexOB` socket —
   `frame_package.py:19-28` documents all of this verified on 5.2.3.
5. **Geometry Nodes modifier API rewritten** (5.2) — irrelevant unless
   the character uses GN modifiers.
6. **`gpu.init()`** new in 5.2 — GPU access possible in `--background`.
7. **glTF export:** `export_animation_mode` ∈ `ACTIONS` (default;
   each action = one glTF animation named by action/NLA track),
   `ACTIVE_ACTIONS`, `NLA_TRACKS`, `SCENE`. Clip-library recipe:
   **stash each clip as its own NLA track, track name = clip name**,
   export `ACTIONS`.
8. **KTX2/BasisU:** Blender's glTF importer can't read
   `KHR_texture_basisu` — `texture_glb.py` already skips; export
   textured GLBs *before* KTX2 compression.
9. **Rigify in `-b`:** `preferences.addon_enable` writes user prefs —
   enable once interactively or in the build script.
10. **Eevee settings renamed** vs 4.x — Workbench is the safe preview
    engine (`texture_glb.py` precedent).

## Recommended workflow: three-phase hybrid

**Phase 1 — Interactive authoring via MCP (GUI Blender):** model the
stylized low-poly DJ; QA loop = `get_viewport_screenshot` after each
`execute_blender_code` chunk. Persist every action as bpy — the MCP
session is a debugging/preview surface, not the source of truth.

**Phase 2 — Rig + weights + animation (script-first, MCP-assisted):**
- HouseRig_v1 as a data table (~49 base / 61 hero bones,
  Mixamo-compatible names, ≤4 influences/vertex) → `EditBone` entries,
  pure headless-safe bpy.
- Weights: `ARMATURE_AUTO` first; `vertex_groups[].add()` fixes;
  interactive weight-paint only where heat weights fail.
- Clips: one NLA track per clip (name = clip name) → `ACTIONS` export.
  Mixamo FBX retarget per `browser-character-pipeline-verdicts-2026`
  §3 (name-map + two-bone IK foot-lock, 60 samples/s bake).
- Torture-test clip is the rig acceptance gate (arms overhead, ±90°
  pronation, fist, deep squat, high knee, head ±70°, jaw+blink).

**Phase 3 — Reproducible export (headless):** `.blend` →
`tools/convert_blend_to_glb.py hero_dj.blend --public` (Y-up, apply,
animation baking, Media Library + `/models/blends/`). Better: author
the whole build as one committed bpy script runnable identically via
`blender -b -P` and MCP `execute_code` — matches the repo's
spec→bpy-script philosophy.

## Gaps requiring new tooling

1. **No rigging/character bpy scripts exist** (greenfield): need
   `tools/characters/` — `house_rig.py` (bone table → armature),
   `skin_weights.py` (auto-weights + ≤4-influence enforcement, glTF
   hard limit), `retarget_mixamo.py`, `export_clips.py` (NLA-stash →
   `ACTIONS` GLB). All headless-safe.
2. **Repo MCP bridge is thin:** 120 s `execute_code` cap, no
   `describe_node_type`/`bpy_api_lookup`, screenshot returns filepath.
   Prefer upstream `mcp-for-blender` config for heavy authoring, or
   extend the bridge.
3. **Addon `_snapshot_animation` broken on 5.x slotted actions** (above).
4. **No weight/rig QA script** — T-VID-26's intake gate has a planned
   script seam but nothing implemented; the character build is the
   natural first consumer.
5. **`frame_package.py` pose pass deferred** pending the rigged
   character — this build creates that binding.
6. **Blender discovery duplicated 4×** (`config.py`, `gen3d-texture.py`,
   `native_open.py`, `convert_blend_to_glb.py`) with divergent
   candidate lists; `gen3d_service.py` hardcodes the 5.2 path —
   consolidate before adding call sites.

## Related

- [[browser-character-pipeline-verdicts-2026|browser-character-pipeline-verdicts-2026]] — HouseRig_v1 spec (49/61 bones, Mixamo names, offline retarget recipe)
- [[3d-bones-ai-skin-pipeline-2026|3d-bones-ai-skin-pipeline-2026]] — Gap 6 intake gate, bones/skin architecture
- [[ai-generated-mesh-topology-why-local-gen3d-output-is-not-rigging-ready-2026|ai-generated-mesh-topology-why-local-gen3d-output-is-not-rigging-ready-2026]] — why generated meshes can't be rigged; ranked character paths
- [[blender-mcp|blender-mcp]] — existing MCP integration doc
- [[texture-generation-stage-for-ai-generated-3d-assets-2026|texture-generation-stage-for-ai-generated-3d-assets-2026]] — T1 concept projection reuses this for hero texture

## Sources

- Repo: `tools/mcp/blender-mcp-bridge.mjs`, `tools/blender_mcp_addon.py`, `packages/backend/app/adapters/blender_adapter.py`, `packages/backend/app/services/gen3d/{decimate_glb,texture_glb,apply_chrome}.py`, `tools/convert_blend_to_glb.py`, `tools/blender/{builder,frame_package,tri_ladder}.py`, `packages/backend/app/api/native_open.py`
- Blender 5.0/5.1/5.2 release notes (slotted actions, compositor, GN API, `gpu.init()`), Blender glTF exporter 5.0 API listing
- Upstream `mcp-for-blender@2.0.0` (`uvx blender-mcp`), ahujasid/blender-mcp addon protocol history
