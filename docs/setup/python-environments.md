# Python Environment Setup

> **Last Updated:** 2026-09-05 — canonical env is `comfyui-cuda` conda env + `venv/` fallback

## Python Version

- **Required:** Python 3.11.x
- **Primary (CUDA):** `D:\conda-envs\comfyui-cuda\Scripts\python.exe` — PyTorch `2.5.1+cu124`, CUDA `12.4`
- **Fallback (CPU):** `D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\venv\Scripts\python.exe` — CPU-only
- **Config file:** `.python-env` (`PYTHON_ENV`, `CUDA_VERSION`, `PYTORCH_VERSION`, `ENV_TYPE=conda`)
- **Type checking:** `pyrightconfig.json` executionEnvironments point at `D:/conda-envs/comfyui-cuda/Scripts/python.exe`

> Historical `runtime/venvs/.venvs/venv_*` 8-venv matrix (`venv_backend`, `venv_comfyui`, …) was a draft plan and was never created. The actual layout is the single `comfyui-cuda` conda env + local `venv/` fallback (see `AGENTS.md` § Python Environment).

## Quick Start

```powershell
# Backend — conda CUDA env (preferred, GPU audio/3D work)
D:\conda-envs\comfyui-cuda\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# or via pnpm:
pnpm dev:backend

# Fallback — local venv (CPU, no CUDA)
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Conda Environment Details

The `comfyui-cuda` env is also used for ComfyUI (`tools`/`ComfyUI/main.py`) and for GPU analysis (`tools/analyze_and_sync.py`, `app/services/cuda/processor.py`).

```powershell
# Activate (if needed)
conda activate comfyui-cuda

# Verify CUDA
D:\conda-envs\comfyui-cuda\Scripts\python.exe -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"

# Install backend deps (same file the conda env uses)
D:\conda-envs\comfyui-cuda\Scripts\python.exe -m pip install -r packages/backend/requirements.txt
# or: pip install -r pyproject.toml  (PEP 517, same deps)
```

## ComfyUI

```powershell
D:\conda-envs\comfyui-cuda\Scripts\python.exe main.py --port 8188 --disable-pinned-memory `
  --workingDirectory "D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI"
# or:
pnpm dev:comfyui  # → scripts/start_comfyui.ps1
```

## Environment Variables

| Variable | In `.python-env` / `config/settings.json` | Purpose |
|----------|-------------------------------------------|---------|
| `PYTHON_ENV` | `D:\conda-envs\comfyui-cuda\Scripts\python.exe` | Interpreter for CUDA features |
| `CUDA_VERSION` | `12.4` | Toolkit pin |
| `PYTORCH_VERSION` | `2.5.1+cu124` | Wheel pin |
| `COMFYUI_PATH` | `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI` | ComfyUI root |
| `OUTPUT_DIR` | `./output` | Generative outputs |
