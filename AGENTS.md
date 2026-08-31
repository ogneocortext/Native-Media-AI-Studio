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
  ├── mcp/                  # MCP server bridges
  │   ├── unity-mcp-bridge.mjs   # Unity MCP server (Node.js, stdio)
  │   ├── vision-mcp.mjs         # Vision MCP (Ollama VLM)
  │   └── vision.mjs             # Standalone vision analyzer
  ├── demos/                # Demo scripts
  │   ├── demo_all_features.py   # Full feature demonstration
  │   └── demo_audio_analysis.py # Audio analysis demo
  ├── tests/                # Test scripts
  │   └── test_mcp*.py           # MCP connection tests
  ├── blender_mcp_addon.py   # Blender MCP addon (Python, v1.5)
  ├── analyze_and_sync.py    # Audio analysis → beat-synced JSON for Unity
  └── analyze_happyshrimp.py # GPU-accelerated audio analysis demo
.kilo/
├── agents/data.md        # Data analysis agent configuration
├── skills/unity-mcp/SKILL.md  # Unity MCP skill documentation
└── package.json          # Kilo Code plugin dependencies
unity-project-mcp/        # Unity project for music video generation
```

## MCP Server Configuration

All MCP servers are configured in `opencode.json`:

| Server       | Command                                               | Port          | Status        |
| ------------ | ----------------------------------------------------- | ------------- | ------------- |
| Ollama Tools | `node tools/mcp/ollama-tools-mcp.mjs`                | stdio         | ✅ Configured |
| Unity MCP    | `node tools/mcp/unity-mcp-bridge.mjs`                | 7800 (REST)   | ✅ Running    |
| Blender MCP  | `uvx blender-mcp`                                     | 9876 (socket) | ✅ Running    |
| ComfyUI MCP  | `npx comfyui-mcp --comfyui-url http://localhost:8188` | 8188          | ✅ Running    |
| Remotion MCP | `npx -y @remotion/mcp@latest`                         | stdio         | ✅ Configured |

### Ollama Integration

Local Ollama models are available for vision analysis and tool-assisted generation:

- **Vision Models**: `gemma4:e2b-it-qat`, `qwen3-vl:4b`, `qwen3.5:9b`
- **Tool Use**: Models support function calling for image generation, video creation, and music synthesis
- **Recommended**: Use `qwen3-vl:4b` for vision tasks (fast, good accuracy)
- **Vision Skill**: `/vision-feedback` skill for screenshot analysis with Ollama VLM

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

### Visualizer & Effects

The Visualizer (`packages/frontend/src/features/visualizer/`) includes:

- **Visual Presets**: Auto-applied based on track genre/energy/BPM. 8 optimized presets (Phonk Drift, Synthwave, Ambient Flow, West Coast G-Funk, UK Grime, Dubstep Impact, Lo-Fi Warmth, Cinematic)
- **Theatre.js Studio**: Visual animation editor panel (wand icon in toolbar) for customizing kinetic typography animations with real-time preview
- **Kinetic Typography**: 8 genre-specific lyric animation presets using anime.js
- **Shader/3D Modes**: Toggle between shader and 3D visualization modes
- **Recording**: Canvas recording to WebM with audio-reactive visualization

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
- Python 3.11+ (via conda environment at `D:\conda-envs\comfyui-cuda\` for CUDA support)
- Blender 5.2 (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`)
- Unity Editor 6000.5.1f1
- ComfyUI at `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI`
- NVIDIA GPU with CUDA 12.4 for GPU-accelerated audio analysis

## Python Environment

The project uses a CUDA-enabled conda environment for GPU features:

- **Primary Environment**: `D:\conda-envs\comfyui-cuda\` (PyTorch 2.5.1+cu124, CUDA 12.4)
- **Fallback**: Local venv at `venv/` (CPU-only, no CUDA)
- **Configuration**: See `.python-env` file for environment settings
- **Type Checking**: Pyright configured to use conda environment in `pyrightconfig.json`

AI agents should prefer the conda environment for CUDA-dependent operations (audio analysis, ML features).
