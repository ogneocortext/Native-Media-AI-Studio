# ACE-Step 1.5 — Hardware-Fit Analysis for GTX 1070 Ti

> **Last Updated:** 2026-09-20
> **Hardware baseline:** GTX 1070 Ti 8 GB VRAM / Ryzen 5 5500 / 32 GB RAM / Windows 11 / Pascal (sm_61)

---

## 1. ACE-Step 1.5 — Requirements

| Requirement | Specification | Notes |
|---|---|---|
| OS | Windows, Linux, macOS | Windows portable package available |
| Python | 3.11–3.12 | ROCm on Windows requires 3.12 |
| GPU | CUDA recommended | Also MPS / ROCm / Intel XPU / CPU |
| VRAM | ≥4 GB (DiT-only mode) | 6-8 GB adds lightweight LM |
| Disk | ~10 GB for core models | |

## 2. GTX 1070 Ti Tier Mapping

The ACE-Step README defines tiers by VRAM:

| VRAM | Tier | DiT model | LM model | Backend | Notes |
|---|---|---|---|---|---|
| ≤6 GB | Tier 1–2 | 2B turbo | None | `pt` | INT8 + full CPU offload |
| **6–8 GB** | **Tier 3** | **2B turbo** | **0.6B** | **`pt`** | INT8 + CPU offload, LM enabled |
| 8–16 GB | Tier 4 | 2B turbo/sft | 0.6B | `vllm` | vllm KV cache too big for ≤8 GB |

GTX 1070 Ti = **Tier 3** (6–8 GB).

## 3. Pascal-Specific Behavior

ACE-Step 1.5 contains a Pascal detection path:

```python
# From acestep/gpu_config.py
if torch.cuda.get_device_capability() < (7, 0):
    lm_backend_restriction = "pt_only"
    recommended_backend = "pt"
```

- **Flash Attention 2**: auto-detected on Ampere+; **falls back to SDPA on Pascal**. This is correct behavior — no manual fix needed.
- **vLLM backend**: restricted on Pascal because its KV cache is too memory-hungry for ≤8 GB.
- **INT8 quantization**: enabled by default on Tier 1–6a.
- **CPU offload**: enabled by default on lower tiers.

## 4. Expected Performance on GTX 1070 Ti

| Component | Expected config | VRAM impact |
|---|---|---|
| DiT | 2B turbo, INT8 quantized | ~3–4 GB |
| LM | 0.6B, `pt` backend | ~1–2 GB |
| CPU offload | Enabled | Saves GPU VRAM, uses system RAM |
| SDPA attention | Math fallback (no FlashAttention on Pascal) | Slightly slower than FA2 |
| VAE decode | GPU tiled → CPU fallback adaptive | ~0.5–1 GB |
| torch.compile | ❌ Disabled (Triton requires sm_70+) | Avoids GPUTooOldForTriton crash |

**Expected peak:** 5–7 GB on an 8 GB card. This is tight but within the documented Tier 3 envelope.

## 5. Environment Variables (Pascal-specific)

```powershell
# Required for Pascal sm_61 JIT kernel targeting
$env:TORCH_CUDA_ARCH_LIST = "6.1"

# Reduce allocator fragmentation on 8GB cards
$env:PYTORCH_CUDA_ALLOC_CONF = "max_split_size_mb:128"

# Triton (torch.compile backend) requires sm >= 7.0
$env:TORCHINDUCTOR_USE_TRITON = "0"
```

These are set automatically by `tools/music-gen/server.py` on startup.

## 6. Recommended Configuration

| Engine | Runnable? | Route |
|---|---|---|
| **ACE-Step 1.5** | ✅ Yes | `tools/music-gen/server.py` with Tier 3 defaults |

**Critical server.py flags for Pascal:**
- `compile_model=False` — torch.compile crashes on sm_61
- `use_flash_attention=False` — auto-falls back to SDPA math
- `offload_to_cpu=True` + `offload_dit_to_cpu=True` — required for 8GB budget
- `quantization="int8"` — essential for weight fit

## 6. Sources

- GitHub `ace-step/ACE-Step-1.5` README, INSTALL.md, GPU_COMPATIBILITY.md
- [[pascal-gpu-optimization-2026|Pascal GPU Optimization 2026]] — detailed sm_61 constraints and environment setup
