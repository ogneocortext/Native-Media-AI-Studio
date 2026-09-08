# System Requirements — Native Media AI Studio

> **Last Updated:** 2026-09-08 — added `studio-tools` (Python 3.14) for standalone tooling

External tools and system-level dependencies that are **not** installable via `pip` / `pnpm`.

---

## Required system binaries

| Tool | Purpose | Install |
|------|---------|---------|
| **FFmpeg** (`ffmpeg`, `ffprobe`) | Cover art extraction, video rendering, format probing | `choco install ffmpeg` / `winget install ffmpeg` / https://ffmpeg.org/download.html |
| **Git** | ComfyUI self-update (`git pull`) in `comfyui_manager.py` | https://git-scm.com/downloads |
| **PowerShell 7+** | Service scripts (`scripts/*.ps1`) | Windows 11 ships with pwsh; otherwise `winget install Microsoft.PowerShell` |
| **Python** (`python.exe`) | Backend venv (`D:\conda-envs\nma-studio-cuda\Scripts\python.exe`), ComfyUI runtime venv, standalone tooling venv (`D:\conda-envs\studio-tools\Scripts\python.exe`) | Python 3.11+ (backend/CUDA), Python 3.14+ (standalone tools) |
| **Node.js 22+** | Frontend dev server, Vite build, MCP tool scripts | https://nodejs.org/ or `fnm use 22` |

---

## Optional system binaries

| Tool | Purpose | Install |
|------|---------|---------|
| **Blender 5.2+** | 3D scene generation, thumbnail rendering, GLB conversion | https://www.blender.org/download/ |
| **fpcalc** (Chromaprint) | Audio fingerprinting / AcoustID lookup | `choco install chromaprint` |
| **demucs** | Audio source separation (stems: vocals/drums/bass/other) | `pip install demucs` |
| **spleeter** | Audio source separation (lighter-weight alternative to demucs) | `pip install spleeter` |

---

## Python packages with system constraints

| Package | Constraint | Notes |
|---------|-----------|-------|
| `bpy` / `mathutils` | Ships **only** inside Blender | Backend `gen3d/*.py` and `tools/blender_mcp_addon.py` must run via `blender --python <script>`, not the studio venv |
| `faster-whisper` | pip-installable, CUDA optional | Declared in `requirements-experimental.txt`. Whisper transcription falls back to CPU if `torch.cuda.is_available()` is false |
| `torch` | Pinned in `requirements-torch.txt` (cu126) | **Not** in the default `requirements.txt`. GPU/VRAM paths silently degrade without it |
| `torchvision` / `torchaudio` | Pinned in `requirements-torch.txt` | **Not directly imported** in backend code. Present for torch ecosystem compatibility; can be removed if install size is a concern. |
| `demucs` | pip-installable, CUDA optional | Declared in `requirements-experimental.txt`. Source separation falls back to CPU if CUDA is absent. |
| `spleeter` | pip-installable (optional fallback) | Only invoked when `demucs` is missing. Not declared; install manually if needed. |

---

## External services

| Service | Default URL | Notes |
|---------|-------------|-------|
| **Ollama** | `http://127.0.0.1:11434` | Vision / text models (`gemma4:e2b-it-qat`, `qwen3-vl:4b`) |
| **ComfyUI** | `http://127.0.0.1:8188` | Must start with `--enable-manager` for Manager queue API |
| **Unity Editor** | `http://127.0.0.1:7800` | Unity 6000.x, MCP bridge via `tools/mcp/unity-mcp-bridge.mjs` |
| **Blender MCP** | `localhost:9876` (TCP) | Blender addon sidebar → "Start MCP Server" |

---

## Quick verification

```powershell
# Core binaries
where.exe ffmpeg ffprobe git pwsh

# Python envs
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -c "import torch; print('torch', torch.__version__)"
D:\conda-envs\comfyui-cuda\Scripts\python.exe -c "import torch; print('comfyui torch', torch.__version__)"
D:\conda-envs\studio-tools\Scripts\python.exe -c "import sys; print('studio-tools', sys.version)"

# Services
curl http://127.0.0.1:8001/api/health
curl http://127.0.0.1:5174
curl http://127.0.0.1:8188/system_stats
```

See also `docs/setup/SETUP_SUMMARY.md` for current ports and service health checks.
