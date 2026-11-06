# System Requirements — Native Media AI Studio

> **Last Updated:** 2026-11-01 — Updated Node.js to v26.13 LTS

External tools and system-level dependencies that are **not** installable via `pip` / `pnpm`.

---

## Current recommended versions (as of 2026-10-28)

| Tool | Recommended Version | Notes |
|------|-------------------|-------|
| FFmpeg | 9.0.2 | Latest stable (released Sep 18, 2026) |
| Node.js | 26.13 LTS | Active LTS (Lithium), maintained until 2029-04-30 |
| Python | 3.15.2 / 3.14.10 / 3.11.18 | 3.15 is latest bugfix, 3.14 is stable, 3.11 is security-only |
| Ollama | 0.40.14 | Latest stable (released Nov 3, 2026) - OpenAI-compatible endpoints no longer override model sampler defaults; /api/chat web search decoding fix |
| ComfyUI | 0.43.0 | Latest stable (released Oct 27, 2026) |
| Blender | 5.2.3 LTS | Current LTS, supported until July 2028 |
| Unity | 6000.6.7f1 (Unity 6) | Unity 6.3 LTS, supported until December 2027 |
| PyTorch | 2.14 | **CRITICAL FOR PASCAL GPUs:** Stay on 2.14 or earlier. PyTorch 2.15 drops CUDA 12.6 binaries, ending prebuilt support for Pascal (GTX 1070 Ti). 2.15+ requires compile-from-source or Turing+ GPU. |

---

## Required system binaries

| Tool | Purpose | Install |
|------|---------|---------|
| **FFmpeg** (`ffmpeg`, `ffprobe`) | Cover art extraction, video rendering, format probing | `choco install ffmpeg` / `winget install ffmpeg` / https://ffmpeg.org/download.html |
| **Git** | ComfyUI self-update (`git pull`) in `comfyui_manager.py` | https://git-scm.com/downloads |
| **PowerShell 7+** | Service scripts (`scripts/*.ps1`) | Windows 11 ships with pwsh; otherwise `winget install Microsoft.PowerShell` |
| **Python** (`python.exe`) | Backend venv (`D:\conda-envs\nma-studio-cuda\Scripts\python.exe`), ComfyUI runtime venv, standalone tooling venv (`D:\conda-envs\studio-tools\Scripts\python.exe`) | Python 3.11+ (backend/CUDA), Python 3.14+ (standalone tools) |
| **Node.js 26+ (LTS)** | Frontend dev server, Vite build, MCP tool scripts | https://nodejs.org/ or `fnm use 26` |

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
| `faster-whisper` | pip-installable, CUDA optional | **Installed** in `nma-studio-cuda` (1.2.1). On Windows, CTranslate2 also needs the `nvidia-cublas-cu12` / `nvidia-cudnn-cu12` pip packages; `transcription.py` registers their DLL dirs automatically. GPU compute type is capability-aware: sm_70+ → float16, Pascal (sm_61) → float32, no CUDA → CPU int8. Default model `large-v3-turbo` (override: `WHISPER_MODEL_SIZE`). |
| `torch` | Pinned in `requirements-torch.txt` (cu126) | **Not** in the default `requirements.txt`. GPU/VRAM paths silently degrade without it. **CRITICAL FOR PASCAL GPUs (GTX 1070 Ti):** Stay on PyTorch 2.14 or earlier. PyTorch 2.15 drops CUDA 12.6 binaries, ending prebuilt support for Pascal (sm_60). From 2.15+, Pascal requires compile-from-source against CUDA 12.x. |
| `torchvision` / `torchaudio` | Pinned in `requirements-torch.txt` | **Not directly imported** in backend code. Present for torch ecosystem compatibility; can be removed if install size is a concern. |
| `demucs` | pip-installable, CUDA optional | **Installed** in `nma-studio-cuda` (4.1.0). Use `pip install --no-deps demucs` + explicit deps (`julius dora-search diffq lameenc openunmix submitit sphn`) so pip never replaces the Pascal-safe torch build. The backend invokes it via `sys.executable -m demucs`, never the PATH `demucs.exe`. Falls back to CPU if CUDA is absent. |
| `madmom-infer` | pip-installable (pure numpy/scipy DSP + on-demand model download) | **Installed** in `nma-studio-cuda` (0.2.0). Neural beat/downbeat tracking (`POST /api/audio/analyze?backend=madmom`). Import as `madmom_infer.features.downbeats` (there is NO `madmom.infer`/`beats()`/`downbeats()` API); resample input to 44100 Hz first. First use downloads CC BY-NC-SA 4.0 (**non-commercial**) BLSTM weights (~3 MB) into `~/.cache/madmom_infer/models/`. |
| `sonara` | pip-installable (Rust PyO3 wheel, needs only numpy) | **Installed** in `nma-studio-cuda` (0.3.6). Fast beat/grid + loudness/timbre stats (`POST /api/audio/analyze?backend=sonara`, also the API default). NOTE: its bundled decoder mangles some containers — the backend decodes with librosa first and calls `analyze_signal()` on float32 mono 22050 Hz. Frame indices assume sr=22050/hop=512 (see `provenance` in output); convert with `sonara.frames_to_time()`. |
| `spleeter` | pip-installable (optional fallback) | Only invoked when `demucs` is missing. Not declared; install manually if needed. |

---

## External services

| Service | Default URL | Notes |
|---------|-------------|-------|
| **Ollama** | `http://127.0.0.1:11434` | Vision / text / embedding models — current catalog: `gemma4:e2b-it-qat` (vision), `qwen3.5:4b`, `llama3.2:3b`, `ibm/granite4.2:3b` (text), `nomic-embed-text:v1.5` + `embeddinggemma-2:270m` (embeddings). The `qwen3-vl:*`, `minicpm-v:*`, and `qwen3.5:9b` models were pruned 2026-10-22 (decision-log D37/D46/D47) |
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

# Services (canonical ports from config/ports.json)
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:5173
curl http://127.0.0.1:8188/system_stats
```

See also `docs/setup/SETUP_SUMMARY.md` for current ports and service health checks.
