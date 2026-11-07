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
| `app/services/cuda/processor.py` | The GPU feature module: spectral analysis (audio), viz FFT, GPU resample — wired, see §3; image preprocessing still unconsumed | Each class carries its own CPU path |
| `tools/lib/audio.py` | Tool-side torch.cuda analysis helpers | — |

## 3. The seam: partially wired, with a fallback that degraded silently

`packages/backend/app/services/cuda/` (`processor.py`, ~590 lines)
holds `CudaAudioAnalyzer`, `CudaImageProcessor`,
`CudaVisualizationFFT`, a GPU resample helper, and module-level
singletons (`cuda_audio`, `cuda_image`, `cuda_viz`), each class
with CUDA and CPU paths. Its wiring is uneven:

- **`CudaAudioAnalyzer` is live.** `audio_analyzer.analyze_with_cuda`
  (behind `/api/audio/analyze-cuda`) and the shared
  `tools/lib/audio.py` both call the `cuda_audio` singleton.
  *(Correction, 2026-11-07: the first version of this section
  called the whole module orphaned — that survey grepped absolute
  import forms and missed the relative `from .cuda import`. The
  audio class was wired all along.)*
- **`CudaVisualizationFFT` was wired 2026-11-07** (see the
  HyperFrames paragraph below) after the changelog archaeology
  the owner pointed at: both it and the image processor date to
  the Sept 2026 CUDA services build-out, built for consumers —
  a live spectrum feed, backend ComfyUI tensor prep — that were
  planned in the upgrades doc but never landed.
- **`CudaImageProcessor` still has no consumer.** A verified
  sweep of every plausible seam found contract mismatches
  everywhere: `image_processor.py` is PIL-image editing,
  `generate_thumbnail.py` renders GLB models, `export_matrix.py`
  is ffmpeg, and ComfyUI ingests image files itself. **Decided
  2026-11-07 (owner): build the consumer** — T-PLT-48 registers
  a prep step on the backend's ComfyUI image-upload path (today
  a raw pass-through at both seams), which is the job the class
  was built for; T-VID-14's control images are its first
  standing demand.

The real defect the survey exposed was subtler than an orphan:
`analyze_with_cuda` used the module only when CUDA was present,
and hand-rolled its own CPU fallback — a 60-point envelope with
**no spectral features at all**. A GPU-less machine therefore got
a degraded, differently-shaped result from the same endpoint,
silently. Meanwhile the analyzer also carried its own inline GPU
resample, duplicating plumbing the CUDA package should own.

**The merge (2026-11-07, at the owner's direction)** collapsed
the seam into one implementation:

- `analyze_with_cuda` now always delegates feature extraction to
  `CudaAudioAnalyzer.analyze()`, which self-dispatches — CUDA when
  available, the full numpy CPU feature set when not. Same dict
  shape on both devices; the degraded fallback survives only as a
  last resort if the CUDA package itself fails to import.
- When the caller's audio is not at the singleton's 22050 Hz, a
  per-call analyzer is built at the real sample rate, so spectral
  frequencies and duration are no longer computed against the
  wrong rate (the endpoint loads audio at its native rate).
- `resample_audio_gpu` moved into the CUDA package as the single
  GPU-resample implementation; the analyzer's copy is now a thin
  delegation under its existing name.

**The viz wiring (2026-11-07, same owner direction)** closed
the FFT class's gap with a discovery: the HyperFrames storyboard
payload's 16 per-frame "bands" were **fabricated** — a decay ramp
off the energy scalar (`energy * (1.0 - band / (bands * 1.6))`),
not spectral data at all. The payload builder now accepts
measured `band_frames`, the `/hyperframes-payload` endpoint
computes them from the audio via the package's new
`track_band_frames` helper (a fresh `CudaVisualizationFFT` driven
across the track at payload fps; GPU when available, CPU
otherwise), and the payload labels itself
`bands_source: "measured"` — the ramp survives only as the
labeled `"synthetic"` fallback when the audio file can't be
loaded. Sandbox-verified: a 60 Hz half vs 8 kHz half synthetic
track produced low-band shares of 0.539 vs 0.019 — the measured
bands genuinely discriminate content, which the ramp never could.

Verified statically + by sandbox CPU tests (full feature dict,
correct frame count and duration at two sample rates; builder
passes measured values through exactly and reproduces the old
ramp exactly in fallback); the GPU path and on-rig endpoint
behavior verify on the reference rig under T-PLT-47.

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
a gap. The gap was that no doc said so — and that §3's seam sat
unexamined. T-PLT-47 owns what remains of §3.
