# Conda Setup Guide for Native Media AI Studio

> **Why Conda?** Your project uses PyTorch, CUDA, audio/video processing libraries, and ComfyUI — all with complex binary dependencies. Conda isolates these into a single reproducible environment, eliminating "works on my machine" issues and simplifying CUDA management.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Manual Setup (if you prefer control)](#manual-setup)
4. [Daily Workflow](#daily-workflow)
5. [Understanding the Environment](#understanding-the-environment)
6. [Troubleshooting](#troubleshooting)
7. [Migrating from venv/System Python](#migrating-from-venvsystem-python)

---

## Prerequisites

- **Miniconda** or **Anaconda** installed at your location here
- **Git** (for cloning custom nodes, included in the conda env)
- **NVIDIA GPU drivers** already installed (you have GTX 1070 Ti)

---

## Quick Start

The fastest way to get started:

```powershell
# 1. Open PowerShell in the repo root (VS Code terminal works)

# 2. Run the automated setup
.\scripts\setup-conda-env.ps1

# 3. Wait 10-30 minutes (downloads PyTorch + CUDA toolkit ~2-3GB)

# 4. Activate when done
conda activate nma-studio

# 5. Verify everything works
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

**That's it.** Your backend, ComfyUI, and all ML tools now share one environment.

---

## Manual Setup

If you prefer to run commands individually:

### Step 1: Ensure conda is available

```powershell
# If 'conda' is not recognized, run:
.\add_conda_path.ps1

# Or permanently initialize conda for PowerShell:
conda init powershell
# Then restart your terminal
```

### Step 2: Create the environment

```powershell
conda env create -f environment.yml
```

This reads `environment.yml` from the repo root and creates the `nma-studio` environment with:
- Python 3.11
- PyTorch 2.4 + CUDA 12.1 (conda-managed, no system CUDA needed)
- FastAPI, Uvicorn, Socket.IO (backend)
- Diffusers, Transformers, Accelerate (ML)
- Librosa, Soundfile, FFmpeg (audio)
- All ComfyUI core dependencies

### Step 3: Activate

```powershell
conda activate nma-studio
```

### Step 4: Install ComfyUI extras (optional)

```powershell
# ComfyUI's own requirements (some overlap, pip handles deduplication)
pip install -r third_party\ComfyUI\requirements.txt

# Custom nodes (example: AnimateDiff-Evolved)
cd third_party\ComfyUI\custom_nodes
# git clone https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved.git
# cd ComfyUI-AnimateDiff-Evolved
# pip install -r requirements.txt
```

---

## Daily Workflow

### Starting Development

Open **three terminals** (all with `nma-studio` activated):

```powershell
# Terminal 1 — Backend
cd "<your-project-root>"
conda activate nma-studio
cd backend
uvicorn app.main:app --reload --port 8000

# Terminal 2 — ComfyUI
conda activate nma-studio
cd third_party\ComfyUI
python main.py --port 8188 --listen 127.0.0.1 --lowvram

# Terminal 3 — Frontend
conda activate nma-studio  # (or just use system node/npm)
cd frontend
npm run dev
```

### VS Code Integration

To make VS Code always use the conda environment:

1. **Select Python Interpreter:**
   - Press `Ctrl+Shift+P` → "Python: Select Interpreter"
   - Choose: `Python 3.11.x ('nma-studio': conda)`

2. **Configure Terminal (optional but recommended):**
   Add to your workspace `.vscode/settings.json`:
   ```json
   {
     "python.defaultInterpreterPath": "<your-miniconda-path>/envs/nma-studio/python.exe",
     "terminal.integrated.env.windows": {
       "PATH": "<your-miniconda-path>/envs/nma-studio;<your-miniconda-path>/Scripts;${env:PATH}"
     }
   }
   ```

3. **Pyright / Type Checking:**
   Already configured in `pyproject.toml` and `pyrightconfig.json` to use Python 3.10+.

### Updating Dependencies

When dependencies change (e.g., after `git pull`):

```powershell
conda env update -f environment.yml --prune
```

Or if someone adds pip packages:

```powershell
conda activate nma-studio
pip install -r backend/requirements.txt
```

### Switching Between Projects

```powershell
conda deactivate          # Leave nma-studio
conda activate other-env  # Switch to another project
conda env list            # See all environments
```

---

## Understanding the Environment

### What's in `nma-studio`?

| Layer | Source | Purpose |
|-------|--------|---------|
| Python 3.11 | conda | Runtime |
| PyTorch + CUDA 12.1 | conda (`pytorch`, `nvidia` channels) | GPU compute, environment-local CUDA |
| NumPy, Pillow, SciPy | conda (`conda-forge`) | Scientific stack |
| Librosa, FFmpeg | conda (`conda-forge`) | Audio processing |
| FastAPI, Uvicorn, etc. | pip | Backend framework |
| Diffusers, Transformers | pip | Hugging Face ML models |
| `-e ./backend` | pip (editable) | Your backend code as a package |

### Why conda channels matter

```yaml
channels:
  - pytorch        # Official PyTorch builds
  - nvidia         # CUDA toolkit, cuDNN
  - conda-forge    # Community packages (librosa, ffmpeg, etc.)
  - defaults       # Anaconda defaults (fallback)
```

Channel order = priority order. `pytorch` channel gets first pick for torch packages.

### CUDA is now environment-local

Before (system Python): CUDA 12.1 installed system-wide, `torch` wheels bundled their own CUDA runtime, versions could drift.

After (conda): `nvidia::cuda-toolkit=12.1` is a conda package inside `nma-studio`. Other conda envs can use different CUDA versions. No system pollution.

---

## Troubleshooting

### "conda is not recognized"

```powershell
.\add_conda_path.ps1
# OR permanently:
<your-miniconda-path>\Scripts\conda.exe init powershell
# Restart terminal
```

### "CUDA out of memory" during generation

Your GTX 1070 Ti has 8GB VRAM. Within `nma-studio`:

```powershell
# Check VRAM usage
python -c "import torch; print(f'{torch.cuda.get_device_properties(0).total_memory/1024**3:.1f} GB')"

# Start ComfyUI with low VRAM mode
python main.py --port 8188 --listen 127.0.0.1 --lowvram

# Reduce generation settings
# - Resolution: 512x512 max
# - Steps: 20 max
# - Batch size: 1
```

### "ModuleNotFoundError" for backend imports

The backend is installed as an editable package (`-e ./backend` in `environment.yml`). If you see import errors:

```powershell
conda activate nma-studio
cd "<your-project-root>"
pip install -e ./backend
```

### Environment creation fails on "Solving environment"

Conda's solver can be slow. Use the faster `libmamba` solver:

```powershell
conda install -n base conda-libmamba-solver
conda env create -f environment.yml --solver=libmamba
```

Or switch entirely to `mamba` (C++ reimplementation of conda):

```powershell
conda install -n base mamba
mamba env create -f environment.yml
```

### "torch.cuda.is_available() returns False"

1. Check NVIDIA drivers: `nvidia-smi`
2. Verify conda CUDA matches PyTorch CUDA:
   ```powershell
   python -c "import torch; print(torch.version.cuda)"  # Should print 12.1
   conda list | findstr cuda-toolkit                      # Should show 12.1
   ```
3. If mismatch, reinstall:
   ```powershell
   conda install pytorch pytorch-cuda=12.1 -c pytorch -c nvidia
   ```

### ComfyUI custom nodes fail to load

Custom nodes often have their own `requirements.txt`. Install them inside `nma-studio`:

```powershell
conda activate nma-studio
cd third_party\ComfyUI\custom_nodes\SomeCustomNode
pip install -r requirements.txt
```

**Never** install custom node dependencies into a different Python environment.

---

## Migrating from venv/System Python

You currently have:
- System Python 3.11 with global ML packages
- `backend/venv` for the backend
- ComfyUI using its own Python context

### Migration Steps

1. **Create `nma-studio` env** (see Quick Start above)
2. **Test the backend in the new env:**
   ```powershell
   conda activate nma-studio
   cd backend
   uvicorn app.main:app --reload --port 8000
   ```
3. **Test ComfyUI in the new env:**
   ```powershell
   conda activate nma-studio
   cd third_party\ComfyUI
   python main.py --port 8188 --lowvram
   ```
4. **Keep the old venv as backup** until you're confident, then delete:
   ```powershell
   Remove-Item -Recurse -Force backend\venv
   ```
5. **Update your start scripts** to use `conda activate nma-studio` instead of `venv\Scripts\activate`

### What changes in your workflow?

| Before | After |
|--------|-------|
| `backend\venv\Scripts\activate` | `conda activate nma-studio` |
| System-wide CUDA management | Conda-managed CUDA in env |
| Multiple Python contexts | One unified env for everything |
| `pip list` scattered across systems | `conda list` in one place |
| No lock file for binary deps | `environment.yml` in version control |

---

## File Reference

| File | Purpose |
|------|---------|
| `environment.yml` | Conda environment specification (commit this) |
| `scripts/setup-conda-env.ps1` | Automated setup script |
| `add_conda_path.ps1` | Fix "conda not found" in current terminal |
| `CONDA_SETUP.md` | This documentation |
| `pyproject.toml` | Python package metadata + tool configs (ruff, mypy, pyright) |
| `backend/requirements.txt` | Pip-only deps (superset of `environment.yml` pip section) |

---

## Next Steps

1. ✅ Run `.\scripts\setup-conda-env.ps1`
2. ✅ Activate with `conda activate nma-studio`
3. ✅ Verify with `python -c "import torch; print(torch.cuda.is_available())"`
4. ✅ Start developing (backend + ComfyUI + frontend)
5. ✅ Commit `environment.yml` to git so teammates can recreate the exact environment

---

> **Questions?** Check `SETUP_SUMMARY.md` for the broader project status, or `MODEL_SETUP.md` / `VIDEO_SETUP.md` for model-specific guides.
