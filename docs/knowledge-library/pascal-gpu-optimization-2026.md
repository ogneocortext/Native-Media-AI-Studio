---
tags:
  - performance
  - hardware-pascal
  - hardware-8gb
  - cuda
aliases:
  - Pascal GPU Optimization 2026
  - GTX 1070 Ti Guide
  - sm_61 Constraints
cssclasses:
  - performance-guide
date: 2026-10-19
---

# Pascal GPU Optimization Guide — GTX 1070 Ti / sm_61

> **Last Updated:** 2026-10-19
> **Hardware baseline:** GTX 1070 Ti 8 GB VRAM / Pascal (sm_61) / Windows 11
> **Status:** Active — all recommendations verified against October 2026 toolchain

---

## 1. Pascal Architecture Reality Check

Pascal (sm_61, GP104) predates Tensor Cores and has no native BF16 or TF32. It is the **last consumer architecture supported by modern CUDA toolchains** — CUDA 13.x drops sm_61 entirely, so CUDA 12.x is the floor and ceiling.

| Feature | Pascal (sm_61) | Impact |
|---------|----------------|--------|
| Tensor Cores | ❌ None | No FP16/INT8 matrix acceleration |
| FlashAttention | ❌ Unavailable | SDPA math kernel only |
| torch.compile (Triton) | ❌ Unavailable | Triton requires sm_70+ |
| torch.compile (eager) | ⚠️ Works | Traces but no kernel fusion — not recommended |
| BF16 | ❌ Unavailable | Bitwise-emulated, ~10× slower than FP16 |
| TF32 | ❌ Unavailable | No TF32 units |
| FP16 | ✅ 2× FP32 throughput | Via regular CUDA cores (not tensor cores) |
| INT8 | ✅ Via TorchAO / llama.cpp | Weight-only and dynamic |
| vLLM / SGLang / TGI | ❌ No | Require sm_70+ |
| llama.cpp | ✅ Yes | Build with `-DCMAKE_CUDA_ARCHITECTURES=61` |

**Key insight:** FP16 on Pascal is **not slow** — it runs at 2× FP32 throughput on regular CUDA cores. The limitation is the *absence of Tensor Cores*, not FP16 itself. Use FP16 everywhere precision allows.

---

## 2. Driver Ceiling (Critical)

Pascal has a hard driver ceiling:

| Driver Branch | Pascal Support | Notes |
|---------------|----------------|-------|
| 525.x – 580.x | ✅ Supported | Last branch supporting Pascal |
| 590.x+ | ❌ Dropped | Pascal, Maxwell, Volta all dropped |

**Do not upgrade past 580.x.** If your host moves to 590+, the GTX 1070 Ti becomes unusable for CUDA workloads regardless of software.

**Recommended:** NVIDIA Studio Driver 580.x branch (not Game Ready). Studio drivers are validated for stability on creative/AI workloads.

```powershell
# Check current driver
nvidia-smi --query-gpu=driver_version --format=csv,noheader
```

---

## 3. PyTorch Version Requirements

Official PyTorch wheels ship sm_61 support through **PyTorch 2.5.0** (cu124/cu121). PyTorch 2.5.1+ drops sm_61 from default wheels.

> [!warning] PyTorch 2.5.0 is the Last Pascal Wheel
> From **2.5.1 onward** you must either:
> - Stay on `torch==2.5.0+cu124` indefinitely, or
> - Build PyTorch from source against CUDA 12.2 with `TORCH_CUDA_ARCH_LIST="6.1"` (1–3 hour build, see [[python-environment-management]])

For this project, pin **`torch==2.5.0+cu124`**:

```powershell
# Verify Pascal support
python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.get_device_capability(0))"
# Expected: 2.5.0+cu124, cu124, (6, 1)

# Install Pascal-compatible wheel
pip install torch==2.5.0 torchvision==0.20.0 torchaudio==2.5.0 --index-url https://download.pytorch.org/whl/cu124
```

---

## 4. Environment Variables (Set Before Importing Torch)

```powershell
# Target Pascal compute capability for any JIT kernels
$env:TORCH_CUDA_ARCH_LIST = "6.1"

# Reduce allocator fragmentation on 8GB cards
$env:PYTORCH_CUDA_ALLOC_CONF = "max_split_size_mb:128,expandable_segments:True"

# Disable Triton (required — torch.compile Triton requires sm_70+)
$env:TORCHINDUCTOR_USE_TRITON = "0"

# Persistent cuBLAS/cuBLASLt workspaces (avoids per-op allocation)
$env:TORCH_CUBLAS_WORKSPACE_CACHE = "1"

# TF32 is a no-op on Pascal — explicitly disable to avoid silent fallbacks
$env:NVIDIA_TF32_OVERRIDE = "0"
```

