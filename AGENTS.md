# AGENTS.md — Native Media AI Studio

## Project Overview

Native Media AI Studio is a full-stack music-video creation suite combining:

- **Frontend**: React + Vite + TypeScript (Remotion for video compositing)
- **Backend**: FastAPI (Python) — ComfyUI management, 3D generation, GPU audio analysis
- **Unity MCP**: Unity 6000.x editor integration for 3D scene generation and beat-synced animation
- **Blender MCP**: Blender 5.2 integration for 3D rendering and scene building
- **ComfyUI MCP**: ComfyUI integration for AI image/video generation via custom workflows
- **Remotion MCP**: Documentation and best-practices integration for video compositing
- **Go Sidecars**: Infrastructure binaries (dashboard SSE, media workers, gateway, port checker)

## Directory Structure

```
packages/
├── frontend/           # React + Vite + Remotion frontend
├── backend/            # FastAPI backend (app.main, app.services.*, app.models.*, app.core.*)
└── video-editor/       # Video editor package
tools/                  # MCP bridges, demo scripts, and Go infrastructure sidecars
  ├── mcp/                  # MCP server bridges
  │   ├── unity-mcp-bridge.mjs   # Unity MCP server (Node.js, stdio)
  │   ├── vision-mcp.mjs         # Vision MCP (Ollama VLM) — primary
  │   └── ollama-tools-mcp.mjs   # Ollama tools MCP
  ├── go/                   # Go sidecar utilities
  │   ├── go-dashboard/     # SSE + health server on :3847
  │   ├── go-media/         # FFmpeg wrapper + HTTP server on :3848
  │   ├── go-worker/        # Queue I/O worker on :3849
  │   ├── go-gateway/       # MCP bridge router on :3850
  │   ├── go-ports/         # Port availability checker on :3851
  │   └── README.md         # Go tools documentation
  ├── vision/               # Standalone vision utilities
  │   └── analyze.mjs       # Direct CLI: node tools/vision/analyze.mjs <image> [prompt] [--mode ui|responsive|regression|compare|ocr|table|chart]
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

All MCP servers are configured in `opencode.json` (6 servers — Vision is additional local MCP):

| Server       | Command                                                          | Port          | Status        |
| ------------ | ---------------------------------------------------------------- | ------------- | ------------- |
| Ollama Tools | `node tools/mcp/ollama-tools-mcp.mjs`                            | stdio         | ✅ Configured |
| Vision       | `node tools/mcp/vision-mcp.mjs`                                  | stdio         | ✅ Configured |
| Unity MCP    | `node tools/mcp/unity-mcp-bridge.mjs`                            | 7800 (REST)   | ✅ Running    |
| Blender MCP  | `uvx blender-mcp`                                                | 9876 (socket) | ✅ Running    |
| ComfyUI MCP  | `npx comfyui-mcp --comfyui-url http://localhost:8188 --force-remote` | 8188      | ✅ Running    |
| Remotion MCP | `npx -y @remotion/mcp@latest`                                    | stdio         | ✅ Configured |

### Vision Analysis Workflow

> [!warning] CRITICAL: Always use the local vision model for visual analysis.
> This model cannot see image attachments directly. Every screenshot must be routed
> through the local Ollama vision model using the project's vision script.

> [!warning] CRITICAL: Never send generic placeholder prompts to Ollama.
> Prompts like "describe this image" or "what is in this screenshot" produce
> non-actionable, generic output that wastes local GPU time and does not help
> improve Native Media AI Studio. Always use the project's mode-specific prompts
> or write a task-specific prompt that asks for concrete, prioritized fixes the
> coding agent can implement immediately.

**Proper vision analysis workflow:**

1. **Capture screenshot** with Playwright:

   ```js
   await page.screenshot({ path: "packages/frontend/tests/browser/out/shot.png", fullPage: true });
   ```

2. **Analyze with vision script** (resizes + sends to Ollama gemma4):

    ```bash
    node tools/vision/analyze.mjs shot.png "optional prompt"
    # or for code-grounded analysis:
    node tools/vision/analyze.mjs shot.png src/components/Foo.tsx --mode regression
    ```

    For MCP-driven analysis (agents), the `vision-mcp.mjs` server exposes `vision_describe`, `vision_compare`, `vision_ocr`, and `vision_batch_analyze` tools.

3. **Verify findings** against ground truth (check actual DOM, API responses)

4. **Act on verified findings** (fix layout, improve visuals, etc.)

5. **Re-capture + re-analyze** to confirm improvements

**Vision script options:**

- `--low` — resize to 640px max (faster, smaller payload)
- `--high` — resize to 1280px max (higher detail)
- `--mode ui|responsive|regression|compare` — analysis mode
- `--viewport WxH` — intended viewport size
- `--lines` — line-number attached source code
- `--json` — machine-readable output

**Default model:** `gemma4:e2b-it-qat` (override with `VISION_MODEL=...`)

**VRAM management:** The vision script automatically unloads any other currently running Ollama models before loading the vision model, preventing OOM errors on GPUs with limited VRAM. The backend VRAM manager has been refactored to use proper async patterns with `asyncio.to_thread()` for GPU operations.

### Ollama Integration

Local Ollama models are available for vision analysis and tool-assisted generation:

- **Vision Models**: `gemma4:e2b-it-qat`, `qwen3-vl:4b`, `qwen3.5:9b`
- **Tool Use**: Models support function calling for image generation, video creation, and music synthesis
- **Recommended**: Use `qwen3-vl:4b` for vision tasks (fast, good accuracy)
- **Vision Skill**: `/vision-feedback` skill for screenshot analysis with Ollama VLM

