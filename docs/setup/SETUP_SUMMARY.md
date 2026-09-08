# Setup Summary — Native Media AI Studio

> **Last Updated:** 2026-09-07 — ComfyUI updated to ea33b154, Manager enabled with `--enable-manager`, backend running on 8001, frontend on 5174. Supersedes Aug 2026 setup snapshot. See `docs/setup/CONDA_SETUP.md` + `docs/setup/python-environments.md` for canonical env docs.

## ✅ Current System Status

### Running Services (2026-09-07)

| Service | Port | Health Check | Notes |
|---------|------|--------------|-------|
| Backend (FastAPI) | 8001 | `GET http://127.0.0.1:8001/api/health` | SSE `GET /api/events`, queue, audio analysis (librosa); dynamic via `port_manager.py` |
| Frontend (Vite) | 5174 | `http://127.0.0.1:5174` | 19 routes + legacy redirects; dynamic via `port_manager.py` |
| Video Editor (Remotion) | 8080 | `http://127.0.0.1:8080` | `config/ports.json` dynamic |
| ComfyUI | 8188 | `GET http://127.0.0.1:8188/system_stats` | Hunyuan3D-2mini, Wan 2.2 5B, AnimateDiff; started with `--enable-manager` |
| Unity MCP Bridge | 7800 (REST) | `POST http://127.0.0.1:7800/api/exec {command:"editor_status"}` | `tools/mcp/unity-mcp-bridge.mjs` |
| Blender MCP | 9876 (TCP) | Blender addon sidebar “Start MCP Server” | `uvx blender-mcp`, executable `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` |
| Ollama | 11434 | `GET http://127.0.0.1:11434/api/tags` | `gemma4:e2b-it-qat`, `qwen3-vl:4b` |

### Python Environments

| Env | Path | Use |
|-----|------|-----|
| Primary (CUDA, backend) | `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` — Python 3.11.9, PyTorch 2.14.0+cu126 | Backend, `tools/analyze_and_sync.py`, CUDA processor |
| ComfyUI Runtime | `D:\conda-envs\comfyui-cuda\Scripts\python.exe` — PyTorch 2.14.0+cu126 | ComfyUI service only |
| Fallback (CPU) | `.\venv\Scripts\python.exe` | CPU-only fallback |

`nma-studio-cuda` is a standalone venv (base interpreter: `C:\Users\Aomega Imaging\AppData\Local\Programs\Python\Python311`) fully decoupled from `D:\conda-envs\space-analyzer-cuda` (different project — do not touch). Former `runtime/venvs/.venvs/venv_*` 8-venv matrix was a draft plan and was never created — see `docs/setup/python-environments.md`.

### ComfyUI Location

External install at `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI` (not `third_party/ComfyUI`).

| Model | Location | VRAM |
|-------|----------|------|
| SD 1.5 | `stable-diffusion/models/checkpoints/` | 4GB |
| Hunyuan3D-2mini | `ComfyUI/models/diffusion_models/hunyuan3d-2mini` | ~5GB |
| Wan 2.2 5B | `ComfyUI/models/diffusion_models/wan2.2-5b` | 6-8GB 480p |
| AnimateDiff | `ComfyUI/custom_nodes/ComfyUI-AnimateDiff-Evolved` + motion modules | ~1.6GB |

### Generated Outputs

| Type | Location |
|------|----------|
| Images | `output/images/` + sidecar `.json` |
| Video | `output/video/*.mp4` |
| Audio | `output/audio/` + `analysis/` cache + `audio/{stem}.jpg` cover sidecar |
| 3D | `output/generated_3d/*.glb` |

---

## 🚀 Quick Start (Current)

```powershell
# Start all services
pnpm start
# or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-studio.ps1

# Check status
pnpm servers status
# or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action status

# Backend only (studio venv, CUDA) — dynamic port via port_manager.py
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --app-dir packages/backend

# ComfyUI (own runtime env) — --enable-manager required for Manager queue API
D:\conda-envs\comfyui-cuda\Scripts\python.exe main.py --port 8188 --disable-pinned-memory --enable-manager
# WorkingDirectory: D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI
```

See `docs/setup/CONDA_SETUP.md`, `docs/setup/VIDEO_SETUP.md`, `docs/setup/MODEL_SETUP.md` for model-specific guides, and `docs/SYSTEM_REQUIREMENTS.md` for system-level tools.

---

## 📁 Key Files Reference (Current)

### Configuration
- `config/ports.json` — Dynamic port map (backend 8001, frontend 5174, video 8080, comfyui 8188, SSE `events_url`/`sse_url`, legacy `ws_url`)
- `config/settings.json` — AppConfig
- `opencode.json` — MCP servers (6: ollama-tools, vision, remotion, comfyui --force-remote, blender 9876, unity 7800)
- `kilo.jsonc` — Kilo Code instructions (`AGENTS.md`, `Guidelines.md`)

### Scripts
- `scripts/start-studio.ps1` — Start all services (canonical)
- `scripts/manage-servers.ps1` — Individual control (start/stop/status/restart)
- `scripts/start_comfyui.ps1` — ComfyUI launcher
- `scripts/capture-visualizer-frames.mjs` — Frame capture utility (→ `tools/vision/analyze.mjs` for analysis)

### Output (gitignored)
- `output/images/`, `output/video/`, `output/audio/`, `output/generated_3d/`, `output/audio_analysis/`

### Knowledge Library
- `docs/knowledge-library/` — Vault: 27 md + 4 json + 1 canvas (see `index.md`, `README.md`)

---

## 🔧 Troubleshooting

### Backend won't start (Port 8001 in use)
```powershell
# Port manager auto-increments; check:
Get-NetTCPConnection -LocalPort 8001 -State Listen
# or kill orphan python from previous crash:
taskkill /F /IM python.exe
# prefer managed restart:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action restart -Services backend
```

### ComfyUI not responding
```powershell
curl http://127.0.0.1:8188/system_stats
# Restart
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action restart -Services comfyui
```

### Media Library not loading
1. `curl http://127.0.0.1:8001/api/health`
2. Check `packages/frontend` Vite proxy (`vite.config.ts` → `/api` → 8001)
3. Refresh page; check `GET /api/outputs` response

---

## 📊 GTX 1070 Ti 8GB Notes

- Image 512x512 20 steps: ~14-20s, 6-7GB
- Hunyuan3D-2mini 15 steps: ~5GB, 2-3 min
- Wan 2.2 5B 480p: 6-8GB fits; 14B 720p needs 24GB (cloud)

---

## Archive Note

Previous Aug 2026 content referenced `frontend/src/...` (now `packages/frontend/src/...`), `third_party/ComfyUI` (now external), `http://localhost:3002` (now 5173/8080), and `WebSocket ws://.../ws` (now SSE `GET /api/events`). Those paths are preserved in git history.

*See also: `docs/implementation-summary.md` (Three.js Studio 2026-08-27), `docs/guides/MUSIC_VIDEO_GUIDE.md` (Wizard 5-step), `docs/guides/GPU_PIPELINE.md` (CUDA 12.4).*
