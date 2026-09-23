# AGENTS.md — Native Media AI Studio

> **Last Updated:** 2026-09-21
> **Status:** Active Development (Phase 1+2)
> **Platform:** Windows 11 local development machine

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
Native-Media-AI-Studio/
├── packages/
│   ├── frontend/              # React + Vite + TypeScript + Remotion frontend
│   │   ├── src/
│   │   │   ├── features/      # Feature-organized UI (see src/features/README.md for index)
│   │   │   ├── components/    # Shared React components
│   │   │   ├── pages/         # Route-level pages
│   │   │   ├── services/      # API clients and data fetching
│   │   │   ├── hooks/         # Shared React hooks
│   │   │   ├── state/         # Zustand stores
│   │   │   ├── styles/        # Global styles
│   │   │   └── utils/         # Frontend utilities
│   │   ├── tests/
│   │   │   └── browser/
│   │   │       └── out/       # Playwright browser test screenshots (agent vision output goes here)
│   │   ├── package.json
│   │   └── vite.config.ts
│   ├── backend/               # FastAPI backend
│   │   ├── app/
│   │   │   ├── api/           # REST routes
│   │   │   ├── core/          # Port manager, health monitor, SQLite, CORS, tracing, RequestID middleware
│   │   │   ├── models/        # Pydantic schemas (single source of truth)
│   │   │   ├── services/      # Business logic
│   │   │   ├── adapters/      # ComfyUI, Ollama, Blender, Unity, music-gen wrappers
│   │   │   ├── sse/           # Canonical SSE event handler
│   │   │   ├── websocket/     # Legacy 426 shim — prefer SSE
│   │   │   ├── queue/         # Job queue (with DLQ + metrics)
│   │   │   ├── diagnostics/   # Resource / health diagnostics
│   │   │   └── main.py        # App factory and startup wiring
│   │   └── tests/
│   └── video-editor/          # Remotion video editor package
├── tools/
│   ├── mcp/                   # MCP server bridges (Node.js / stdio)
│   │   ├── unity-mcp-bridge.mjs
│   │   ├── vision-mcp.mjs
│   │   ├── ollama-tools-mcp.mjs
│   │   ├── hyperframes-mcp.mjs
│   │   └── context-store.mjs
│   ├── go-dashboard/          # SSE + health server on :3847
│   ├── go-media/              # FFmpeg wrapper + HTTP server on :3848
│   ├── go-worker/             # Queue I/O worker on :3849
│   ├── go-gateway/            # MCP bridge router on :3850
│   ├── go-ports/              # Port availability checker on :3851
│   ├── music-gen/             # ACE-Step 1.5 music generation (FastAPI subprocess, port 8201)
│   │   └── server.py          # Shared aiohttp session, startup engine validation, graceful shutdown
│   ├── vision/                # Standalone vision utilities
│   │   └── analyze.mjs
│   ├── blender/               # Blender MCP client helpers
│   ├── ollama/                # Ollama helper scripts
│   ├── demos/                 # Demo scripts
│   ├── tests/                 # Tool-side tests
│   ├── lib/                   # Shared tool libraries
│   ├── utils/                 # Shared utilities
│   ├── scripts/               # Tool-specific scripts
│   ├── analyze_and_sync.py    # Audio analysis -> beat-synced JSON for Unity
│   └── blender_mcp_addon.py   # Blender MCP addon (Python, v1.5)
├── scripts/                   # PowerShell startup/management scripts
├── docs/                      # Documentation and guides
│   ├── guides/                # Production guides (GPU, visualizer, music video)
│   ├── setup/                 # Environment setup docs
│   ├── knowledge-library/     # Research and reference articles
│   ├── scratch/               # Ad-hoc scratch outputs (not authoritative)
│   └── README.md              # Documentation index
├── config/                    # Runtime config (ports.json, settings.json, tracks.json)
├── output/                    # Generative outputs (gitignored)
├── shared/                    # Shared TypeScript types
├── unity-project-mcp/         # Unity project for music video generation
├── unity-visualizer/          # Native Media Visualizer — standalone Unity audio visualization project
├── .kilo/                     # Kilo Code plugin config, skills, worktrees, knowledge
├── .agents/                   # Agent skill configs
├── logs/                      # Application logs
├── AGENTS.md                  # This file
└── Guidelines.md              # Project specification and implementation guide
```

### Protected Directories

> [!warning] CRITIAL: Do not delete or move `unity-visualizer/` during directory audits or cleanup. This is a dedicated standalone Unity project for track audio visualization and must not be conflated with `unity-project-mcp/`.

### Scratch / Generated Artifacts

> [!note] One-off diagnostics, ad-hoc screenshots, and generated logs should live under `docs/scratch/` or `packages/frontend/tests/browser/out/` rather than the repo root. Python helpers belong in `tools/scripts/` (reusable utilities) or `tools/tests/` (live smoke/verification scripts) — never in `docs/`. Root-level scratch files are noise for agent navigation.

### Screenshot Conventions

> [!note] Agent-generated screenshots belong in `packages/frontend/tests/browser/out/` (already gitignored). This matches the Playwright harness layout and keeps browser artifacts out of the repo root.

## MCP Server Configuration

> [!note] The table below shows the current configuration. Actual running status may change between sessions.

| Server       | Command                                                          | Port          | Current Status        |
| ------------ | ---------------------------------------------------------------- | ------------- | --------------------- |
| Ollama Tools | `node tools/mcp/ollama-tools-mcp.mjs`                            | stdio         | Configured            |
| Vision       | `node tools/mcp/vision-mcp.mjs`                                  | stdio         | Configured            |
| Unity MCP    | `node tools/mcp/unity-mcp-bridge.mjs`                            | 7800 (REST)   | Running               |
| Blender MCP  | `uvx blender-mcp`                                                | 9876 (socket) | Running               |
| ComfyUI MCP  | `npx comfyui-mcp --comfyui-url http://127.0.0.1:8188 --force-remote` | 8188  | Running               |
| Remotion MCP | `npx -y @remotion/mcp@latest`                                    | stdio         | Configured            |
| HyperFrames  | `node tools/mcp/hyperframes-mcp.mjs`                             | stdio         | Configured            |

