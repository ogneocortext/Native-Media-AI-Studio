---
title: "Backend GPU Compute Layer — As-Built Map & Kernel Verdicts 2026"
date: 2026-11-07
type: synthesis
tags:
  - technical
  - cuda
  - hardware-pascal
  - hardware-8gb
aliases:
  - Backend GPU Compute Layer 2026
cssclasses:
  - technical-guide
---

# Backend GPU Compute Layer — As-Built Map & Kernel Verdicts 2026

> Written 2026-11-07 at the owner's request ("do I have any custom
> CUDA work in the repo?") after a full-repo scan. Companions:
> [[pascal-gpu-optimization-2026]] (PyTorch-on-Pascal settings) and
> [[cuda-pytorch-directx-upgrades-2026]] (library-upgrade research).
> Neither of those maps the layer as it actually stands; this does.

## 1. The headline: no custom kernels, and that's currently right

Repo-wide scan, 2026-11-07: **zero `.cu`/`.cuh` files, zero
kernel-authoring patterns** — no `cpp_extension`/`load_inline`, no
Triton, no numba/cupy/pycuda, no `__global__`/`__device__` anywhere
in the codebase. Every GPU computation the studio runs is a
library's kernel reached through PyTorch: Demucs, faster-whisper,
the embedding/reranker models, and ComfyUI's nodes all ship their
own; the studio's own code only *directs* them.

That is the correct posture today, for a structural reason: the
studio's hot paths are model inference (owned by the model
libraries) and FFT/analysis-class work (owned by torch/cuFFT).
There is no measured hotspot in studio-authored math that a
custom kernel could attack. §6 states what evidence would change
this verdict.

## 2. As-built map: who actually touches the GPU

| Code | What it accelerates | Fallback / notes |
|---|---|---|
| `app/services/audio_analyzer.py` | The live analysis path — `analyze_with_cuda()` behind `/api/audio/analyze-cuda`; tensors placed on `cuda:0` directly | CPU analysis path in the same module |
| `app/services/source_separation.py` | Demucs stem separation on GPU | CPU lane governed by the hardware profile's lane rules |
| `app/services/transcription.py` | faster-whisper on GPU | int8 CPU per the CPU playbook |
| `app/services/retrieval_service.py` | Cross-encoder reranker: device auto-detect, FP16 on GPU, CUDA batch size | CPU device + smaller batch |
| `app/services/comfyui_manager.py` | Manages ComfyUI's GPU use (external process) | — |
| `app/services/vram_manager.py` | **The discipline layer**: coordinates Ollama ↔ ComfyUI VRAM, offloads Ollama models so generation doesn't OOM | — |
| `app/services/vram_monitor.py` | GPU stats via gpustat / pynvml / `torch.cuda` fallback; resident-model detection | Extracted from vram_manager |
| `app/services/cuda/processor.py` | **Nothing — see §3** | — |
| `tools/lib/audio.py` | Tool-side torch.cuda analysis helpers | — |

## 3. The finding: an orphaned GPU module

`packages/backend/app/services/cuda/` (`processor.py`, ~550 lines)
contains a complete, seriously-built GPU acceleration module —
`CudaAudioAnalyzer`, `CudaImageProcessor`, `CudaVisualizationFFT`,
each with CUDA and CPU paths. Its git history shows real
investment (GPU resampling, CPU-fallback spectral features,
torchaudio window fixes).

**Nothing imports it.** Repo-wide, the three classes are
referenced only by their own package `__init__.py`. Meanwhile
`audio_analyzer.py` grew its own parallel CUDA path (§2), which is
the one the API actually serves. The repo therefore carries two
implementations of GPU audio analysis: one live, one orphaned —
and no task item owns the duplication.

Decision framing for T-PLT-47: the burden of proof sits on the
orphan. Either a measurement on a shared fixture shows its paths
beat the live analyzer's (then wire it in and delete the duplicate
logic from the analyzer), or it is removed. What it must not do
is sit a third year as plausible-looking dead weight that future
agents mistake for the live path.

## 4. The kernel ladder on sm_61 — verdicts

If a studio-authored hotspot ever does appear, these are the
rungs, in the order to reach for them:

| Rung | Verdict on Pascal (sm_61) |
|---|---|
| **PyTorch ops** (current) | ✅ The default. cuBLAS/cuFFT/cuDNN through torch cover the studio's math; settings discipline lives in [[pascal-gpu-optimization-2026]] |
| **torch.compile** | ⚠️ Graph capture only: the default Inductor path **fails on Pascal** (`GPUTooOldForTriton … requires sm >= 7.0`); `backend="eager"`/`"aot_eager"` trace without kernel fusion. Not a performance lever here |
| **Triton** (standalone) | ❌ Requires sm_70+. Not available on this GPU, full stop |
| **numba.cuda** | ⚠️ The one JIT route that still targets sm_61 without a C++ toolchain. Viable for a small, self-contained kernel; unproven in this codebase; reach for it only under §6's gate |
| **CUDA C++ via cpp_extension** | ⚠️ Full control, real cost: CUDA toolkit + MSVC on the Windows dev box, a build step in the backend env, and sm_61-specific limits (no tensor cores; consumer-Pascal FP16 runs at 1:64 rate — FP32 is the working precision; INT8 dot-product exists but torch won't route to it automatically). Measured-hotspot gate, §6 |
| **Library upgrades** (cuFFT callbacks, NPP, CUDA Graphs, torchaudio-native features) | ➡️ Researched in [[cuda-pytorch-directx-upgrades-2026]]; several are reachable *through* PyTorch without authoring kernels — exhaust these first |

## 5. VRAM is the real GPU discipline here

On an 8 GB card shared by an LLM server, a diffusion host, and
the backend, the GPU problem this studio actually has is
**arbitration, not arithmetic** — and it is already engineered:
`vram_manager` evicts/offloads between Ollama and ComfyUI, the
hardware profile caps concurrent work by lane, and the CPU
playbook's solo/shared rules keep CPU-heavy stages from colliding
with GPU stages. Any future kernel work inherits those caps; it
does not get its own VRAM.

## 6. Decision triggers — what would reopen the kernel question

All three, not any one:

1. A **profile of a user-visible path** (backend benchmark or
   headed capture) showing a studio-authored torch-op sequence —
   not model inference — taking a material share of the path's
   time or VRAM traffic.
2. A demonstration that the sequence **cannot be restructured**
   into existing library calls (the upgrades doc's list first).
3. A **fixture** the candidate kernel can be measured against,
   before and after, on the reference rig — the repo's
   measure-first rule applies to kernels exactly as to models.

Until then: no custom CUDA work is a finding to be proud of, not
a gap. The gap was that no doc said so — and that §3's module sat
unowned. T-PLT-47 owns §3.
