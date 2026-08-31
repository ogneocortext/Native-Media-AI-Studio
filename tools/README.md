# Unity MCP Bridge

Local MCP server that wraps Unity's REST API for Kilo Code integration.

## How It Works

1. Reads Unity's port descriptor (`Library/Pipeline/.unity-pipeline-port`) for auth token and port
2. Registers Unity commands as MCP tools
3. Translates MCP tool calls → Unity REST API (`POST /api/exec`)
4. Returns Unity responses as MCP tool results

## Setup

```bash
cd tools
npm install @modelcontextprotocol/sdk zod
```

## Usage

Configured automatically via `opencode.json`:
```json
{
  "mcp": {
    "unity": {
      "type": "local",
      "command": ["node", "tools/mcp/unity-mcp-bridge.mjs"],
      "environment": {
        "UNITY_PROJECT_PATH": "D:\\path\\to\\unity-project"
      }
    }
  }
}
```

## Tools Provided

- `unity_command` — Generic proxy for any Unity command
- `create_gameobject` — Create primitives
- `add_component` — Add components
- `capture_scene_view` — Screenshot Scene view
- `editor_status` — Get Editor state
- `create_scene` — Create new scenes
- `create_animation_clip` — Create animation clips

## Authentication

The bridge auto-reads the bearer token from Unity's port descriptor file. No manual token management needed.

---

## MCP Server Overview

This directory contains MCP bridge servers and demo scripts for AI-driven music video creation. All MCP servers are configured in `opencode.json` at the repo root.

| Server | Command | Port | Status |
|--------|---------|------|--------|
| **Unity MCP** | `node tools/mcp/unity-mcp-bridge.mjs` | 7800 (REST) | Running (Unity 6000.5.1f1) |
| **Blender MCP** | `uvx blender-mcp` | 9876 (socket) | Running (Blender 5.2) |
| **ComfyUI MCP** | `npx comfyui-mcp --comfyui-url http://localhost:8188` | 8188 | Running |
| **Remotion MCP** | `npx -y @remotion/mcp@latest` | stdio | Configured |

---

## Blender MCP

Connects Blender to Kilo Code via MCP. The `blender_mcp_addon.py` addon (v1.5, protocol 4) must be installed in Blender.

### Setup
```bash
# Install addon in Blender: Edit -> Preferences -> Add-ons -> Install
# Start MCP Server in Blender sidebar: BlenderMCP tab -> Start MCP Server
uvx blender-mcp --version  # Verify connection
```

### Tools Provided
- Scene management, object creation/manipulation, materials, animation, lighting, camera, rendering
- 3D model generation via Hunyuan3D-2mini
- Asset downloads from Poly Haven and Sketchfab

See `.kilo/skills/blender-mcp/SKILL.md` for full documentation.

---

## ComfyUI MCP

MCP server for ComfyUI, enabling natural language control of ComfyUI workflows.

### Setup
```bash
# ComfyUI must be running on port 8188
npx -y comfyui-mcp --comfyui-url http://localhost:8188 --force-remote
```

---

## Remotion MCP

Documentation and best-practices integration for Remotion (video compositing library).

### Setup
```bash
npx -y @remotion/mcp@latest
```

---

## Audio Analysis & Beat Sync

### Scripts
- `analyze_and_sync.py` — Analyze audio and generate Unity beat-synced animation data (JSON with tempo, beat_times, keyframes)
- `analyze_happyshrimp.py` — GPU-accelerated analysis demo using CUDA
- `demos/demo_all_features.py` — Full feature demonstration
- `demos/demo_audio_analysis.py` — Audio analysis demo

### Usage
```bash
python tools/analyze_and_sync.py <audio_file> [--output <json_file>] [--fps 24]
```

---

## Testing

- `tests/test_mcp.py` — Test MCP server via HTTP (port 9876)
- `tests/test_mcp_stdio.py` — Test Blender MCP via stdio

---

## Generated Assets

### Unity Renders
- `unity-project-mcp/Assets/Textures/auto_frame_0001-0240.png` — 240 frames (10s @ 24fps)
- `beat_001.png` through `beat_005.png` — Beat marker captures
- `scene_preview.png`, `scene_preview2.png` — Scene previews
- `game_view.png` — Game view capture
- `unity_scene_setup.png` — Scene setup overview

### Blender Renders
- `output/blender_render.png` through `output/blender_render4.png` — Render iterations
- `output/architects_ghost_stage.png` — Stage preview
- `output/demo_stage.png` — Demo stage overview

### Audio Analysis Output
- `output/beat_data.json` — Beat data for "Take the Crown" by NeoCortext (152 BPM, 298 beats, 124s)
