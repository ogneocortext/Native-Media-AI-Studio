# ComfyUI MCP Integration

## Overview

ComfyUI MCP connects ComfyUI to Kilo Code via the Model Context Protocol (MCP). It enables AI agents to drive ComfyUI workflows in natural language — generating images, videos, and 3D models through ComfyUI's node-based graph interface.

## Architecture

```
AI Agent (Kilo Code) → comfyui-mcp (npx) → ComfyUI REST API (port 8188) → ComfyUI
```

## Prerequisites

1. **ComfyUI** running at `http://localhost:8188`
2. **comfyui-mcp** package available via npx (pre-cached)
3. **Hunyuan3D-2mini** model installed in ComfyUI for 3D generation

## Configuration (opencode.json)

```json
{
  "mcp": {
    "comfyui": {
      "type": "local",
      "command": ["npx", "-y", "comfyui-mcp", "--comfyui-url", "http://localhost:8188", "--force-remote"],
      "enabled": true
    }
  }
}
```

## Available Tools

The ComfyUI MCP server exposes tools for:

| Category | Tools |
|----------|-------|
| **Workflow Management** | `list_workflows`, `get_workflow`, `upload_workflow`, `run_workflow` |
| **Image Generation** | `txt2img`, `img2img`, `inpaint`, `outpaint` |
| **Video Generation** | `txt2video`, `img2video`, `animate` |
| **3D Generation** | `hunyuan_3d`, `tripo` |
| **ComfyUI Control** | `get_queue`, `get_status`, `cancel_job`, `clear_queue` |
| **Node Management** | `get_node_info`, `set_node_input`, `get_node_templates` |

## Music Video Workflows

### Generate Image Assets

Use ComfyUI MCP to generate visual assets for music video production:

1. **Concept art**: Generate stage backgrounds, character designs, album art
2. **Texture generation**: Create procedural textures for Unity/Blender materials
3. **Reference images**: Generate visual references for 3D modeling

### 3D Model Generation

The ComfyUI MCP can generate 3D assets via Hunyuan3D-2mini:

```bash
# Uses ComfyUI-Hunyuan3DWrapper for 3D model generation
# Model stored at: ComfyUI/models/diffusion_models/hunyuan3d-2mini
# Output: .glb or .obj files for Unity/Blender import
```

### Video Generation

- Text-to-video via Wan, LTX-Video, and other models
- Image-to-video for style-consistent animation
- Frame interpolation for smooth beat-synced motion

## ComfyUI Management

The backend service at `packages/backend/app/services/comfyui_manager.py` manages the ComfyUI process:

- **Start/Stop**: Managed via `scripts/start-studio.ps1` or `scripts/manage-servers.ps1`
- **Location**: `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI` (sibling to repo)
- **Python venv**: Uses project venv at `venv/Scripts/python.exe`
- **VRAM optimization**: `--disable-pinned-memory` flag for GTX 10-series compatibility

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "Cannot connect to ComfyUI" | ComfyUI not running | Start with `scripts/start-studio.ps1` or check port 8188 |
| "Model not found" | Hunyuan3D not downloaded | Download to `ComfyUI/models/diffusion_models/hunyuan3d-2mini` |
| "Remote connection failed" | `--force-remote` not working | Remove `--force-remote` if running locally |

## See Also

- [Unity MCP Skill](./unity-mcp/SKILL.md) — Unity scene generation
- [Blender MCP Skill](./blender-mcp/SKILL.md) — Blender 3D rendering
- `packages/backend/app/services/comfyui_manager.py` — Backend ComfyUI management