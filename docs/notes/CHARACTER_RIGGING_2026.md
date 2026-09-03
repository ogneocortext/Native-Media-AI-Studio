# Character Rigging 2026 — Status & Decision

> Rewritten 2026-09-03 (was a stub). Full audit: `docs/knowledge-library/character-driven-visualization-research.md`. Technique research: `docs/knowledge-library/silhouette-character-animation.md`.

## Status

Two character paths exist; both are dead ends for polished real-time results:

1. **`packages/backend/app/services/blender/builder.py::create_character`** — 5-bone stick rig skinned to a single beige cylinder. Cannot produce anything but placeholders.
2. **Hunyuan3D image→mesh (`gen3d_service.py`)** — unrigged static meshes ("visibly voxelized, blocky" per its own comments). A static mesh cannot perform to beats.

## Decision (2026-09-03)

- **Real-time path**: procedural SVG silhouette "Builder" figure (`BuilderFigure.tsx`), puppeteered per-frame from the live audio ref + storyboard acts. No faces, no AI anatomy.
- **Offline/hero path** (unchanged): the phased GLB/rigging plan in the research doc stays valid for pre-rendered hero shots.
- **Blender MCP scope**: hard-surface environments and props only — workbench, lamp, frost window. Never characters.
- **Acceptance test**: the Silhouette Test — every pose must read at thumbnail scale in pure black.
