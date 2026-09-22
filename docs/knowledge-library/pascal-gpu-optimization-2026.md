# Pascal GPU Optimization Guide — GTX 1070 Ti / sm_61

> **Last Updated:** 2026-09-20
> **Hardware baseline:** GTX 1070 Ti 8 GB VRAM / Ryzen 5 5500 / 32 GB RAM / Windows 11 / Pascal (sm_61)

---

## 1. Pascal Architecture Constraints

|| Feature | Pascal (sm_61) | Impact |
|| ---------------------- | -------------- | -------------------------------- |
|| Tensor Cores | ❌ None | No FP16/INT8 matrix acceleration |
|| FlashAttention | ❌ Unavailable | Falls back to SDPA math kernel |
|| cuDNN attention | ❌ Unavailable | Requires sm_80+ |
|| torch.compile (Triton) | ❌ Unavailable | Triton requires sm_70+ |
|| torch.compile (eager) | ✅ Works | No kernel fusion, but no crash |
|| BF16 | ❌ Unavailable | Must use FP16/FP32 or INT8 |
|| vLLM backend | ❌ Restricted | KV cache too large for ≤8 GB |

## 2. PyTorch Version Requirements

**Critical:** Pascal is supported through CUDA 12.6 / PyTorch 2.14.0 (the Pascal capstone).

> [!warning] PyTorch 2.14 is the Last Pascal Wheel
> PyTorch **2.14** is the **final release** with prebuilt `cu126` wheels supporting
> Maxwell / Pascal / Volta (sm_50–sm_70). From **2.15 onward** you must either:
>
> - Stay on 2.14 indefinitely, or
> - Build PyTorch from source against CUDA 12.6 with `TORCH_CUDA_ARCH_LIST="6.1"`.
>
> For this project, see [[python-environment-management]] for environment details.

|| PyTorch version | CUDA | Pascal support |
|| --------------- | ----- | --------------------------------------- |
|| 2.14.0 | 12.6 | ✅ Pascal capstone (final) |
|| 2.15+ | 12.6+ | ❌ sm_61 dropped from default wheels |

```powershell
# Verify Pascal support
python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.get_device_capability(0))"
# Expected: 2.14.0+cu126, (6, 1)
```

## 3. Environment Variables

Set these **before** importing torch or any ML framework:

```powershell
# Target Pascal compute capability for any JIT kernels
$env:TORCH_CUDA_ARCH_LIST = "6.1"

# Reduce allocator fragmentation on 8GB cards
$env:PYTORCH_CUDA_ALLOC_CONF = "max_split_size_mb:128"

# Disable Triton (required for torch.compile on Pascal)
$env:TORCHINDUCTOR_USE_TRITON = "0"
```

## 4. Attention Backend Selection

On Pascal, only the **math** SDPA kernel is available. FlashAttention and memory-efficient attention are unavailable.

```python
import torch

# Force math kernel (usually auto-selected on Pascal)
with torch.nn.attention.sdpa_kernel(torch.nn.attention.SDPBackend.MATH):
    # attention computation here
    pass
```

**Do not** attempt to enable FlashAttention or cuDNN attention on Pascal — they will fail at runtime.

## 5. torch.compile on Pascal

`torch.compile()` **does not work** on Pascal with default settings:

```
GPUTooOldForTriton: Found NVIDIA GeForce GTX 1070 Ti which is too old
to be supported by the triton GPU compiler, which requires sm >= 7.0
```

**Safe alternatives:**

- `torch.compile(model, backend="eager")` — traces but no kernel fusion
- `torch.compile(model, backend="aot_eager")` — minimal graph optimization

**Recommendation:** Disable `torch.compile` entirely on Pascal. The overhead of tracing outweighs any eager-mode benefits on small models.

## 6. VRAM Optimization Stack for 8GB Pascal

|| Optimization | Status | Reason |
|| ----------------- | ----------- | ---------------------------------- |
|| INT8 quantization | ✅ Required | Saves ~50% VRAM vs FP16 |
|| CPU offload (DiT) | ✅ Required | Frees 4-5 GB between steps |
|| CPU offload (VAE) | ✅ Required | VAE decode peaks at 0.5-1 GB |
|| Tiled VAE decode | ✅ Required | Chunks decoding to stay under VRAM |
|| Batch size = 1 | ✅ Required | Any batch >1 OOMs on 8GB |
|| FlashAttention | ❌ N/A | Pascal unsupported |
|| torch.compile | ❌ Disabled | Triton requires sm_70+ |
|| TF32 matmul | ❌ N/A | Pascal has no TF32 cores |

