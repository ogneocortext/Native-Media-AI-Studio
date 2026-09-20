# Music Generation Service

Subprocess service wrapping YuE2 and ACE-Step as isolated GPU workloads.

## Architecture

Each engine runs as a separate FastAPI process on its own port:

| Engine | Port | VRAM   | License      | Quality |
|--------|------|--------|--------------|---------|
| YuE2   | 8200 | ~6GB   | CC-BY-NC-4.0 | Best    |
| ACE    | 8201 | ~4GB   | Apache-2.0   | Good    |

The main backend coordinates GPU allocation through VRAM manager:
- `begin_music_generation()` — offloads Ollama, signals ComfyUI
- `end_music_generation()` — reloads Ollama, returns to idle

The service itself also includes hardening:
- **Startup validation:** fails loud and early if `yue2` / `acestep` imports are missing.
- **Shared HTTP session:** one `aiohttp.ClientSession` reused for all requests.
- **Graceful shutdown:** engine `terminate()` then `kill()` after 5s grace on stop.
- **Python discovery:** prefers `tools/music-gen/.venv`, then `MUSIC_GEN_PYTHON`, warns on `sys.executable` fallback.

## Setup

### Option A: Conda environment (recommended)

```powershell
# Create dedicated env for music-gen
conda create -n music-gen python=3.11 -y
conda activate music-gen

# Install YuE2
pip install yue2

# Or install ACE-Step
pip install acestep

# Common deps
pip install fastapi uvicorn aiohttp soundfile
```

### Option B: venv in service directory

```powershell
cd tools/music-gen
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
pip install yue2  # or acestep
```

## Running

### Standalone

```powershell
# YuE2 on port 8200
python tools/music-gen/server.py --engine yue2 --port 8200 --vram-budget 6

# ACE-Step on port 8201
python tools/music-gen/server.py --engine ace --port 8201 --vram-budget 4
```

### Via startup script

```powershell
# Foreground
.\tools\music-gen\start-service.ps1 -Engine yue2

# Background
.\tools\music-gen\start-service.ps1 -Engine yue2 -Background
```

### Via backend API

```powershell
# Start from backend
curl -X POST http://127.0.0.1:8000/api/music-gen/start -d '{"engine":"yue2"}'

# Stop
curl -X POST http://127.0.0.1:8000/api/music-gen/stop?engine=yue2
```

## API Endpoints

### Service management
- `GET  /health` — Health check
- `GET  /vram` — VRAM usage
- `POST /unload` — Free VRAM (for VRAM manager)
- `POST /reload` — Reload engine

### Generation
- `POST /generate` — Generate complete song
- `POST /plan` — Score only, no audio (YuE2)
- `POST /render` — Render from ABC score (YuE2)

### Files
- `GET  /audio/{name}` — Download audio
- `GET  /score/{name}` — Download ABC score

## Environment Variables

- `MUSIC_GEN_PYTHON` — Path to Python interpreter for this service (fallback if `tools/music-gen/.venv` is absent).
- `CUDA_VISIBLE_DEVICES` — GPU selection (default: 0)

Python interpreter discovery order:
1. `tools/music-gen/.venv/Scripts/python.exe` (recommended)
2. `MUSIC_GEN_PYTHON`
3. Backend `sys.executable` (logged as a warning)

## VRAM Coordination

The service integrates with the backend's VRAM manager:

1. Backend calls `POST /api/music-gen/start`
2. VRAM manager calls `begin_music_generation()` → offloads Ollama
3. Music-gen subprocess loads model onto freed VRAM
4. When done, backend calls `POST /api/music-gen/stop`
5. VRAM manager calls `end_music_generation()` → reloads Ollama

This ensures YuE2/ACE-Step and ComfyUI never compete for VRAM simultaneously.
