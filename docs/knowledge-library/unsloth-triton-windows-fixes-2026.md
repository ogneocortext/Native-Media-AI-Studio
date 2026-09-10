# Unsloth Triton Windows Fixes & Cross-Entropy Replacement

> **Collected:** 2026-09-09 — **Updated Sep 09 2026** for Unsloth 2026.8.6 + Gemma 4 fixes
> **Hardware target:** Ryzen 5 5500, GTX 1070 Ti 8 GB (CUDA compute 6.1), 32 GB RAM, Windows 10 22H2 — **8GB ceiling; E4B (10GB) not local**
> **Current stack:** PyTorch 2.14.0+cu126 (Sep 2026: last Pascal wheel; 2.12→2.14 update), Unsloth **2026.8.6** (`unsloth-zoo 2026.8.5`), CUDA Toolkit 12.6, MSVC 14.51.36231 (VS 2022 BuildTools)

---

## 1. Triton on Windows — MSVC Detection Bug (Root Cause)

### Symptom
```
TypeError: unsupported operand type(s) for /: 'WindowsPath' and 'NoneType'
  File ".../triton/windows_utils.py", line ..., in find_msvc_env
```

### Why it happens
Triton’s `find_msvc_env()` in `triton/windows_utils.py` calls `find_msvc_winsdk(env_only=True)` which only succeeds **inside a VS Developer Command Prompt**. When run from a plain terminal (even after `vcvars64.bat`), `env_only=True` can return `None` for VS 2022 BuildTools because the environment variable check fails even though MSVC is installed.