---

## 5. PyTorch Runtime Settings (Apply After Importing Torch)

```python
import torch

# Pascal has no TF32 — disable explicitly
torch.backends.cuda.matmul.allow_tf32 = False
torch.backends.cudnn.allow_tf32 = False

# cuDNN autotuner: benchmark=True picks the best conv kernel for fixed sizes
# Disable if input sizes vary wildly (avoids per-shape autotune overhead)
torch.backends.cudnn.benchmark = True

# Create tensors directly on GPU (avoids host→device copy)
# Bad: torch.randn(1000, 1000).cuda()
# Good: torch.randn(1000, 1000, device="cuda")

# Use FP16 (2× throughput on Pascal regular cores), NOT BF16
dtype = torch.float16
```

---

## 6. Attention Backend Selection

On Pascal, only the **math** SDPA kernel is available. FlashAttention and memory-efficient attention require sm_80+.

```python
import torch

# Force math kernel (auto-selected on Pascal, but be explicit)
with torch.nn.attention.sdpa_kernel(torch.nn.attention.SDPBackend.MATH):
    output = scaled_dot_product_attention(q, k, v)
```

**Never** enable FlashAttention or cuDNN attention on Pascal — runtime failure.

---

## 7. torch.compile on Pascal

`torch.compile()` **does not work** on Pascal with default settings:

```
GPUTooOldForTriton: Found NVIDIA GeForce GTX 1070 Ti which is too old
to be supported by the triton GPU compiler, which requires sm >= 7.0
```

**Safe alternatives:**

- `torch.compile(model, backend="eager")` — traces, no kernel fusion
- `torch.compile(model, backend="aot_eager")` — minimal graph optimization

**Recommendation:** Disable `torch.compile` entirely on Pascal. Tracing overhead outweighs eager-mode benefits on small models.

---

## 8. VRAM Optimization Stack for 8GB Pascal

The desktop display burns ~1.4GB VRAM if driven by the NVIDIA GPU. **The single biggest VRAM win is using the iGPU for display:**

| Optimization | VRAM Saved | Notes |
|--------------|------------|-------|
| iGPU for display (BIOS: Primary Video → igfx) | ~1.4 GB | Most impactful — frees nearly all framebuffer |
| INT8 quantization (TorchAO / llama.cpp) | ~2–4 GB | Weight-only or dynamic |
| CPU offload (DiT / model weights) | 4–5 GB | Between steps |
| CPU offload (VAE) | 0.5–1 GB | VAE decode peaks |
| Tiled VAE decode | Variable | Chunks decoding |
| Batch size = 1 | Required | Batch >1 OOMs on 8GB |
| FlashAttention | ❌ N/A | Pascal unsupported |
| torch.compile | ❌ Disabled | Triton requires sm_70+ |
| TF32 | ❌ N/A | Pascal has no TF32 cores |
| BF16 | ❌ Avoid | Bitwise-emulated, ~10× slower than FP16 |

**VRAM budget for 8GB card (after iGPU display offload):**

| Component | Approx. Size |
|-----------|--------------|
| CUDA context + cuDNN workspace | 400–800 MB |
| Model weights (FP16) | 2–6 GB (model-dependent) |
| Activations (batch=1) | 600 MB–1.5 GB |
| KV cache (LLM) | Variable by context |
| **Free headroom** | **~2–4 GB** |

---

## 9. ACE-Step Tier 3 Configuration (GTX 1070 Ti)

```python
# Server-side overrides for Pascal
config = {
    "device": "cuda:0",
    "use_flash_attention": False,   # Pascal → SDPA math kernel
    "compile_model": False,         # Triton unavailable on sm_61
    "offload_to_cpu": True,         # Required for 8GB budget
    "offload_dit_to_cpu": True,     # Offload DiT when LM runs
    "quantization": "int8",         # Essential for weight fit
    "max_batch_size": 1,            # OOM guard
    "dtype": "float16",             # 2× throughput on Pascal cores
}
```

---

## 10. TorchAO Quantization (INT8 Only)

TorchAO supports INT8 weight-only and INT8 dynamic quantization on Pascal. FP8/MXFP8 require sm_80+ and are **not** available.

```python
from torchao.quantization import Int8WeightOnlyConfig, quantize_
quantize_(model, Int8WeightOnlyConfig())
```

| Config | Memory Reduction | Speed | Pascal? |
|--------|-----------------|-------|---------|
| INT8 weight-only | ~2× | High | ✅ Yes |
| INT8 dynamic (weight + activation) | ~2× | Very High | ✅ Yes |
| FP8 weight-only | ~2× | Very High | ❌ No (sm_80+) |
| MXFP8 dynamic | ~2× | Very High | ❌ No (sm_80+) |

