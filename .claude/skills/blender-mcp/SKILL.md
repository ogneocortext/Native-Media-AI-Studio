---
name: blender-mcp
description: >-
  Drive Blender 5.2 through the blender-mcp MCP server (uvx bridge, addon
  protocol 4, socket port 9876): scene creation, modeling, rendering, and
  music-video asset production. Use when a task requires creating or
  manipulating Blender scenes, generating 3D assets inside Blender, or
  verifying the Blender MCP connection — not for ComfyUI or Unity work.
---

# Blender MCP Integration

## Overview

Blender MCP connects Blender 5.2 to Kilo Code via the Model Context Protocol (MCP). It enables AI agents to create and manipulate 3D scenes, generate models, render animations, and build complete music video productions directly from Blender.

## Architecture

```
AI Agent (Kilo Code) → blender-mcp (uvx) → Blender socket (port 9876) → Blender 5.2 Editor
```

## Prerequisites

1. **Blender 5.2** installed at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`
2. **Blender MCP Addon** (v1.5, protocol 4) — install via `uvx blender-mcp install-addon` or in Blender: Edit → Preferences → Add-ons → Install → `tools/blender_mcp_addon.py`
3. **Start MCP Server** in Blender: 3D Viewport sidebar → BlenderMCP tab → "Start MCP Server"

## Configuration (opencode.json)

```json
{
  "mcp": {
    "blender": {
      "type": "local",
      "command": ["uvx", "blender-mcp"],
      "environment": {
        "BLENDER_EXECUTABLE": "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe"
      },
      "enabled": true
    }
  }
}
```

## Connection Verification

```bash
uvx blender-mcp --version
# Expected: "Blender addon up to date (protocol 4, addon [1, 5], Blender 5.2.0 LTS)"
```

## Available Tools

The Blender MCP server exposes tools for:

| Category | Tools |
|----------|-------|
| **Scene Management** | `get_world_state`, `get_scene_info`, `set_scene` |
| **Object Creation** | `create_cube`, `create_sphere`, `create_cylinder`, `create_cone`, `create_torus` |
| **Object Manipulation** | `move_object`, `rotate_object`, `scale_object`, `delete_object` |
| **Materials** | `set_material`, `add_texture`, `set_shader`, `set_material_color` |
| **Animation** | `insert_keyframe`, `set_keyframe`, `set_pose` |
| **Lighting** | `add_light`, `set_light_properties`, `set_world_background` |
| **Camera** | `set_camera`, `set_camera_position`, `camera_dolly` |
| **Rendering** | `render_image`, `render_animation`, `set_render_settings` |
| **3D Models** | `generate_3d_model` (Hunyuan3D), `import_asset`, `load_sketchfab` |
| **Assets** | `download_polyhaven_asset`, `download_sketchfab_model` |
| **Modifiers** | `add_modifier`, `apply_modifier`, `remove_modifier` |

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
