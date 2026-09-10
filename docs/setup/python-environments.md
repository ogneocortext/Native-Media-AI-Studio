# Python Environment Setup

> **Last Updated:** 2026-09-08 — added `studio-tools` (Python 3.14) for standalone tooling

## Python Version

- **Backend / CUDA:** Python 3.11.x
- **Standalone tools:** Python 3.14.x

## Environments

### Backend + GPU (`nma-studio-cuda`)
- **Path:** `D:\conda-envs\nma-studio-cuda\Scripts\python.exe`
- **Python:** 3.11.9 (standalone venv, decoupled from `space-analyzer-cuda`)
- **PyTorch:** `2.14.0+cu126` (Pascal/sm_61-safe)
- **Use for:** Backend server, `tools/analyze_and_sync.py`, CUDA processor, any script that imports `app.*`, `torch`, or `librosa`

### ComfyUI Runtime (`comfyui-cuda`)
- **Path:** `D:\conda-envs\comfyui-cuda\Scripts\python.exe`
- **Python:** 3.11.9 (standalone venv, decoupled)
- **PyTorch:** `2.14.0+cu126`
- **Use for:** ComfyUI service runtime ONLY — do **not** use for backend work

### Standalone Tooling (`studio-tools`)
- **Path:** `D:\conda-envs\studio-tools\Scripts\python.exe`
- **Python:** 3.14.x
- **Use for:** Pure-tooling scripts that do **not** import backend/CUDA/ComfyUI code:
  - `tools/lib/paths.py`
  - `tools/convert_blend_to_glb.py`
  - `tools/blender/builder.py`
  - `tools/blender/lyrics_sync.py`
  - `tools/blender_mv_client.py`
  - `tools/design-feedback/design_feedback.py`
  - `scripts/utility/convert_lyrics_csv.py`
  - Various test/debug scripts
- **Dependencies:** see `tools/requirements-standalone.txt`

> [!note] Backend-dependent scripts (`tools/batch_process.py`, `tools/analyze_and_sync.py`, `tools/demos/*.py`, `scripts/run_coding_benchmark.py`, etc.) must continue to use `nma-studio-cuda`.

### Fallback (CPU-only)
- **Path:** `D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\venv\Scripts\python.exe`
- **Use for:** CPU-only experiments, quick tests that don't need CUDA

## Env topology

`nma-studio-cuda` and `comfyui-cuda` are standalone venvs built from `C:\Users\Aomega Imaging\AppData\Local\Programs\Python\Python311` (3.11.9). They are fully decoupled from `D:\conda-envs\space-analyzer-cuda` (belongs to a **different project** — never delete or modify it). `studio-tools` is built from `C:\Python314\python.exe` (3.14.x). There is **no conda installation** on this machine. The historical `runtime/venvs/.venvs/venv_*` 8-venv matrix was a draft plan and was never created.

## Quick Start

```powershell
# Backend — dedicated studio venv (preferred, GPU audio/3D work)
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# or via pnpm:
pnpm dev:backend

# Fallback — local venv (CPU, no CUDA)
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Standalone tooling — Python 3.14 (no CUDA)
D:\conda-envs\studio-tools\Scripts\python.exe tools\convert_blend_to_glb.py stage.blend
# or via launcher:
powershell -NoProfile -ExecutionPolicy Bypass -File tools\run.ps1 scripts\utility\convert_lyrics_csv.py
```

## Studio Environment Details

```powershell
# Verify CUDA
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"

# Install backend deps (requirements-torch.txt pins the Pascal-safe cu126 build)
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -m pip install -r packages/backend/requirements.txt
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -m pip install -r packages/backend/requirements-torch.txt

# Recreate from scratch (no conda needed)
py -V:3.11 -m venv D:\conda-envs\nma-studio-cuda
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -m pip install -U pip
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -m pip install -r packages/backend/requirements.txt -r packages/backend/requirements-torch.txt
```

## ComfyUI

ComfyUI keeps its own runtime env (`comfyui-cuda`):

```powershell
D:\conda-envs\comfyui-cuda\Scripts\python.exe main.py --port 8188 --disable-pinned-memory `
  --workingDirectory "D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI"
# or:
pnpm dev:comfyui  # → scripts/manage-servers.ps1 -Action start -Services comfyui
```

## Environment Variables

| Variable | In `.python-env` / `config/settings.json` | Purpose |
|----------|-------------------------------------------|---------|
| `PYTHON_ENV` | `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` | Studio interpreter for backend + CUDA features |
| `COMFYUI_ENV` | `D:\conda-envs\comfyui-cuda\Scripts\python.exe` | ComfyUI service interpreter |
| `TOOLS_ENV` | `D:\conda-envs\studio-tools\Scripts\python.exe` | Standalone tooling interpreter (Python 3.14, no CUDA) |
| `CUDA_VERSION` | `12.6` | Torch CUDA build pin |
| `PYTORCH_VERSION` | `2.14.0+cu126` | Wheel pin |
| `COMFYUI_PATH` | `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI` | ComfyUI root |
| `OUTPUT_DIR` | `./output` | Generative outputs |
