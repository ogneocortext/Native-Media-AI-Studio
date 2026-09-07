# Python Environment Setup

> **Last Updated:** 2026-09-06 — backend/GPU env decoupled: dedicated `nma-studio-cuda` venv; `comfyui-cuda` is ComfyUI's runtime only; `venv/` CPU fallback

## Python Version

- **Required:** Python 3.11.x
- **Primary (CUDA, backend):** `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` — standalone venv on Python 3.11.9, PyTorch `2.14.0+cu126` (Pascal/sm_61-safe)
- **ComfyUI Runtime:** `D:\conda-envs\comfyui-cuda\Scripts\python.exe` — PyTorch `2.14.0+cu126`; used **only** by the ComfyUI service
- **Fallback (CPU):** `D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\venv\Scripts\python.exe` — CPU-only
- **Config file:** `.python-env` (`PYTHON_ENV`, `COMFYUI_ENV`, `CUDA_VERSION`, `PYTORCH_VERSION`, `ENV_TYPE=venv`)
- **Type checking:** `pyrightconfig.json` executionEnvironments point at `D:/conda-envs/nma-studio-cuda/Scripts/python.exe`

> **Env topology (2026-09-06):** `nma-studio-cuda` is a standalone venv (base interpreter `C:\Users\Aomega Imaging\AppData\Local\Programs\Python\Python311`, Python 3.11.9) — fully decoupled from `D:\conda-envs\space-analyzer-cuda`, which belongs to a **different project** (never delete or modify it for this project). Historically `comfyui-cuda` was a venv bootstrapped *from* `space-analyzer-cuda`; it now serves as ComfyUI's runtime only. There is **no conda installation** on this machine — `ENV_TYPE=conda` references in older docs are wrong. The historical `runtime/venvs/.venvs/venv_*` 8-venv matrix was a draft plan and was never created.

## Quick Start

```powershell
# Backend — dedicated studio venv (preferred, GPU audio/3D work)
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# or via pnpm:
pnpm dev:backend

# Fallback — local venv (CPU, no CUDA)
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
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
pnpm dev:comfyui  # → scripts/start_comfyui.ps1
```

## Environment Variables

| Variable | In `.python-env` / `config/settings.json` | Purpose |
|----------|-------------------------------------------|---------|
| `PYTHON_ENV` | `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` | Studio interpreter for backend + CUDA features |
| `COMFYUI_ENV` | `D:\conda-envs\comfyui-cuda\Scripts\python.exe` | ComfyUI service interpreter |
| `CUDA_VERSION` | `12.6` | Torch CUDA build pin |
| `PYTORCH_VERSION` | `2.14.0+cu126` | Wheel pin |
| `COMFYUI_PATH` | `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI` | ComfyUI root |
| `OUTPUT_DIR` | `./output` | Generative outputs |