All MCP servers are configured in `opencode.json`.

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

1. **Capture screenshot** with Playwright from the project root directory:

    ```js
    await page.screenshot({ path: "packages/frontend/tests/browser/out/shot.png", fullPage: true });
    ```

2. **Analyze with vision script** (resizes + sends to Ollama gemma4):

    ```bash
    # Basic analysis with optional prompt
    node tools/vision/analyze.mjs shot.png "optional prompt"

    # Code-grounded regression analysis (compares screenshot to source file)
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

- **Vision Models**: `gemma4:e2b-it-qat` (recommended), `qwen3-vl:2b` (fast fallback)
- **Tool Use**: Models support function calling for image generation, video creation, and music synthesis
- **Vision Skill**: `/vision-feedback` skill for screenshot analysis with Ollama VLM

## Development Guidelines

### Shell / Process Management

> [!warning] CRITICAL: This project requires **PowerShell 7.6+**. Older PowerShell versions fail on quoting, variable parsing, `&&` statement separators, and path-with-spaces handling. Always verify `$PSVersionTable.PSVersion.Major -ge 7` before running shell commands. When any PowerShell command misbehaves, **fall back to Python immediately** — do not retry with more PowerShell variations. Prefer inline Python one-liners or small `.py` scripts over complex PowerShell chains for process management, HTTP probing, file ops, and service control.

> [!warning] CRITICAL: Long-running terminal sessions **must** run in the background. This includes servers, watchers, render jobs, batch scripts, and any process expected to stay alive across turns. If a command is long-running, use the `background_process` tool with `action: "start"` and never require the user to reissue it.

- **Start background services:** `scripts\start-services.ps1`
  - Backend (default `http://127.0.0.1:8000`) + Frontend (default `http://127.0.0.1:5173`) are started hidden and detached.
  - Ports are resolved dynamically at startup: if the default is occupied, the service increments to the next available port. The final layout is written to `config/ports.json`.
  - Add `-ComfyUI` to also start ComfyUI (`http://127.0.0.1:8188`).
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
2. Generate 3D scenes in Unity via MCP (`unity_command` -> Unity Pipeline API)
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

### Testing & Quality

- **Frontend tests:** `pnpm test` in `packages/frontend/`
- **Backend tests:** `pytest` in `packages/backend/`
- **E2E browser tests:** Playwright harness under `packages/frontend/tests/browser/`
- **Lint:** `pnpm lint` (frontend) / `ruff check` (backend)
- **Format:** `pnpm format` (frontend) / `ruff format` (backend)

