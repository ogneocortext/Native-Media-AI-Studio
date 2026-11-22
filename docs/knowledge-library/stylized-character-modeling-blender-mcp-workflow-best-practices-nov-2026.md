---
tags:
  - technical
aliases:
  - character modeling best practices
  - blender mcp workflow
  - low poly game character
cssclasses:
  - technical-guide
date: 2026-11-22
type: synthesis
---

> [!info] Purpose
> Distilled best practices (researched Nov 2026) for improving stylized low-poly
> characters authored/iterated through Blender MCP — applied to hero_dj
> (T-VIZ-55) and reusable for future character work in this repo.

---

## Overview

Research pass before improving `hero_dj.glb`'s geometry. Sources: stylized
game-asset topology guides (Tripo, Creatune case study, QuickPoly, Theseus
thesis), AI×Blender agent workflows (JQ Visions, Codex+Blender walkthroughs),
and the Blender MCP ecosystem docs. Consensus is strong across sources.

## Character modeling rules (stylized low-poly, rigged)

- **Silhouette first, detail second.** Lock proportions in a grey-model
  blockout and approve before adding detail. Changing proportions after
  skinning/rigging multiplies correction cost (weights + cloth follow-through).
- **Spend polygons only where they deform or silhouette.** Clean quads/loops
  at shoulders, elbows, knees, mouth, eyes; triangles acceptable on flat,
  non-deforming areas. Avoid n-gons.
- **Edge loops follow deformation axes** — parallel to bend direction;
  radial loops around mouth/eyes for expression. Minimal loops at joints
  (often 3) placed to allow *exaggerated* stylized deformation.
- **Separate logical parts as separate meshes/materials** (jacket, shoes,
  skin, accent, face) — keeps retopo, texturing, and material swaps manageable.
- **Acceptance is visual, not metric.** Poly counts/vert counts don't prove
  quality — check recognizability at delivery scale from front/side/3-4
  views, and deformation in extreme poses.
- **Verify no open edges / consistent normals** before export; unified
  outward normals, quads dominant, real-world scale.

## Blender MCP / agent workflow rules

- **Work on a duplicate .blend, checkpoint before expensive ops** (topology
  changes, rig generation, batch animation). Never let the agent touch the
  only copy of a production file.
- **Stage-gated approvals**: blockout → approve proportions → detail →
  approve static state → rig → test extreme poses → animate. An agent that
  rigs a shape you haven't approved forces weight fixes on every change.
- **Inspect before mutating**: `get_scene_info` / `get_object_info` first;
  `execute_code` for everything else; `get_viewport_screenshot` for visual
  QA each gate.
- **Headless for reproducible steps, MCP for interactive look-dev** — the
  repo's split (see blender-headless-vs-mcp doc) holds: `blender -b --python`
  for pipeline steps, MCP `execute_code` for iterative sculpting/QA.
- **Blender 5.x addon reality (verified 2026-11-22)**: the mcp-for-blender
  addon is a single-file legacy addon at
  `%APPDATA%\Blender Foundation\Blender\<ver>\scripts\addons\blender_mcp.py`.
  After a minor-version upgrade the file does NOT carry over (issue #431) —
  reinstall per-version via `uvx mcp-for-blender@latest install-addon`, and
  if Blender was open during install, restart it (stale addon cache →
  "No module named blender_mcp").
- **glTF export gotchas**: animations export as named clips via NLA-stashed
  actions + `export_animation_mode='ACTIONS'`; this repo's
  `tools/characters/idle_clip.py` regenerates the idle clip deterministically
  because .blend files here don't retain action data.
- **Runtime material reality**: hero_dj renders through three.js
  `MeshToonMaterial` — Blender material work only matters via `baseColor`,
  `baseColorTexture`, and vertex/UV data. PBR niceties (roughness, metallic,
  normal maps) are discarded by the toon swap unless explicitly carried over.

## Applied to hero_dj (T-VIZ-55 follow-up)

The "underdeveloped" read traced to **geometry**, not shading: 690 verts of
assembled primitives (blocky head/hands, minimal deformation loops). The
texture pass (5 procedural maps, committed d14db430) added surface detail but
can't fix silhouette. Next lever per these rules: proportion-preserving
detail pass — bevels/loop cuts at silhouette edges (jacket hem, headphone
cups, shoe soles), quads at shoulder/elbow/knee deformation zones — then
re-export via `idle_clip.py` and re-verify in-scene.

## Related

- [[blender-headless-vs-mcp-character-pipeline-operations-guide-2026|blender-headless-vs-mcp-character-pipeline-operations-guide-2026]] :see-also
- [[stylized-3d-character-design-for-audio-reactive-visualization-2026|stylized-3d-character-design-for-audio-reactive-visualization-2026]] :see-also
