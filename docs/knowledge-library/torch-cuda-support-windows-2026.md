---
tags:
  - platform
aliases:
  - Torch CUDA Support Windows 2026
cssclasses:
  - platform-guide
date: 2026-11-09
type: concept
---

> [!info] Purpose
> Why Pascal fell off the PyTorch wheel list, what that cost this studio in
> dependency archaeology, and the standing rules that keep it from happening
> again on the next architecture.

---

## Overview

PyTorch ships prebuilt wheels compiled for a list of GPU architectures
("compute capabilities", `sm_XX`). When an architecture leaves the wheel list,
`pip install torch` still succeeds — the install just contains no kernels for
your card, and every CUDA call fails or falls over at runtime. NVIDIA removed
pre-Turing targets from the CUDA toolkit itself (CUDA 13), and PyTorch's
wheels follow CUDA. Pascal (GTX 10-series) crossed that line in 2025–2026:
the last wheel carrying its kernels is the one this studio already found by
accident. The buying rule that follows: **an architecture's value is its
remaining years inside the wheel list, not its benchmark score.**

## The architecture ladder

| Generation | Example cards | Compute capability | Status in current torch wheels (Nov 2026) |
|---|---|---|---|
| Pascal | GTX 1070 Ti (this rig) | sm_61 | **OUT** — last known-good wheel: torch 2.5.0+cu124 (field-verified on this rig, 2026-11-08, F5-TTS env build) |
| Volta | V100, Titan V | sm_70 | OUT — dropped with Pascal |
| Turing | RTX 2070, GTX 1660 | sm_75 | IN — oldest consumer generation still compiled; note the RTX 2070 is 8 GB, so it fails the studio VRAM floor anyway |
| Ampere | RTX 3060 12 GB | sm_86 | IN — but now the **oldest architecture in the list**; next in line for removal, on NVIDIA/PyTorch's unpublished schedule |
| Ada Lovelace | RTX 4060 Ti 16 GB, 4070 Super | sm_89 | IN — comfortable mid-life |
| Hopper | H100 | sm_90 | IN — datacenter |
| Blackwell | RTX 5060 Ti 16 GB, 5070 | sm_120 | IN — current generation; longest runway; needs cu128-class builds |

## What actually happened to this rig (field record)

- The MuseTalk env (`D:\venvs\musetalk`) runs torch **2.0.1+cu118** — old,
  pinned, works.
- The F5-TTS env build (2026-11-08, commit `79c08fec`) first resolved a
  current torch with **no sm_61 kernels** (pip does not warn; the failure
  shows up at first CUDA use). Repinned to **torch 2.5.0+cu124**, the last
  wheel with Pascal support, which also auto-selects fp32 on Pascal
  (fp16/bf16 tensor-core paths assume sm_70+).
- The backend is capped around **CUDA 12.6** behavior by the same ceiling.
- Lesson: on a dropped architecture, dependency resolution becomes
  archaeology — every new env is a manual search for the last compatible
  (torch, CUDA, library) combination, and the combinations get harder to
  find as mirrors age.

## Standing rules for this studio

1. **Never let pip resolve torch freely on the Pascal rig.** Every venv pins
   an exact `torch==X.Y.Z+cuNNN` known to carry sm_61 kernels (2.5.0+cu124
   for new envs; 2.0.1+cu118 where already proven).
2. **One venv per workload is load-bearing, not tidiness.** MuseTalk and
   F5-TTS pinned different torch versions and neither broke the other.
   Keep it that way.
3. **Verify kernels, don't assume them.** After any torch install:
   `python -c "import torch; print(torch.cuda.get_arch_list())"` — the
   card's `sm_XX` must appear in the list before anything else runs.
4. **Upgrade buying rule:** Ada or Blackwell only; 12 GB floor, 16 GB
   preferred. Ampere (3060 12 GB) only at a steep discount with eyes open —
   it is the next architecture scheduled to fall off the wheel list.
5. When the GPU is upgraded, the pin rules above retire: current torch plus
   current CUDA become installable again, and this document becomes history
   instead of law.

## Related

- [[ryzen-5500-cpu-playbook-2026]]:see-also — §7 upgrade math for this platform (PCIe 3.0 ceiling, VRAM-first judging)
- [[pascal-gpu-optimization-2026]]:see-also — working within Pascal while it remains the rig's card
- [[backend-gpu-compute-layer-2026]]:see-also — how the studio's GPU compute is layered on library kernels
