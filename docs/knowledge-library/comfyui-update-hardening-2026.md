---
tags:
  - technical
  - platform-comfyui
aliases:
  - ComfyUI Update Hardening
  - ComfyUI Update Safety
cssclasses:
  - technical-guide
date: 2026-11-25
type: concept
---

# 🔧 ComfyUI Update Hardening

> [!info] Purpose
> Prevent ComfyUI source-repo updates from breaking the local Pascal (GTX 1070 Ti, sm_61) setup, avoid re-downloading packages already on disk, and provide a documented rollback path when an update does break something.

---

## The problem

ComfyUI is a standalone git checkout at `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI`, updated via `git pull`. Every update runs `pip install -r requirements.txt --upgrade`, which:

1. **Pulls whatever is latest on PyPI** — new versions of torch, transformers, numpy, etc. can drop Pascal (sm_61) support or introduce incompatibilities with custom nodes.
2. **Re-downloads packages already on disk** — even when nothing changed, `--upgrade` re-resolves and re-downloads, wasting bandwidth and time on metered or offline connections.
3. **Breaks silently** — ComfyUI may start but fail at runtime when a node or model loader hits an incompatible dependency.

This document describes the hardening measures in place and the operational procedures to keep ComfyUI stable on this rig.

---

## What was changed

### 1. All requirements pinned (`ComfyUI/requirements.txt`)

Every package in ComfyUI's `requirements.txt` is now pinned to an exact version (`package==version`) rather than loose specifiers (`>=`, `~=`, bare). This matches the versions verified working in the `comfyui-cuda` venv.

Pinned packages include:

| Package | Pinned version | Reason |
|---------|---------------|--------|
| `torch` | `2.14.0+cu126` | Last PyTorch wheel with sm_61 (Pascal) kernels |
| `torchvision` | `0.29.0+cu126` | Matching cu126 build for torch 2.14.x |
| `torchaudio` | `2.11.0+cu126` | Matching cu126 build for torch 2.14.x |
| `torchsde` | `0.2.6` | Verified working |
| `numpy` | `2.4.6` | Verified working |
| `transformers` | `5.24.1` | Verified working |
| `aiohttp` | `3.14.5` | Verified working |
| `Pillow` | `13.0.0` | Verified working |
| ... | ... | All 40+ packages pinned |

The `--extra-index-url https://download.pytorch.org/whl/cu126` index is specified so PyTorch resolves from the cu126 wheel channel (Pascal-safe), not the default PyPI (which drops sm_61 from torch 2.8.0+).

### 2. Skip re-downloads when versions match (`comfyui_manager.py`)

`ComfyUIManager._update_requirements()` now:

1. Parses `package==version` pins from `requirements.txt`.
2. Probes the `comfyui-cuda` venv for each package's installed version via `importlib.metadata`.
3. **Skips `pip install` entirely** when all pinned packages are already at their pinned versions.
4. Only runs `pip install -r requirements.txt --upgrade` when mismatches are found.

This means:
- If nothing changed, no packages are re-downloaded.
- If only one package drifted, pip still runs but only to fix that package.
- The backend API (`POST /api/services/comfyui/update`) reports whether the pip step was skipped.

The same skip logic applies to custom node requirements in `_update_custom_nodes()`.

### 3. Pre-flight version check (`scripts/comfyui-safe-update.ps1`)

`comfyui-safe-update.ps1` now calls `Test-ComfyUIVersions` before updating:

- Reads pins from `ComfyUI/requirements.txt`.
- Probes installed versions in `comfyui-cuda`.
- Warns about any drift (installed version ≠ pinned version).
- Tells the user an update will re-download packages to restore pins.
- Can be skipped with `-SkipVersionCheck`.

### 4. Backup + patch + rollback system (unchanged, documented here)

`comfyui-safe-update.ps1` already:

1. **Backs up** all local modifications (modified, staged, untracked files) to `.comfyui-backups/backup-<timestamp>/` before any git pull.
2. **Exports patches** from local changes to `scripts/comfyui-patches/` so they can be reapplied after upstream changes.
3. **Validates patches** against the current tree before pulling (`git apply --check`).
4. **Pulls** `origin master` with `--no-rebase`.
5. **Reapplies** patches after the pull.
6. **Rolls back** to the most recent backup with `.\comfyui-safe-update.ps1 -Rollback`.

Backups are rotated (keep last 5 by default, configurable with `-KeepBackups`).

---

## Operational procedures

### Updating ComfyUI

**Through the backend API** (recommended):

```bash
curl -X POST http://127.0.0.1:8000/api/services/comfyui/update
```

This stops ComfyUI if running, runs `git pull`, checks requirement pins (skipping pip if all match), updates custom nodes, and restarts.

**Through PowerShell** (for local modifications/patches):

```powershell
.\scripts\comfyui-safe-update.ps1
```

This performs the full backup → patch-export → validate → pull → reapply cycle.

**Dry-run** (validate without pulling):

```powershell
.\scripts\comfyui-safe-update.ps1 -DryRun
```

### Rolling back a broken update

If an update breaks ComfyUI:

```powershell
.\scripts\comfyui-safe-update.ps1 -Rollback
```

This restores the most recent backup (local modifications + commit hash) and restarts ComfyUI at the previous state.

### Checking for version drift

```powershell
.\scripts\comfyui-patch-status.ps1
```

Shows local changes, patches, backups, and whether patches still apply cleanly against the current tree.

### Verifying Pascal (sm_61) support

After any torch change, verify sm_61 kernels are present:

```powershell
& 'D:\conda-envs\comfyui-cuda\Scripts\python.exe' -c "import torch; print('sm_61 present:', 'sm_61' in torch.cuda.get_arch_list())"
```

Expected output: `sm_61 present: True`

---

## Files involved

| File | Purpose |
|------|---------|
| `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI\requirements.txt` | Pinned package versions (Pascal-safe) |
| `packages/backend/app/services/comfyui_manager.py` | Backend update logic with version-check skip |
| `scripts/comfyui-safe-update.ps1` | Local backup/patch/rollback + pre-flight version check |
| `scripts/comfyui-patch-status.ps1` | Status/drift report |
| `scripts/comfyui-patches/` | Exported patches for local modifications |
| `.comfyui-backups/` | Timestamped backups before each update |
| `packages/backend/app/api/comfyui.py` | `POST /api/services/comfyui/update` endpoint |
| `packages/frontend/src/services/api/integrations.ts` | Frontend `updateComfyUI()` client |
| `docs/knowledge-library/torch-cuda-support-windows-2026.md` | Pascal/PyTorch version matrix |
| `docs/knowledge-library/comfyui-workflows.md` | ComfyUI workflows and model inventory |

---

## Related

- [[torch-cuda-support-windows-2026]]:see-also — Pascal/PyTorch version matrix and wheel availability
- [[comfyui-workflows]]:see-also — ComfyUI workflows, model inventory, and 8GB VRAM constraints