## Development Guidelines

### Shell / Process Management

> [!warning] CRITICAL: PowerShell frequently fails on quoting, variable parsing, and path-with-spaces handling in this project. When any PowerShell command misbehaves, **fall back to Python immediately** — do not retry with more PowerShell variations. Prefer inline Python one-liners or small `.py` scripts over complex PowerShell chains for process management, HTTP probing, file ops, and service control.

- **Start background services:** `scripts\start-services.ps1`
  - Backend (`http://localhost:8000`) + Frontend (`http://localhost:5173`) are started hidden and detached.
  - Add `-ComfyUI` to also start ComfyUI (`http://localhost:8188`).
  - Safe to run repeatedly: if a port is already in use, that service is skipped.
- **Check status / restart individually:** `scripts\manage-servers.ps1 -Action status`
- **Full interactive mode** (foreground, with live monitor and auto-restart): `scripts\start-studio.ps1`
- Ports are managed dynamically by `packages/backend/app/core/port_manager.py`
- **Port inspection:** `scripts\check_ports.ps1` — maps every LISTENING port to its owning process (fast triage for stale/zombie servers)
- **Stale port recovery:** if a service can't start because a non-responding process holds its port, run `scripts\manage-servers.ps1 -Action stop -Services <backend|frontend|comfyui|video>`, then start again. `Stop-Service` kills the full uvicorn `--reload` tree (reloader parent + bound child, several passes) and tolerates Windows stale-socket entries that outlive a killed PID.
- **Status truthfulness:** `-Action status` probes `/api/health` with a 6 s timeout because the backend checks adapters live (a down ComfyUI alone can take >2 s to report).

> [!warning] CRITICAL: Never commit or hand-edit a compiled `vite.config.js` / `vite.config.d.ts` in `packages/frontend/` — Vite resolves `.js` before `.ts`, so an emitted artifact **silently shadows** `vite.config.ts` (this once reverted the IPv4 `server.host` binding, leaving Vite unreachable on 127.0.0.1). `tsconfig.node.json` redirects its composite emit to `node_modules/.tmp/`; if a `vite.config.js` ever reappears at the package root, delete it and investigate the emit config.

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

- Start background services: `scripts\start-services.ps1`
- Start interactive mode: `scripts\start-studio.ps1`
- Check server status: `scripts\manage-servers.ps1 -Action status`
- Unity health: `curl -X POST http://127.0.0.1:7800/api/exec -H "Authorization: Bearer <token>" -d '{"command":"editor_status","parameters":{}}'`
- Backend health: `http://127.0.0.1:8000/api/health` (check `config/ports.json` for current port)
- ComfyUI: `http://127.0.0.1:8188`
- Go dashboard: `http://127.0.0.1:3847` (SSE + health, started automatically)

## Dependencies

- Node.js 22+ (via fnm)
- Python 3.11+ (standalone venv at `D:\conda-envs\nma-studio-cuda\` for CUDA support)
- Blender 5.2 (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`)
- Unity Editor 6000.5.1f1
- ComfyUI at `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI`
- NVIDIA GPU with CUDA (torch bundles its own CUDA runtime — no system toolkit needed)

## Python Environments

The project has **three** Python environments. Do not assume `python` on PATH is the correct one.

### Preferred interpreter selection

| Task | Use this interpreter |
|------|----------------------|
| Backend, audio analysis, ML, any CUDA feature | `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` |
| ComfyUI service only | `D:\conda-envs\comfyui-cuda\Scripts\python.exe` |
| Fallback / CPU-only scripts | `venv\Scripts\python.exe` |

Rules:
- **Default to the studio env** (`nma-studio-cuda`) for backend + GPU work.
- **Never** use `comfyui-cuda` for backend work; it is ComfyUI-only.
- **Never** modify or delete `D:\conda-envs\space-analyzer-cuda`; it belongs to another project.

### Paths and metadata

- **Primary Environment (backend + GPU)**: `D:\conda-envs\nma-studio-cuda\`
  - Python 3.11.9, PyTorch `2.14.0+cu126`
  - Pascal/sm_61-safe build
  - Base interpreter: `C:\Users\Aomega Imaging\AppData\Local\Programs\Python\Python311`
- **ComfyUI Runtime (separate env)**: `D:\conda-envs\comfyui-cuda\`
  - Used **only** by the ComfyUI service
  - PyTorch `2.14.0+cu126`
- **Fallback**: `venv/` (CPU-only)

### Source of truth

- `.python-env` — environment variables pointing to the exact python executables
- `pyrightconfig.json` — points type checking to the studio env
- `scripts\check-env-health.ps1` — validates decoupling and CUDA health (add `-Torch` for CUDA matmul test)

> [!warning] Decoupling & ownership
> - `nma-studio-cuda` is fully decoupled from `D:\conda-envs\space-analyzer-cuda` (that env belongs to a **different project** — never delete or modify it for this project's sake).
> - `comfyui-cuda` was historically a venv bootstrapped *from* `space-analyzer-cuda`; it remains ComfyUI's runtime only. Do not use it for the backend.
> - Scripts resolve: studio env → ComfyUI env → `venv/` fallback.

AI agents should prefer the studio environment (`nma-studio-cuda`) for CUDA-dependent operations (audio analysis, ML features).
