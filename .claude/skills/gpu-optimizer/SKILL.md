---
name: gpu-optimizer
description: >-
  Optimize a Pascal (sm_61) GPU — GTX 1070 Ti — for maximum AI inference
  speed on 8 GB VRAM. Detects the GPU, checks the driver ceiling, applies
  PyTorch Pascal runtime settings, and reports VRAM/optimization status.
  Based on docs/knowledge-library/pascal-gpu-optimization-2026.md (October
  2026 research).
---

# GPU Optimizer — Pascal (GTX 1070 Ti / sm_61)

Use this skill when you need to optimize a Pascal GPU for AI workloads.
It covers driver constraints, PyTorch version pinning, runtime settings,
VRAM optimization, and quantization strategy.

## When to use

- A GTX 1070 Ti (or any Pascal sm_61 card) is the primary GPU
- AI inference (ComfyUI, ACE-Step, llama.cpp, Ollama) is slow or OOMing
- You need to verify the GPU is configured correctly before generation
- You want to apply Pascal-specific PyTorch settings programmatically

## The Pascal Reality (October 2026)

| Constraint | Detail | Impact |
|------------|--------|--------|
| No Tensor Cores | sm_61 predates them | No FP16/INT8 matrix acceleration |
| No FlashAttention | Requires sm_80+ | SDPA math kernel only |
| No torch.compile (Triton) | Requires sm_70+ | Disable, use eager backend only |
| No BF16 / TF32 | Not in hardware | Use FP16 (2x FP32 on regular cores) |
| Driver ceiling | 580.x last for Pascal | 590+ drops Pascal entirely |
| PyTorch ceiling | 2.5.0+cu124 last wheel | 2.5.1+ drops sm_61 from wheels |

**Key insight:** FP16 on Pascal is **not slow** — it runs at 2× FP32 throughput
on regular CUDA cores. The limitation is the absence of Tensor Cores, not
FP16 itself.

## The Optimization Module

**`tools/gpu_optimizer.py`** — import-safe module that detects and optimizes
Pascal GPUs.

### CLI

```powershell
python tools/gpu_optimizer.py
```

Outputs a GPU status report and applies Pascal optimizations if torch is
available. Exits non-zero if the driver exceeds the Pascal ceiling.

### Python API

```python
from tools.gpu_optimizer import detect_gpu, optimize_for_pascal, report_gpu_status

# Just inspect
info = detect_gpu()
print(info.name, info.compute_capability, info.is_pascal)

# Apply optimizations (safe without torch)
report = optimize_for_pascal()
for w in report.warnings: print(f"WARN: {w}")
for e in report.errors:   print(f"ERROR: {e}")

# Full status report
print(report_gpu_status())
```

## What the Optimizer Does

1. **Detects GPU** via nvidia-smi (name, driver, VRAM, compute capability)
2. **Checks driver ceiling** — errors if driver > 580.x (Pascal dropped in 590+)
3. **Detects torch** lazily — import-safe without torch installed
4. **Applies Pascal runtime settings:**
   - Disables TF32 (no TF32 units on Pascal)
   - Enables cuDNN benchmark autotuner
   - Recommends `torch.float16` dtype (2× FP32 throughput)
   - Disables torch.compile (Triton requires sm_70+)
   - Avoids BF16 (bitwise-emulated, ~10× slower)

## VRAM Optimization for 8GB

The single biggest VRAM win is **using the iGPU for display** (BIOS: Primary
Video Device → igfx). This frees ~1.4 GB of VRAM that the desktop burns.

| Optimization | VRAM Saved | Priority |
|--------------|------------|----------|
| iGPU for display | ~1.4 GB | Critical |
| INT8 quantization | ~2–4 GB | High |
| CPU offload (DiT/model) | 4–5 GB | High |
| CPU offload (VAE) | 0.5–1 GB | Medium |
| Tiled VAE decode | Variable | Medium |
| Batch size = 1 | Required | Critical |

## Driver Management

**Do not upgrade past NVIDIA driver 580.x.** Driver 590+ drops Pascal,
Maxwell, and Volta support. Use the Studio Driver 580.x branch.

```powershell
# Check current driver
nvidia-smi --query-gpu=driver_version --format=csv,noheader

# If > 580.x, roll back to 580.x Studio Driver
```

## PyTorch Installation for Pascal

Pin `torch==2.5.0+cu124` — the last wheel with sm_61 support:

```powershell
pip install torch==2.5.0 torchvision==0.20.0 torchaudio==2.5.0 --index-url https://download.pytorch.org/whl/cu124
```

From 2.5.1 onward, build from source with `TORCH_CUDA_ARCH_LIST="6.1"`.

## LLM Inference on Pascal

**llama.cpp is the only maintainable path.** vLLM, SGLang, and TGI require
sm_70+. Build llama.cpp:

```bash
cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=61
cmake --build build --config Release -j
```

Runtime flags for 8GB: `-ngl 35` (layers on GPU), `-c 4096` (context).

Ollama wraps llama.cpp but hides KV-cache/batch knobs — prefer direct
llama.cpp or build Ollama from source with flash attention disabled.

## Related Documentation

- [[pascal-gpu-optimization-2026]] — Full Pascal optimization guide
- [[video-generation-vram-2026]] — 8GB video model feasibility
- [[ollama-model-ops]] — Ollama model selection and VRAM budgets
- [[python-environment-management]] — Python environment selection

## Verification

Run the optimizer CLI and confirm:
- GPU detected as GTX 1070 Ti / sm_61
- Driver at or below 580.x
- Torch 2.5.0+cu124 (or 2.14+cu126 per existing doc)
- No errors reported by `optimize_for_pascal()`