### Relevant upstream issues
| Issue | Summary |
|-------|---------|
| [triton-windows#17](https://github.com/triton-lang/triton-windows/issues/17) | `get_cc()` falls back to bundled TinyCC when MSVC env vars not detected; fix proposed: pass `env_only=False` to `find_msvc_winsdk()` |
| [triton-windows#106](https://github.com/woct0rdho/triton-windows/issues/106) | VS2022 Developer PowerShell env vars (`VCINSTALLDIR`, `WindowsSdkDir`) not respected |
| [triton-windows#52](https://github.com/woct0rdho/triton-windows/pull/52) | Build Tools alone do NOT work — full VS 2022 (Community/Professional/Enterprise) is required for JIT compilation |
| [triton-windows#129](https://github.com/woct0rdho/triton-windows/issues/129) | Setting `CC` env var overrides `vcvars64.bat`; if `CC` points to wrong path after MSVC update, compilation breaks |

### Key insight: `CC` variable precedence
> "When triton-windows tries to find a C compiler, the precedence of `CC` is higher than `vcvars64.bat`." — triton-windows maintainer

If `CC` is set to a stale path (e.g. `14.43.34808` after updating to `14.44.35207`), Triton fails even if `vcvars64.bat` succeeds. **Solution:** ensure `CC` is either unset or points to the current `cl.exe`.

### VS 2026 / numeric directory issue
> "VS 2026 uses a numeric directory (`\18\`) rather than a year-based name (`\2022\`), which may also affect `find_msvc_hardcoded`'s glob pattern."

Our installed MSVC lives under:
```
C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.51.36231\
```
Triton’s hardcoded path globs may miss `\18\` because they search for `\2022\` or `\2025\`.

### Workarounds (choose one)

| # | Workaround | Notes |
|---|-----------|-------|
| 1 | Call `vcvars64.bat` **before** Python | Sets `VCINSTALLDIR`, `WindowsSdkDir`, `VCToolsVersion` in env |
| 2 | Unset `CC` or set it to current `cl.exe` | `CC` overrides `vcvars64.bat` |
| 3 | Set `UNSLOTH_DISABLE_CUSTOM_KERNELS=1` | Skips Triton entirely for Unsloth kernels (loss falls back to PyTorch) |
| 4 | Monkey-patch `fast_cross_entropy_loss` | Replace Unsloth’s Triton CE with `torch.nn.functional.cross_entropy` |

---

## 2. Why `cut_cross_entropy` Won’t Help Our GPU

From `unsloth_zoo/loss_utils.py`:
```python
if DEVICE_TYPE == "cuda":
    major, minor = torch.cuda.get_device_capability()
    if (Version(torch.__version__) >= Version("2.4.0")) and \
       (not ((major <= 7) and (minor < 5))) and \
       (not (Version(triton_version) < Version("3.0.0"))):
        try:
            from cut_cross_entropy import linear_cross_entropy
            HAS_CUT_CROSS_ENTROPY = True
        except:
            HAS_CUT_CROSS_ENTROPY = False
```

**Condition:** `(major <= 7 and minor < 5)` → requires compute capability **>= 7.5**.

Our GTX 1070 Ti is **compute capability 6.1**. This means `cut_cross_entropy` is **never available** on this GPU regardless of PyTorch/Triton versions. The only path is PyTorch’s native `F.cross_entropy` or a custom C++/CUDA kernel.

---

## 3. GTX 1070 Ti Performance Realities (Pascal / CC 6.1)

### What the benchmarks say
From NVIDIA/apex#76 and CUDA programming guide:
- **FP16 throughput on CC 6.1 (GTX):** 1/128th of FP32 throughput (terrible)
- **Tensor cores:** None (Volta+ only)
- **Mixed-precision training** still helps for **memory bandwidth** (smaller tensors = less DRAM traffic), but actual math runs in FP32
- **Register pressure** is the limiting factor — keep shared memory usage moderate

### PyTorch 2.12 cu126 wheel compatibility
```
PYTORCH_RELEASES_CODE_CC = {
    "12.6": {50, 60, 70, 80, 86, 90},   # ✅ includes 61 (GTX 1070 Ti)
    "12.8": {70, 80, 86, 90, 100, 120},  # ❌ drops 6.x
    "13.0": {75, 80, 86, 90, 100, 110, 120}, # ❌ drops 6.x
}
```

**We must stay on cu126 wheels.** cu128 and cu130 dropped Pascal support.

### VRAM budget for Phi-4 Mini (3.8B params) 4-bit QLoRA
| Component | Approx VRAM |
|-----------|-------------|
| Base model (4-bit) | ~2.5 GB |
| LoRA adapters | ~100 MB |
| Optimizer states (AdamW 4-bit) | ~1.2 GB |
| Activations (seq=1024, batch=4) | ~1.0–1.5 GB |
| **Total** | **~5.0–6.5 GB** |

Safe headroom with 8 GB VRAM = keep batch_size ≤ 4, seq_len ≤ 1024, gradient checkpointing enabled.

---

## 4. Option A — Python Patch: Replace Triton CE with PyTorch Native

### Strategy
Monkey-patch Unsloth’s `fast_cross_entropy_loss` and `patch_loss_functions` to use `torch.nn.functional.cross_entropy` directly, bypassing Triton entirely. This is the fastest path to working eval hooks.

### Implementation approach

**Option A1 — Environment variable (simplest):**
```python
import os
os.environ["UNSLOTH_DISABLE_CUSTOM_KERNELS"] = "1"  # Set before importing unsloth
```

**Option A2 — Direct monkey-patch (more reliable):**
```python
import torch
import torch.nn.functional as F
from unsloth.kernels.cross_entropy_loss import fast_cross_entropy_loss

def safe_cross_entropy(logits, labels, n_items=None, **kwargs):
    """Drop-in replacement that uses PyTorch native CE."""
    batch, seq_len, d = logits.shape
    loss = F.cross_entropy(
        logits.view(batch * seq_len, d),
        labels.view(-1),
        ignore_index=-100,
        reduction="mean" if n_items is None else "sum",
    )
    if n_items is not None and torch.is_tensor(n_items):
        n_items = n_items.to(loss.device)
        loss = loss / n_items
    return loss

# Replace Unsloth's Triton-based loss BEFORE model loading
fast_cross_entropy_loss = safe_cross_entropy
```

**Option A3 — Patch transformers LOSS_MAPPING directly:**
```python
import transformers.loss.loss_utils as _lu
_lu.LOSS_MAPPING["ForCausalLM"] = safe_cross_entropy
```

### Expected performance impact on GTX 1070 Ti
| Metric | Triton (broken) | PyTorch native CE |
|--------|-----------------|-------------------|
| Peak VRAM during loss | ~6.5 GB | ~6.8 GB (+300 MB, full softmax materialized) |
| Step time (phi-4-mini, seq=1024) | N/A (crashes) | ~1.2–1.8× slower than Triton would be |
| Correctness | — | Bitwise identical for standard CE |

The memory increase is acceptable because:
- Our seq_len=1024, vocab=32,768 → logits matrix is only ~128 MB
- 8 GB VRAM has headroom
- The loss is not the training bottleneck on a small model

---

## 5. Option B — C++/CUDA Cross-Entropy Kernel via `torch.utils.cpp_extension`

### When to use Option B
- Option A works but you want the VRAM savings back
- You want to own the kernel and can rebuild it when MSVC paths change
- You’re comfortable with CUDA C++ and Windows build tooling

### Hardware-appropriate design for GTX 1070 Ti (sm_61)

**Constraints:**
- No Tensor Cores → no WMMA / `mma.sync` instructions
- FP16 throughput terrible → keep everything in FP32
- 8 GB VRAM → kernel must be memory-efficient but not over-optimized for HPC
- CUDA 12.6 → supports sm_61 fully

**Recommended kernel approach:**
- Block size: 128 or 256 threads (fits 1070 Ti SM occupancy)
- Shared memory: ≤ 16 KB per block (conservative for 48 KB SM limit)
- One-row-per-block: each CUDA block processes one `(seq_len, vocab_size)` row
- For Phi-4 vocab (32K): 128 threads × 256 elements = process 32,768 in ~256 iterations
- Forward + backward fused in one kernel (like Unsloth’s Triton version)

### Build system requirements
1. Must run from `run_train_with_msvc.bat` context (or manually call `vcvars64.bat`)
2. `CC` must be unset or point to current `cl.exe`
3. `CUDA_HOME` must point to CUDA 12.6 toolkit
4. Set `TORCH_CUDA_ARCH_LIST=6.1` to target only sm_61

### File structure
```
D:\unsloth-studio\studio_finetune\
├── custom_ce\
│   ├── __init__.py
│   ├── setup.py          # build script
│   ├── cross_entropy_kernel.cu   # CUDA kernel
│   └── cross_entropy_kernel.cpp  # pybind11 bindings
```

### Minimal `setup.py` (Windows-safe)
```python
import os
import torch
from torch.utils.cpp_extension import CUDAExtension, BuildExtension

os.environ.setdefault("TORCH_CUDA_ARCH_LIST", "6.1")

setup(
    name="custom_ce",
    ext_modules=[
        CUDAExtension(
            name="custom_ce._C",
            sources=[
                "cross_entropy_kernel.cpp",
                "cross_entropy_kernel.cu",
            ],
            extra_compile_args={
                "cxx": ["/O2", "/std:c++17"],
                "nvcc": ["-O3", "--use_fast_math",
                         "-gencode=arch=compute_61,code=sm_61",
                         "-Xcompiler=/O2"],
            },
        )
    ],
    cmdclass={"build_ext": BuildExtension},
)
```

### CUDA kernel outline (`cross_entropy_kernel.cu`)
```cuda
// Forward: compute logsumexp and cross-entropy loss per row
// Uses warp shuffle for reduction (sm_61 supports shuffle down)
// Avoids atomic operations — one block per row

template <int BLOCK_SIZE>
__global__ void cross_entropy_forward_kernel(
    const half* __restrict__ logits,    // (n_rows, vocab) in bf16
    const int* __restrict__ labels,     // (n_rows,)
    float* __restrict__ losses,         // (n_rows,)
    float* __restrict__ logsumexp,      // (n_rows,)
    int n_rows,
    int vocab_size
) {
    // ... block-level reduction, logsumexp, gather label score
}

// Backward: dlogits = softmax(logits) - one_hot(labels)
// Computed in-place or as separate output
```

### Integration into `train.py`
```python
# After patch from Option A2:
import custom_ce
# Replace safe_cross_entropy with:
loss = custom_ce._C.fused_cross_entropy_forward_backward(
    logits.view(-1, vocab_size),
    labels.view(-1),
    n_items=n_items,
)
```

### Build command (inside `run_train_with_msvc.bat` context)
```batch
cd /d D:\unsloth-studio\studio_finetune\custom_ce
python setup.py build_ext --inplace
```

### Expected performance on GTX 1070 Ti
| Metric | PyTorch native CE | Custom C++/CUDA kernel |
|--------|-------------------|------------------------|
| Peak VRAM | ~6.8 GB | ~5.5–6.0 GB (no full softmax materialization) |
| Step time (phi-4-mini, seq=1024) | ~1.2–1.8× baseline | ~1.0–1.3× baseline (approaches Triton speed) |
| Build complexity | None | Requires MSVC + CUDA toolkit + rebuild on path changes |
| Maintenance | None | Must rebuild when PyTorch/Unsloth changes internals |

---

## 6. Decision Matrix for Our Hardware

| Factor | Option A (Python) | Option B (C++/CUDA) |
|--------|-------------------|---------------------|
| Time to working eval | ~15 minutes | ~2–4 hours |
| VRAM efficiency | Moderate loss | High efficiency |
| Step time impact | +20–80% | ~0–30% |
| Maintenance burden | None | Rebuild on MSVC/PyTorch changes |
| Windows fragility | Low | Medium (MSVC path issues) |
| Risk of breaking training | Very low | Low–Medium |

**Recommended sequence:**
1. **Implement Option A1 first** — if it works and step time is acceptable, done.
2. **Only if VRAM or speed is unacceptable**, implement Option B.

---

## 7. Important Version Pins & Compatibility (Sep 2026 — 8GB Pascal-safe)

| Package | Version | Notes |
|---------|---------|-------|
| PyTorch | `2.14.0+cu126` | **Last Pascal JIT wheel** — cu128/cu130 drop CC 6.1; 2.14 is Sep 2026 current. Keep Torch <2.15 |
| Triton | bundled with Unsloth | Broken on our MSVC config — always use `UNSLOTH_DISABLE_CUSTOM_KERNELS=1` |
| Unsloth | `>=2026.8.6` (`unsloth-zoo>=2026.8.5`) | **Sep 2026 fixes**: grad-accum loss inflation (100-300→10-15), Gemma 4 `use_cache=False` gibberish, audio fp16 overflow |
| Transformers | `>=4.52` | Required for Gemma 4 `transformers#45242` fix |
| CUDA Toolkit | `12.6.x` | Must match PyTorch cu126 wheel |
| MSVC | `14.51.36231` (VS 2022 BuildTools) | Installed; `vcvars64.bat` works |
| Python | `3.11.x` | Venv at `D:\unsloth-studio` |

### Sep 2026 Gemma 4 bug fixes included in 2026.8.6
- **Grad accumulation inflated loss**: `b1/g16`, `b2/g8`, etc. with same effective batch gave divergent losses. Fixed — E2B/E4B expected loss is **13-15** (vision 2×), not 100-300.
- **`use_cache=False` gibberish** for E2B/E4B (`num_kv_shared_layers` 20/18): training forced `use_cache=False` via `gradient_checkpointing=True`, corrupting KV-shared attention. Fixed — now bit-exact parity.
- **Audio float16 overflow**: `attention_invalid_logits_value=-1e9` overflows fp16 max 65504. Fixed.
- **Phi-4 mini bug-fixed repos**: Use `unsloth/Phi-4-mini-instruct-unsloth-bnb-4bit` (fixes: padding/EOS same, extra EOS in chat template, EOS `<|end|>` not `<|endoftext|>`, `unk_token`).

### VRAM re-check for Gemma 4 (Sep 2026, 8GB-capped)
| Model | Q4 Weight | Training VRAM (QLoRA) | Fits 8GB? |
|-------|-----------|----------------------|-----------|
| Gemma 4 E2B | ~2.9GB | 8GB | ✅ **Yes — primary for GTX 1070 Ti** |
| Gemma 4 E4B | ~4.5GB | **10GB** | ❌ No — cloud/A40 only |
| Phi-4 mini | ~2.5GB | ~5-6.5GB | ✅ Yes — fallback |

---

## 8. Source References (Updated Sep 2026)

- [unsloth/kernels/cross_entropy_loss.py](https://github.com/unslothai/unsloth/blob/6f443b5c/unsloth/kernels/cross_entropy_loss.py) — Triton CE kernel source
- [unsloth_zoo/loss_utils.py](https://github.com/unslothai/unsloth-zoo/blob/e51e325f/unsloth_zoo/loss_utils.py) — `HAS_CUT_CROSS_ENTROPY` gating logic
- [PyTorch 2.14 Release](https://github.com/pytorch/pytorch/releases/tag/v2.14.0) — last Pascal `cu126` wheel; 2.15+ drops 6.1
- [Unsloth Gemma 4 train](https://unsloth.ai/docs/models/gemma-4/train) — E2B 8GB / E4B 10GB, grad-accum + `use_cache` + audio fixes (Jul 18 2026)
- [Unsloth gradient blog](https://unsloth.ai/blog/gradient) — gradient accumulation bug fix
- [Gemma 4 Discussion #4921](https://github.com/unslothai/unsloth/discussions/4921) — Gemma 4 fixes (Apr 2026)
- [Phi-4 bug fixes](https://huggingface.co/unsloth/Phi-4-mini-instruct) — padding/EOS/`unk_token` fixes
- [triton-windows#17](https://github.com/triton-lang/triton-windows/issues/17) — MSVC fallback to TCC
- [triton-windows#129](https://github.com/woct0rdho/triton-windows/issues/129) — `CC` env var precedence bug
- [PyTorch docs — Custom C++/CUDA Operators](http://docs.pytorch.org/tutorials/advanced/cpp_custom_ops.html)
- [triton-windows#52](https://github.com/woct0rdho/triton-windows/pull/52) — Build Tools don’t work, VS 2022 does
- [Unsloth Studio](https://unsloth.ai/docs/new/studio.md) — Aug 2026 launch, Windows `install.ps1`