**Recommendation:** Use INT8 weight-only via TorchAO. The ACE-Step `quantization="int8"` config is sufficient for most workloads.

---

## 11. llama.cpp for LLM Inference (Pascal-Optimized)

llama.cpp is the **only maintainable LLM inference path** for Pascal. vLLM, SGLang, and TGI require sm_70+.

```bash
# Build llama.cpp for Pascal against CUDA 12.x
cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=61 -DCUDA_TOOLKIT_ROOT_DIR="/usr/local/cuda-12.2"
cmake --build build --config Release -j
```

**Runtime flags for 8GB:**
- `-ngl 35` (offload as many layers as fit — experiment)
- `-c 4096` (context size — Pascal memory bandwidth makes long context slow)
- `--main-gpu 0`

**Ollama note:** Ollama wraps llama.cpp but hides KV-cache/batch knobs. For Pascal, prefer direct llama.cpp or build Ollama from source with flash attention disabled (see [[ollama-model-ops]]).

---

## 12. Windows-Specific Considerations

| Setting | Effect on Pascal |
|---------|------------------|
| HAGS (Hardware GPU Scheduling) | ❌ No VRAM benefit — scheduling only |
| Browser HW acceleration | ⚠️ Uses shared GPU pool — close tabs before inference |
| Transparency effects | ⚠️ Minimal VRAM impact |
| Driver version | ✅ Use Studio Driver 580.x (590+ drops Pascal) |
| iGPU for display | ✅ ~1.4 GB VRAM freed — highest-impact setting |

---

## 13. Performance Expectations (GTX 1070 Ti, 8GB)

| Operation | Expected Time |
|-----------|---------------|
| Model load (INT8 + CPU offload) | 30–60s |
| LTX-2.3 25f 768×512 | ~210s (~3.5 min) |
| Wan 2.2 5B GGUF 480p 81f | 2–10 min per clip |
| AnimateDiff 512×512 16f | 30–60s |
| VAE decode (tiled) | 5–15s |
| LLM token generation (llama.cpp) | 10–30s |

**Total music video generation:** ~2–5 minutes per 30s audio clip at 8 steps.

---

## 14. Troubleshooting

### "CUDA error: no kernel image is available for execution on the device"

- Cause: PyTorch version dropped Pascal support
- Fix: Stay on `torch==2.5.0+cu124` or build from source with `TORCH_CUDA_ARCH_LIST="6.1"`

### "GPUTooOldForTriton"

- Cause: `torch.compile()` invoked on Pascal
- Fix: Set `compile_model=False` or `backend="eager"`

### OOM during generation

- Cause: Batch size >1 or insufficient CPU offload / iGPU not used for display
- Fix: Enable iGPU for display, set `max_batch_size=1`, enable CPU offload

### Slow inference (>10 min for short clip)

- Cause: Missing INT8 quantization, BF16 emulation, or excessive offload thrashing
- Fix: Verify `quantization="int8"`, `dtype="float16"`, `use_flash_attention=False`

### Driver 590+ breaks CUDA

- Cause: Pascal support dropped in 590+
- Fix: Roll back to 580.x branch Studio Driver

---

## 15. Sources

- NVIDIA Pascal Tuning Guide (docs.nvidia.com/cuda/pdf/Pascal_Tuning_Guide.pdf)
- PyTorch CUDA Environment Variables (docs.pytorch.org, updated Sep 2026)
- eric-cgn/inference-engine — PyTorch 2.5.1 from source for sm_61 (May 2026)
- killollik/obsolete-gpu-ai-lab — Pascal inference engine matrix (2026)
- ndelor.me — Practical Local AI, VRAM budgeting, iGPU display offload (Jan 2026)
- alexanderharte.com — Wan 2.2 on 8GB VRAM with GGUF (Oct 2026)
- lilys.ai — Wan 2.2 GGUF + Lightx2v ComfyUI tutorial (Oct 2026)
- insiderllm.com — Local AI video generation guide (2026)
- [[python-environment-management]] — PyTorch wheel matrix and environment decoupling
- [[video-generation-vram-2026]] — 8GB video model feasibility
- [[ollama-model-ops]] — Ollama model selection and VRAM management
- [[hardware-verified-models]] — 8GB VRAM model matrix

---

## See Also

- [[video-generation-vram-2026]] — Video model VRAM requirements for 8GB
- [[ollama-model-ops]] — Ollama model selection, VRAM budgets, timeout budgets
- [[python-environment-management]] — Python environment selection for Pascal
- [[hardware-verified-models]] — 8GB VRAM model compatibility matrix
