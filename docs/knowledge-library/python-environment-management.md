---
tags:
  - python
  - environments
  - venv
  - pytorch
  - cuda
  - hardware
  - configuration
aliases:
  - Python Environment Management
  - venv Decoupling
  - PyTorch Pascal Support
date: 2026-09-06
---

# 🐍 Python Environment Management & Pascal GPU Support

> [!info] Purpose
> Ground truth for how Python environments on this machine relate to each other, why
> venvs must **never be copied or deleted casually**, which PyTorch builds work on the
> GTX 1070 Ti (Pascal sm_61), and the correct recipes for creating, migrating, and
> validating environments. Written from official docs + pytorch.org (verified 2026-09-06)
> and live-validated on this machine.

---

## 1. Machine interpreter & environment inventory (verified 2026-09-06)

### Standalone interpreters

| Interpreter | Version | Notes |
| --- | --- | --- |
| `C:\Users\Aomega Imaging\AppData\Local\Programs\Python\Python311\python.exe` | 3.11.9 | ✅ The only "safe" standalone CPython for this project's stack. Base for `nma-studio-cuda` and project `venv/` |
| `C:\Python314` | 3.14 | Too new for torch/CUDA wheels — do not use for backend |
| `winget` v1.29.290 available | — | Install more standalone Pythons via `winget install Python.Python.3.11` (or `Python.Python.312`) |

### `D:\conda-envs` environments

| Env | Size | Python | Base / parent | Role | Torch |
| --- | --- | --- | --- | --- | --- |
| `nma-studio-cuda` | 4.87 GB | 3.11.9 | **Standalone C: Python311** (decoupled ✅) | Native Media AI Studio backend + GPU | 2.14.0+cu126 |
| `comfyui-cuda` | 6.47 GB | 3.12.13 | ⚠️ venv bootstrapped FROM `space-analyzer-cuda` | ComfyUI service runtime ONLY | 2.14.0+cu126 |
| `space-analyzer-cuda` | 9.17 GB | 3.12.13 | conda env | ❌ **Different project (moto-vision). NEVER delete or modify** | 2.6.0-era |

### Hidden dependency graph (why deletion is dangerous)

```
C:\...\Python311 (3.11.9, standalone)
├── D:\conda-envs\nma-studio-cuda    (this project: backend + GPU)
└── D:\Backup...\Native Media AI Studio\venv  (project CPU fallback)

D:\conda-envs\space-analyzer-cuda  (Python 3.12.13 — ANOTHER PROJECT'S env)
├── D:\conda-envs\comfyui-cuda       (ComfyUI runtime venv ← bootstrapped from it)
└── D:\moto-vision-venv              (moto-vision project venv, --system-site-packages)
```

> [!danger] Deleting `space-analyzer-cuda` breaks THREE things, not one
> Its `python.exe` is the `home` of two venvs: `comfyui-cuda` (this project's ComfyUI
> service) and `moto-vision-venv` (a different project). It is also the only Python

---

## 3. Correct "copy an environment" recipe

The user may have useful envs on C: or D: worth porting into a project. Venvs cannot
be copied — migrate them like this instead:

```powershell
# 1. Export from source env (approximate — binary builds rarely reproduce exactly)
& D:\path\to\source-env\Scripts\python.exe -m pip freeze > reqs-export.txt

# 2. Create a fresh venv from a STANDALONE interpreter (never from another project's env)
& "C:\Users\Aomega Imaging\AppData\Local\Programs\Python\Python311\python.exe" -m venv D:\conda-envs\new-env

# 3. Install — pin torch FIRST with the correct CUDA index, then the rest
& D:\conda-envs\new-env\Scripts\python.exe -m pip install torch==2.14.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
& D:\conda-envs\new-env\Scripts\python.exe -m pip install -r reqs-export.txt

# 4. Validate (see §6)
& D:\conda-envs\new-env\Scripts\python.exe -m pip check
```

Prefer the project's own `packages/backend/requirements.txt` +
`requirements-torch.txt` over `pip freeze` output — freeze files capture
platform-specific hashes and transient packages that don't transfer.

---

## 4. PyTorch × CUDA × Pascal (GTX 1070 Ti, sm_61) — verified matrix

Source: pytorch.org "Previous Versions" + get-started pages, fetched 2026-09-06.

