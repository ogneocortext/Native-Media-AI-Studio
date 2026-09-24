# AGENTS.md — Native Media AI Studio

> **Last Updated:** 2026-09-22
> **Status:** Active Development (Phase 1+2)
> **Platform:** Windows 11 local development machine

> **Agent bootstrap:** read `docs/architecture/decision-log.md` before writing code. It records stack/architecture decisions (D1–D8 — do not re-litigate) and open questions (Q1–Q4). Update the log when you make or reverse an architecture decision.

## Project Overview

Full-stack music-video creation suite: React/Vite/TypeScript frontend, FastAPI backend, Unity/Blender/ComfyUI/Remotion MCP integrations, and Go sidecars.

## Directory Structure

```
Native-Media-AI-Studio/
├── packages/frontend/     # React + Vite + TypeScript + Remotion
├── packages/backend/      # FastAPI (api, core, models, services, adapters, sse, queue, diagnostics)
├── tools/                 # MCP bridges (mcp/), Go sidecars (go-*), music-gen, vision, blender, ollama, demos
├── scripts/               # PowerShell startup/management
├── docs/                  # guides, setup, knowledge-library, scratch
├── config/                # ports.json, settings.json, tracks.json
├── output/                # Generative outputs (gitignored)
├── unity-project-mcp/     # Unity project for music video generation
├── unity-visualizer/      # Native Media Visualizer — standalone Unity audio visualization project
├── shared/                # Shared TypeScript types
├── logs/                  # Application logs
└── AGENTS.md / Guidelines.md
```

### Critical Directories

- **Do not delete/move** `unity-visualizer/` during cleanup.
- Scratch artifacts → `docs/scratch/` or `packages/frontend/tests/browser/out/`.
- Agent screenshots → `packages/frontend/tests/browser/out/` (gitignored).

## MCP Servers

| Server       | Command                                                      | Port       | Status        |
| ------------ | ------------------------------------------------------------- | ---------- | ------------- |
| Ollama Tools | `node tools/mcp/ollama-tools-mcp.mjs`                         | stdio      | Configured    |
| Vision       | `node tools/mcp/vision-mcp.mjs`                               | stdio      | Configured    |
| Unity MCP    | `node tools/mcp/unity-mcp-bridge.mjs`                         | 7800 (REST)| Running       |
| Blender MCP  | `uvx blender-mcp`                                             | 9876       | Running       |
| ComfyUI MCP  | `npx comfyui-mcp --comfyui-url http://127.0.0.1:8188`        | 8188       | Running       |
| Remotion MCP | `npx -y @remotion/mcp@latest`                                 | stdio      | Configured    |
| HyperFrames  | `node tools/mcp/hyperframes-mcp.mjs`                          | stdio      | Configured    |

## Vision Workflow

1. Capture screenshot via Playwright.
2. Analyze with `node tools/vision/analyze.mjs <screenshot> [--mode ui|responsive|regression|compare]` (uses local `gemma4:e2b-it-qat`).
3. Verify findings against DOM/API.
4. Fix and re-capture to confirm.

Never send generic prompts like "describe this image"; use mode-specific prompts for actionable output.

## Development Guidelines

### Shell / Process Management

- **Requires PowerShell 7.6+.** Verify `$PSVersionTable.PSVersion.Major -ge 7`.
- On PowerShell failures, **fall back to Python immediately**.
- Long-running sessions must use `background_process` tool.

### Services

- Start: `scripts\start-services.ps1` (backend + frontend, dynamic ports → `config/ports.json`).
- Status: `scripts\manage-servers.ps1 -Action status`
- Interactive: `scripts\start-studio.ps1`
- Ports: `scripts\check_ports.ps1`

### Critical Notes

- **Never commit/hand-edit** compiled `vite.config.js` / `vite.config.d.ts` in `packages/frontend/` — it shadows `vite.config.ts`.

## Music Video Pipeline

1. `tools/analyze_and_sync.py` for audio analysis + beat-synced JSON
2. Unity MCP for 3D scenes
3. AutoCapture.cs for frame renders (360 frames = 15s @ 24fps)
4. Blender MCP for high-quality renders
5. Remotion for final composite

## Python Environments

| Task | Interpreter |
|------|-------------|
| Backend / audio / ML / CUDA | `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` |
| ComfyUI service only | `D:\conda-envs\comfyui-cuda\Scripts\python.exe` |
| Fallback / CPU-only | `venv\Scripts\python.exe` |

Rules:
- Default to `nma-studio-cuda` for backend + GPU work.
- Never use `comfyui-cuda` for backend work.

Music-gen prefers `tools/music-gen/.venv/Scripts/python.exe`, then `MUSIC_GEN_PYTHON`, then backend `sys.executable` (with warning).

## Testing

- Frontend: `pnpm test` in `packages/frontend/`
- Backend: `pytest` in `packages/backend/`
- E2E: Playwright under `packages/frontend/tests/browser/`
- Lint/format: `pnpm lint` / `pnpm format` (frontend); `ruff check` / `ruff format` (backend)

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
