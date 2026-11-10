---
name: blender-mcp
description: >-
  Drive Blender 5.2 — interactively through the blender-mcp MCP server
  (GUI Blender, socket port 9876, upstream protocol 15 / repo fork
  protocol 4) or headless via `blender --background --python`. Use for
  scene creation, modeling, rendering, rigging/export pipelines, and
  music-video asset production — not for ComfyUI or Unity work.
---

# Blender MCP Integration

## Overview

Blender MCP connects a **live GUI Blender 5.2** session to the agent via a
socket bridge on port 9876. Use it for interactive authoring, viewport
screenshots, scene inspection, and iterative QA. For reproducible,
unattended, or CI work use **headless Blender** instead — see below.

> [!warning] Two MCP stacks share port 9876 and are NOT interchangeable:
> the repo-local `tools/mcp/blender-mcp-bridge.mjs` + `tools/blender_mcp_addon.py`
> fork (protocol 4) and the upstream `mcp-for-blender`/`blender-mcp` stack
> (protocol 15, addon 1.8, configured via `opencode.json`). Only one can
> listen at a time — check `get_addon_status`/scene info before assuming
> which tools exist. The repo-local addon refuses `bpy.app.background`;
> MCP always requires GUI Blender.

## Architecture

```
AI Agent → MCP bridge (uvx/npx) → Blender socket (port 9876) → Blender 5.2 Editor (GUI)
AI Agent → blender --background --python <script>  → headless, no MCP
```

## Headless vs MCP — pick deliberately

| Need | Use |
|---|---|
| Interactive scene authoring, viewport screenshots, visual iteration | MCP (`get_scene_info`, `get_viewport_screenshot`, `execute_code`) |
| Rigging/skin/export/clip pipelines, batch conversion, CI, unattended renders | `blender --background --python tools/...py` — committed bpy scripts are the source of truth |

Headless pattern already in repo: `tools/blender/builder.py`,
`tools/characters/house_rig.py`, `skin_weights.py`, `idle_clip.py`,
`tools/convert_blend_to_glb.py`. Every pipeline step should be runnable as
`blender --background --python <script> -- <args>`.

Blender 5.x pitfalls (full detail:
`docs/knowledge-library/blender-headless-vs-mcp-character-pipeline-operations-guide-2026.md`):

- **Slotted Actions** replaced `action.fcurves` — code assuming the old API
  breaks (the repo addon has a live `_snapshot_animation` bug here).
- glTF animation export needs `export_animation_mode='ACTIONS'` +
  NLA-stashed actions for named clips.
- Compositor property names changed; look nodes up by type, not name.

## Prerequisites

1. **Blender 5.2** installed at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`
2. **Blender MCP Addon** — upstream `mcp-for-blender` reports protocol 15 /
   addon `[1, 8]` on Blender 5.2.3 LTS; the repo-local fork is protocol 4 /
   addon 1.5 (`tools/blender_mcp_addon.py`). Install via `uvx blender-mcp install-addon`
   or Edit → Preferences → Add-ons.
3. **Start MCP Server** in Blender: 3D Viewport sidebar → BlenderMCP tab → "Start MCP Server"

## Connection Verification

```bash
# Which stack answered? Protocol version tells you.
# Via MCP tools: get_addon_status / get_scene_info
# Headless smoke test:
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python-expr "import bpy; print(bpy.app.version_string)"
```

## Available Tools (upstream protocol 15)

The active upstream stack exposes a smaller, code-first surface — prefer
`execute_code` (arbitrary `bpy` in the live scene) over per-object helpers:

| Category | Tools |
|----------|-------|
| **Inspection** | `get_addon_status`, `get_scene_info`, `get_object_info`, `get_viewport_screenshot`, `get_polyhaven_categories`, `search_polyhaven_assets`, `download_polyhaven_asset` |
| **Authoring** | `execute_code` (run `bpy` Python in Blender — the workhorse), `describe_node_type`, `bpy_api_lookup` (verify API before guessing) |
| **Viewport** | `get_viewport_screenshot` returns inline image data; for vision-model QA, render to a file under `output/qa/` and analyze with `tools/vision/analyze.mjs` instead |

The repo-local protocol-4 fork exposes a different, larger tool list — do
not assume tool names carry over between stacks; call `get_scene_info` /
`get_addon_status` first to learn which protocol answered.

> [!warning] `execute_code` runs in the **GUI** Blender only. It cannot
> substitute for `blender --background --python` batch jobs, and the
> repo-local addon explicitly refuses background mode.

## Music Video Workflows

### Create a Beat-Synced 3D Scene

1. Analyze audio: `python tools/analyze_and_sync.py <audio_file>` → generates `beat_data.json`
2. Read beat data: tempo, beat_times, keyframes (24fps)
3. Create Blender objects and insert keyframes at beat intervals
4. Set camera and lighting for cinematic shots
5. Render animation sequence

## Backend Integration

The backend service at `packages/backend/app/services/blender/` provides Python tooling that generates complete Blender scripts for music video production:

| Module | Purpose |
|--------|---------|
| `builder.py` (26.5 KB) | BlenderSceneBuilder — generates bpy scripts for stages (concert, abstract, nature, urban, space), characters, cameras, beat-synced animation |
| `lyrics_sync.py` (5 KB) | LyricsSyncMapper — maps timed lyrics to animation events, aligns to beats, supports WhisperX output |

### Backend 3D Generation

| Service | Description |
|---------|-------------|
| `app.services.gen3d` | Text-to-3D and image-to-3D via Hunyuan3D-2mini (optimized for 8GB VRAM) |
| `app.services.cuda.processor` | GPU-accelerated audio analysis: torch.stft() FFT, spectral features, onset detection |
| Hunyuan3D-2mini model | `ComfyUI/models/diffusion_models/hunyuan3d-2mini` (~2.5GB) |

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/health/gpu` | GPU snapshot (CUDA availability, VRAM, temperature) |
| `/api/health/3d/status` | 3D generation service status |
| `/api/health/3d/generate` | Trigger 3D model generation |

## Existing Renders

| File | Size | Description |
|------|------|-------------|
| `tools/blender_render.png` | 182 KB | Initial scene render |
| `tools/blender_render2.png` | 774 KB | Lighting iteration |
| `tools/blender_render3.png` | 878 KB | Material iteration |
| `tools/blender_render4.png` | 913 KB | Final render |
| `tools/architects_ghost_stage.png` | 892 KB | Stage preview |
| `tools/demo_stage.png` | 89 KB | Demo stage overview |

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "Cannot connect to Blender" | Blender MCP server not started | 3D Viewport sidebar → BlenderMCP tab → Start MCP Server |
| "Addon outdated" | Protocol mismatch | `uvx blender-mcp install-addon`, restart Blender |
| "Blender not found" | Wrong executable path | Set `BLENDER_EXECUTABLE` in `opencode.json` |
| "3D model gen failed" | API key missing | Set `RODIN_API_KEY` or `HUNYUAN3D_API_KEY` |

## See Also

- [Unity MCP Skill](./unity-mcp/SKILL.md) — Unity scene generation
- `tools/analyze_and_sync.py` — Audio analysis for beat sync
- `tools/blender_mcp_addon.py` — Blender addon source (v1.5)