## 7. ACE-Step Tier 3 Configuration (GTX 1070 Ti)

```python
# Server-side overrides for Pascal
config = {
    "device": "auto",               # CUDA:0
    "use_flash_attention": False,   # Pascal fallback to SDPA math
    "compile_model": False,         # Triton unavailable on sm_61
    "offload_to_cpu": True,         # Required for 8GB budget
    "offload_dit_to_cpu": True,     # Offload DiT when LM runs
    "quantization": "int8",         # Essential for weight fit
    "max_batch_size": 1,            # OOM guard
}
```

## 8. Windows-Specific Considerations

|| Setting | Effect on Pascal |
|| ------------------------------ | ------------------------------------------------- |
|| HAGS (Hardware GPU Scheduling) | ❌ No VRAM benefit — scheduling only |
|| Transparency effects | ❌ Uses shared GPU pool, not dedicated VRAM |
|| Page file size | ❌ Backs system RAM, not VRAM |
|| Browser HW acceleration | ⚠️ Uses shared pool — close tabs before inference |
|| Driver version | ✅ Use NVIDIA Studio Driver, not Game Ready |

## 9. Performance Expectations

|| Operation | Expected time (GTX 1070 Ti) |
|| ------------------- | --------------------------------- |
|| Model load | 30-60s (INT8 quant + CPU offload) |
|| Inference (4 steps) | 60-120s per generation |
|| Inference (8 steps) | 120-240s per generation |
|| VAE decode | 5-15s |
|| LM token generation | 10-30s |

**Total generation time:** ~2-5 minutes for a 30s audio clip at 8 steps.

## 10. Troubleshooting

### "CUDA error: no kernel image is available for execution on the device"

- Cause: PyTorch version dropped Pascal support
- Fix: Stay on `torch==2.14.0+cu126` (Pascal capstone)

### "GPUTooOldForTriton"

- Cause: `torch.compile()` invoked on Pascal
- Fix: Set `compile_model=False` or `backend="eager"`

### OOM during generation

- Cause: Batch size >1 or insufficient CPU offload
- Fix: Ensure `offload_dit_to_cpu=True` and `max_batch_size=1`

### Slow inference (>10 min)

- Cause: Missing INT8 quantization or excessive offload thrashing
- Fix: Verify `quantization="int8"` and `use_flash_attention=False`

## 11. TorchAO Quantization (INT8 Only)

TorchAO 0.17 (March 2026) supports INT8 weight-only and INT8 dynamic quantization on Pascal. FP8/MXFP8 require sm_80+ and are **not** available on the GTX 1070 Ti.

```python
# INT8 weight-only — viable on Pascal
from torchao.quantization import Int8WeightOnlyConfig, quantize_
quantize_(model, Int8WeightOnlyConfig())
```

| Config | Memory Reduction | Speed | Accuracy | Pascal? |
|--------|-----------------|-------|----------|---------|
| INT8 weight-only | ~2× | High | Better | ✅ Yes |
| INT8 dynamic activation + weight | ~2× | Very High | Good | ✅ Yes |
| FP8 weight-only | ~2× | Very High | Excellent | ❌ No (sm_80+) |
| MXFP8 dynamic | ~2× | Very High | Excellent | ❌ No (sm_80+) |
| INT4 | ~4× | High | Model-dependent | ⚠️ Experimental on Pascal |

**Recommendation:** Use INT8 weight-only via TorchAO if ACE-Step's internal INT8 path proves unstable. Otherwise, the current `quantization="int8"` in ACE-Step Tier 3 config is sufficient.

## 12. Sources

- PyTorch 2.0 Accelerated Generative Diffusion Models blog
- PyTorch SDPA tutorial (docs.pytorch.org)
- willitrunai.com GTX 1070 Ti compatibility matrix
- GitHub: ComfyUI issue #9705 (Pascal PyTorch compatibility)
- ACE-Step 1.5 `gpu_config.py` tier definitions
- [[python-environment-management]] — PyTorch 2.14 cu126 wheel matrix and environment decoupling
- [[3d-generation-options-2026]] — 3D generation options for 8GB VRAM
- [[hardware-verified-models]] — 8GB VRAM model matrix
