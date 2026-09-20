# Music Generation Service

Subprocess service wrapping **ACE-Step 1.5** as an isolated GPU workload.

## Architecture

Each engine runs as a separate FastAPI process on its own port:

| Engine | Port | VRAM (this workstation) | License      | Quality | Status |
|--------|------|------------------------|--------------|---------|--------|
| ACE    | 8201 | ~6 GB                  | Apache-2.0   | Good    | ✅ Active |

The main backend coordinates GPU allocation through VRAM manager:
- `begin_music_generation()` — offloads Ollama, signals ComfyUI
- `end_music_generation()` — reloads Ollama, returns to idle

The service itself also includes hardening:
- **Startup validation:** fails loud and early if `acestep` imports are missing.
- **Shared HTTP session:** one `aiohttp.ClientSession` reused for all requests.
- **Graceful shutdown:** engine `terminate()` then `kill()` after 5s grace on stop.
- **Python discovery:** prefers `ACE-Step-1.5/.venv`, then `tools/music-gen/.venv`, then `MUSIC_GEN_PYTHON`, warns on `sys.executable` fallback.

## Setup

### ACE-Step 1.5

**Option A: Windows portable package (recommended)**
1. Download `ACE-Step-1.5.7z` from the ACE-Step releases.
2. Extract to a permanent location, e.g. `tools/music-gen/ACE-Step-1.5/`.
3. The package includes `python_embedded` with all dependencies pre-installed.
4. First launch triggers model download (~10 GB).

**Option B: Clone + uv sync**
```powershell
git clone https://github.com/ace-step/ACE-Step-1.5.git tools/music-gen/ACE-Step-1.5
cd tools/music-gen/ACE-Step-1.5
uv sync
```

ACE-Step auto-detects GPU tier at startup:
- **GTX 1070 Ti (8 GB / Pascal):** Tier 3 — 2B turbo DiT + 0.6B LM, INT8 quant, CPU offload, `pt` backend. Flash Attention falls back to SDPA on Pascal.

### Environment variables (Pascal / sm_61)

`server.py` sets these automatically, but they can be overridden externally:

```powershell
$env:TORCH_CUDA_ARCH_LIST = "6.1"           # JIT kernel target
$env:PYTORCH_CUDA_ALLOC_CONF = "max_split_size_mb:128"  # fragment guard
$env:TORCHINDUCTOR_USE_TRITON = "0"         # torch.compile Triton requires sm_70+
```

> [!warning] `torch.compile` is unavailable on Pascal. The Triton backend used by
> `torch.compile` requires compute capability ≥7.0. Do not enable `--compile` or
> set `compile_model=True` on this workstation — it raises `GPUTooOldForTriton`.

## Running

### Standalone

```powershell
# ACE-Step on port 8201 (default for this hardware)
python tools/music-gen/server.py --engine ace --port 8201
```

### Via startup script

```powershell
# Foreground
.\tools\music-gen\start-service.ps1 -Engine ace

# Background
.\tools\music-gen\start-service.ps1 -Engine ace -Background
```

### Via backend API

```powershell
# Start from backend
curl -X POST http://127.0.0.1:8000/api/music-gen/start -d '{"engine":"ace"}'

# Stop
curl -X POST http://127.0.0.1:8000/api/music-gen/stop?engine=ace
```

## API Endpoints

### Service management
- `GET  /health` — Health check
- `GET  /vram` — VRAM usage
- `POST /unload` — Free VRAM (for VRAM manager)
- `POST /reload` — Reload engine

### Generation
- `POST /generate` — Generate complete song

### Files
- `GET  /audio/{name}` — Download audio
- `GET  /score/{name}` — Download ABC score

## Environment Variables

- `MUSIC_GEN_PYTHON` — Path to Python interpreter for this service (fallback if neither `ACE-Step-1.5/.venv` nor `tools/music-gen/.venv` is present).
- `ACESTEP_MODEL_ID` — Model config to load (default: `acestep-v15-sft`).
- `CUDA_VISIBLE_DEVICES` — GPU selection (default: 0)

Python interpreter discovery order:
1. `tools/music-gen/ACE-Step-1.5/.venv/Scripts/python.exe` (recommended — contains the `acestep` package)
2. `tools/music-gen/.venv/Scripts/python.exe` (legacy/fallback)
3. `MUSIC_GEN_PYTHON`
4. Backend `sys.executable` (logged as a warning)

## VRAM Coordination

The service integrates with the backend's VRAM manager:

1. Backend calls `POST /api/music-gen/start`
2. VRAM manager calls `begin_music_generation()` → offloads Ollama
3. Music-gen subprocess loads model onto freed VRAM
4. When done, backend calls `POST /api/music-gen/stop`
5. VRAM manager calls `end_music_generation()` → reloads Ollama

This ensures ACE-Step and ComfyUI never compete for VRAM simultaneously.
