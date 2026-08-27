# AGENTS.md — Native Media AI Studio

## Project Overview

Native Media AI Studio is a full-stack music-video creation suite combining:
- **Frontend**: React + Vite + TypeScript (Remotion for video compositing)
- **Backend**: FastAPI (Python) — ComfyUI management, 3D generation, GPU audio analysis
- **Unity MCP**: Unity 6000.x editor integration for 3D scene generation and beat-synced animation
- **Blender MCP**: Blender 5.2 integration for 3D rendering and scene building
- **ComfyUI MCP**: ComfyUI integration for AI image/video generation via custom workflows
- **Remotion MCP**: Documentation and best-practices integration for video compositing

## Directory Structure

```
packages/
├── frontend/           # React + Vite + Remotion frontend
├── backend/            # FastAPI backend (app.main, app.services.*, app.models.*, app.core.*)
└── video-editor/       # Video editor package
tools/                  # MCP bridges and demo scripts
├── unity-mcp-bridge.mjs   # Unity MCP server (Node.js, stdio)
├── blender_mcp_addon.py   # Blender MCP addon (Python, v1.5)
├── analyze_and_sync.py    # Audio analysis → beat-synced JSON for Unity
├── analyze_happyshrimp.py # GPU-accelerated audio analysis demo
├── demo_all_features.py   # Full feature demonstration
├── demo_audio_analysis.py # Audio analysis demo
└── test_mcp*.py           # MCP connection tests
.kilo/
├── agents/data.md        # Data analysis agent configuration
├── skills/unity-mcp/SKILL.md  # Unity MCP skill documentation
└── package.json          # Kilo Code plugin dependencies
unity-project-mcp/        # Unity project for music video generation
```

## MCP Server Configuration

All MCP servers are configured in `opencode.json`:

| Server | Command | Port | Status |
|--------|---------|------|--------|
| Unity MCP | `node tools/unity-mcp-bridge.mjs` | 7800 (REST) | ✅ Running |
| Blender MCP | `uvx blender-mcp` | 9876 (socket) | ✅ Running |
| ComfyUI MCP | `npx comfyui-mcp --comfyui-url http://localhost:8188` | 8188 | ✅ Running |
| Remotion MCP | `npx -y @remotion/mcp@latest` | stdio | ✅ Configured |

## Development Guidelines

### Server Management
- Use `scripts/start-studio.ps1` to start all services (backend, ComfyUI, frontend)
- Use `scripts/manage-servers.ps1` for individual server control (start/stop/status/restart)
- Ports are managed dynamically by `packages/backend/app/core/port_manager.py`

### Music Video Pipeline
1. Analyze audio with `tools/analyze_and_sync.py` (GPU-accelerated via CUDA)
2. Generate 3D scenes in Unity via MCP (`unity_command` → Unity Pipeline API)
3. Render frames via AutoCapture.cs (360 frames = 15s @ 24fps)
4. High-quality 3D renders via Blender MCP
5. Composite final video with Remotion

For quick live-reactive 3D previews, the **Three.js Studio** at `/three-js-studio` ships 6 production-ready scene templates (Concert Stage, Cosmic Void, Equalizer Wall, Geometric City, Vinyl Spin, Pulse Orb) and a real-beat timeline that pulses the 3D scene to the song. See `docs/guides/MUSIC_VIDEO_GUIDE.md` for the Studio section.

### Code Style
- Python: PEP 8, type hints, docstrings
- TypeScript: Strict mode, explicit types
- Unity C#: Unity coding conventions

## Common Tasks

- Start all services: `scripts/start-studio.ps1`
- Check server status: `scripts/manage-servers.ps1 -Action status`
- Unity health: `curl -X POST http://127.0.0.1:7800/api/exec -H "Authorization: Bearer <token>" -d '{"command":"editor_status","parameters":{}}'`
- Backend health: `http://127.0.0.1:8000/api/health`
- ComfyUI: `http://127.0.0.1:8188`

## Dependencies

- Node.js 22+ (via fnm)
- Python 3.11+ (via venv at `venv/`)
- Blender 5.2 (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`)
- Unity Editor 6000.5.1f1
- ComfyUI at `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI`
- NVIDIA GPU with CUDA 12.x for GPU-accelerated audio analysis