### Observability

- **Request ID / latency:** `RequestIDMiddleware` injects `X-Request-ID` and `X-Response-Time` on every response.
- **Tracing:** Set `NMA_TRACING=1` to enable OpenTelemetry console exporter (opt-in, no external collector required).
- **Queue DLQ:** Exhausted retries move jobs to `JobStatus.DEAD`. Use `GET /api/jobs/dead-letter` and `POST /api/jobs/clear-dead` to inspect/purge.
- **Queue metrics:** `GET /api/jobs/metrics` returns depth, processing rate, wait/duration averages, and DLQ sample.

## Common Tasks

- Start background services: `scripts\start-services.ps1`
- Start interactive mode: `scripts\start-studio.ps1`
- Check server status: `scripts\manage-servers.ps1 -Action status`
- Unity health: `curl -X POST http://127.0.0.1:7800/api/exec -H "Authorization: Bearer <token>" -d '{"command":"editor_status","parameters":{}}'`
  - Replace `<token>` with the actual Unity MCP bearer token from your environment.
- Backend health: `http://127.0.0.1:8000/api/health` (check `config/ports.json` for current port)
- Backend queue health: `http://127.0.0.1:8000/api/health/queue`
- Backend queue metrics: `http://127.0.0.1:8000/api/jobs/metrics`
- Backend dead-letter queue: `GET /api/jobs/dead-letter`, `POST /api/jobs/clear-dead`
- ComfyUI: `http://127.0.0.1:8188`
- Go dashboard: `http://127.0.0.1:3847` (SSE + health, started automatically)
- Music generation: `POST /api/music-gen/start`, `POST /api/music-gen/stop`, `GET /api/music-gen/status`, `GET /api/music-gen/audio/{engine}/{name}`, `GET /api/music-gen/score/{name}`
- Opt-in tracing: set `NMA_TRACING=1` when starting the backend to log OpenTelemetry spans to the console.

## Dependencies

> [!note] The paths below are examples from the primary development machine. Other developers should install dependencies in equivalent locations and update the paths in `.python-env`.

- Node.js 22+ (via fnm)
- Python 3.11+ (standalone venv at `D:\conda-envs\nma-studio-cuda\` for CUDA support)
- Blender 5.2 (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`)
- Unity Editor 6000.5.1f1
- ComfyUI at `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI`
- NVIDIA GPU with CUDA (torch bundles its own CUDA runtime — no system toolkit needed for inference)
- **System CUDA Toolkit 12.4** (optional, for `nvcc`/Nsight profiling): `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4`

## Python Environments

The project has **three** Python environments. Do not assume `python` on PATH is the correct one.

### Preferred interpreter selection

| Task | Use this interpreter |
|------|----------------------|
| Backend, audio analysis, ML, any CUDA feature | `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` |
| System CUDA Toolkit (nvcc / Nsight) | `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4` |
| ComfyUI service only | `D:\conda-envs\comfyui-cuda\Scripts\python.exe` |
| Fallback / CPU-only scripts | `venv\Scripts\python.exe` |

Rules:
- **Default to the studio env** (`nma-studio-cuda`) for backend + GPU work.
- **Never** use `comfyui-cuda` for backend work; it is ComfyUI-only.

### Music-Gen Python environment

The music-gen service prefers its own isolated interpreter so engine dependencies do not conflict with the backend:

1. `tools/music-gen/.venv/Scripts/python.exe` (recommended)
2. `MUSIC_GEN_PYTHON` environment variable
3. Fallback to the backend `sys.executable` with a warning (not recommended)

### Paths and metadata

> [!note] Update these paths if your development environment differs from the primary machine.

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

> [!warning] Rules:
> - `nma-studio-cuda` is the primary env — use it for all backend and GPU work.
> - `comfyui-cuda` is ComfyUI-only — never use it for the backend.
> - Scripts resolve: studio env -> ComfyUI env -> `venv/` fallback.

## Quick Reference

| What | Where |
|------|-------|
| Frontend source | `packages/frontend/src/` |
| Backend source | `packages/backend/app/` |
| Go sidecars | `tools/go-*` |
| MCP bridges | `tools/mcp/` |
| Unity project | `unity-project-mcp/` |
| Visualizer | `unity-visualizer/` |
| Port config | `config/ports.json` |
| Logs | `logs/` |
| Outputs | `output/` |