| Torch | CUDA wheel tracks published | Pascal (sm_61) OK? |
| --- | --- | --- |
| 2.5.1 (historical) | cu118, cu121, cu124 | ✅ 2.5.1+cu121 was live-verified on the 1070 Ti |
| 2.7.0 / 2.7.1 | cu126, cu128, cu130 | ✅ via cu126 |
| 2.8.0 | cu126, cu128, cu130 | ✅ via cu126 — ⚠️ last version whose *default PyPI* wheel includes sm_5x/6x |
| 2.9.0 (Oct 2025) | cu126, cu128, cu130 | ✅ via cu126 |
| 2.11.0 | cu126, cu128, cu130, cu132 | ✅ via cu126 |
| 2.12.0 / 2.12.1 | cu126, cu130, cu132 — **cu128 dropped** | ✅ via cu126 |
| 2.13.0 | cu126, cu130, cu132 | ✅ via cu126 |
| 2.14.0 (**current stable**) | **cu126 (default on get-started page), cu130, cu132**, ROCm 7.14, CPU | ✅ via cu126 — wheel index live-verified: `torch-2.14.0+cu126-cp311-cp311-win_amd64.whl` exists |

Key facts:

- **NVIDIA deprecated Pascal/Volta in CUDA 13 itself** (not just PyTorch). Verbatim
  from the CUDA Toolkit 13.0 Release Notes (via
  https://doc.ilabt.imec.be/ilabt/gpulab/gpu-software-compatibility.html):
  > "Architecture support for Maxwell, Pascal, and Volta is considered
  > feature-complete. Offline compilation and library support for these architectures
  > have been removed in CUDA Toolkit 13.0 major version release. The use of CUDA
  > Toolkits through the 12.x series to build applications for these architectures
  > will continue to be supported, but newer toolkits will be unable to target these
  > architectures."
  Source: https://docs.nvidia.com/cuda/archive/13.0.0/cuda-toolkit-release-notes/index.html#deprecated-architectures
- **⚠️ `pip install torch` (unpinned) breaks Pascal from torch 2.8.0 onward.** The
  *default PyPI* wheels' arch list jumps from `sm_50…sm_90` (2.7.x) to `sm_70+`
  (2.8.0+) — verified via
  https://github.com/moi90/pytorch_compute_capabilities/blob/main/table_pip.md.
  Always install with an explicit `--index-url https://download.pytorch.org/whl/cu126`
  on the 1070 Ti.
- **The cu126 wheel track is alive through current stable** — verified live in the
  official index (https://download.pytorch.org/whl/cu126/torch/): cp311-win_amd64
  wheels exist for every version from 2.6.0 → 2.14.0. The pytorch.org get-started
  matrix still lists CUDA 12.6 as the *default* selected compute platform for
  stable 2.14.0.
- **CUDA 13.x builds (`cu130`, `cu132`) cannot target Pascal** — see NVIDIA quote
  above. **Never install cu130/cu132 wheels on the 1070 Ti.**
- Python floor: **"NOTE: Latest Stable PyTorch requires Python 3.10 or later"** —
  read live from pytorch.org/get-started/locally/ (2026-09-07). Python 3.11.9 is
  comfortably in range.
- Binary-compat nuance: default 2.7.x wheels list `sm_60` but not `sm_61`; sm_60
  cubins run on sm_61 devices (same major CC), but without sm_61-specific tuning.
   The cu126 track builds with explicit sm_61 (our 2.14.0+cu126 arch list confirms it).
- Before committing any torch upgrade, verify kernel support:

```powershell
& D:\conda-envs\nma-studio-cuda\Scripts\python.exe -c "import torch; print(torch.__version__, torch.version.cuda); print(torch.cuda.get_arch_list()); print(torch.cuda.is_available())"
# Pass criteria: arch list contains 'sm_61' and is_available() is True
```

> [!warning] ComfyUI env is pinned to 2.14.0+cu126 for the same reason
> Any tool that "helpfully" upgrades torch in `comfyui-cuda` or `nma-studio-cuda`
> (e.g. `pip install -U torch`, or a custom-node wheel with a torch260.cuda126 ABI
> tag) breaks Pascal. See [[hunyuan3d-setup]] for the custom_rasterizer wheel
> incident: an ABI-mismatched `custom_rasterizer-0.1.0+torch260.cuda126` wheel had to
> be replaced with the correct `cp312` build.

---

## 5. Hard-won local lessons (validated on this machine)

1. **Wheel ABI tags must match the interpreter** (`cp312` wheel ⇒ CPython 3.12 env).
   A cp-tag mismatch imports as "invalid distribution" or fails at `import` time.
2. **Import torch FIRST, then custom CUDA ops** — the CUDA runtime DLL load order
   matters for extension modules (custom_rasterizer, spconv-style ops).
3. **pip 26 `--format=freeze` quirk:** can omit/oddly-format entries, which produced
   false "MISSING package" reports during validation. Cross-check with plain
   `pip list` or `pip show <pkg>` before trusting a freeze diff.
4. **PowerShell 5.1 + missing UTF-8 BOM:** non-ASCII characters (em-dashes) in `.ps1`
   files get read as ANSI and can terminate strings / break parsing. Always save
   scripts as UTF-8 **with BOM**.
5. **`"Aomega Imaging"` contains a space** — every path with the user profile must be
   quoted in PowerShell and passed carefully through `cmd /c`.
6. **Always `pip check` after installs** in both project envs; run
   `scripts\check-env-health.ps1` as the fast full-system validation.
7. **PowerShell automatic-variable collisions:** never name a local variable `$home`
   (collides with read-only-ish `$HOME` = user profile; assignment silently keeps the
   automatic value). Same caution for `$host`, `$input`, `$error`, `$args`.
8. **.NET `Regex.Replace` replacement strings treat `$` specially** — `'\$var'` as a
   replacement inserts a literal backslash. For literal find/replace use
   `String.Replace()` (no regex), or `$$` in substitution strings. This produced
   `\$venvHome` corruption in a script that still *parsed* cleanly — always re-run the
   script, don't trust a 0-parse-error result alone.

---

## 6. Environment health validation

One-shot check (decoupling + interpreters + torch CUDA):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-env-health.ps1          # fast
powershell -ExecutionPolicy Bypass -File scripts\check-env-health.ps1 -Torch   # + CUDA matmul test
```

Checks performed:
- `nma-studio-cuda` exists, and its `pyvenv.cfg` `home` points at the **standalone C:
  Python311** (decoupling assertion — fails if it ever gets re-parented).
- Project `venv\` base is also the standalone C: interpreter.
- `comfyui-cuda` exists and `space-analyzer-cuda` is untouched (existence only —
  this project must never modify it).
- Warns if the `pyvenv.cfg` of any project env references a missing base.
- With `-Torch`: imports torch in `nma-studio-cuda`, prints version/CUDA/arch list,
  runs a small GPU matmul.

---

## 7. Related documents

- [[hunyuan3d-setup]] — custom_rasterizer wheel ABI incident & ComfyUI env rules
- [[hardware-verified-models]] — 8 GB VRAM (GTX 1070 Ti) model matrix
- [[backend-debugging-guide]] — service debugging patterns
- `docs/setup/python-environments.md` — project-specific env topology
- `.python-env` — machine-readable env configuration
- Official: https://docs.python.org/3.12/library/venv.html ·
  https://pytorch.org/get-started/previous-versions/

---

_Last updated: 2026-09-07 — cu126 wheel-index live-verification (torch 2.14.0), NVIDIA CUDA 13 deprecation quote, unpinned-pip-breaks-Pascal warning added. Research method: browser-based (Playwright) — direct page reads + live wheel-index DOM extraction; see [[ai-agent-navigation]]._

_Knowledge added via browser research session 2026-09-07._

> 3.12 interpreter on the machine. Do not delete, move, upgrade-in-place, or
> `pip install` into it from this project.

---

## 2. venv mechanics (official docs, python.org 3.12)

Direct quotes from https://docs.python.org/3.12/library/venv.html:

> "A virtual environment is created on top of an existing Python installation,
> known as the virtual environment's **'base' Python**…"

> "This creates the target directory … and places a **`pyvenv.cfg`** file in it with a
> **`home` key pointing to the Python installation from which the command was run**."

> "Not considered as **movable or copyable** – you just recreate the same environment
> in the target location."

> "Considered as **disposable** – it should be simple to delete and recreate it from
> scratch."

Practical consequences:

1. **A venv is a thin pointer, not a container.** Read `pyvenv.cfg` first when
   diagnosing any env: `home = <base>` tells you exactly what breaks if that base dies.
2. **Never copy/move a venv folder** (e.g. D:→C:, or between projects). The
   `Scripts\python.exe` and pip shebangs hard-code absolute paths; it breaks subtly.
3. `python -m venv --upgrade <env>` only re-deploys against the **same base upgraded
   in-place** — it does not retarget a different base. To change base: recreate.
4. `--system-site-packages` venvs (like `moto-vision-venv`) additionally leak every
   package from the base — extra coupling to be aware of.
