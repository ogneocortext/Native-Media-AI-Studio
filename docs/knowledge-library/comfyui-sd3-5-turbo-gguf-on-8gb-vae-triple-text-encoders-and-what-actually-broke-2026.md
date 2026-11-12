---
tags:
  - technical
  - comfyui
  - vram
aliases:
  - SD3.5 turbo ComfyUI
  - GGUF VAE mismatch
  - TripleCLIPLoader
  - ModelSamplingSD3
  - sd3_vae
cssclasses:
  - technical-guide
date: 2026-11-12
type: concept
---

> [!info] Purpose
> ComfyUI SD3.5 Turbo GGUF on 8GB: VAE, triple text encoders, and what actually broke — purpose of this document.

---

## Overview

Session 2026-11-11: ran `sd3.5_large_turbo-Q4_0.gguf` (city96 GGUF, 4.44 GB)
through ComfyUI 0.44 on the GTX 1070 Ti (8 GB) and found **three stacked
defects**, only the first of which was visible as an error. Sampling itself
was never the problem — 4 steps at 1024² took ~24 s cold.

### Defect 1 — wrong-channel VAE (hard error)

`gguf_test_workflow_api_v4.json` decoded with `sdxl_vae.safetensors`
(4-channel SDXL VAE). SD3.5 latents are 16-channel, so `VAEDecode` throws
`expected input[1, 16, 128, 128] to have 4 channels, but got 16 channels`.
The same error fires for FLUX schnell latents — the channel count is the
tell: **4 = SD1.5/SDXL, 16 = SD3/FLUX family**.

### Defect 2 — cross-family VAE "works" but produces texture (silent garbage)

FLUX's `ae.safetensors` is also 16-channel/8×, so it *decodes without
error* — but the decoder weights and latent scaling belong to a different
model. Both 512² and 768² outputs were abstract blocky/melted textures
with a muted green-teal cast, not the prompted landscape. Confirmed by
vision model + pixel stats (mean RGB ≈ [139,137,131], std ≈ 20, ~0%
clipping). **Rule: a VAE only decodes latents from its own model family —
matching channel count is necessary, not sufficient.** FLUX VAE is not a
substitute for the SD3 VAE.

### Defect 3 — missing text encoders and ModelSamplingSD3 (quality, silent)

Even with the right VAE the old graph was under-conditioned:

- SD3.5 needs **three** text encoders — CLIP-L, CLIP-G, T5-XXL — via
  `TripleCLIPLoader`. The old graph loaded only
  `t5-v1_1-xxl-encoder-Q4_K_M.gguf` through `CLIPLoaderGGUF`: no CLIP
  conditioning at all.
- Every official SD3.5 example passes the model through
  `ModelSamplingSD3` (shift=3) before `KSampler`. The old graph went
  straight from `UnetLoaderGGUF` → `KSampler`.
- Official turbo guidance: **steps=4, cfg=1.2** (diffusers uses guidance
  0.0 ≈ cfg 1.0 — the old cfg=1.0 was defensible but not the documented
  ComfyUI value).
- Optional quality trick from the official workflow: split conditioning
  with `ConditioningSetTimestepRange` (positive gets range [0.1, 1], a
  zeroed-out copy gets [0, 0.1]).

## Correct file set (all verified on disk 2026-11-11)

| File | Size | Location |
|------|------|----------|
| `sd3.5_large_turbo-Q4_0.gguf` | 4.44 GB | `ComfyUI/models/unet/` |
| `clip_g.safetensors` | ~1.4 GB | `ComfyUI/models/text_encoders/` |
| `clip_l.safetensors` | ~0.25 GB | `ComfyUI/models/text_encoders/` |
| `t5xxl_fp8_e4m3fn.safetensors` | ~4.9 GB | `ComfyUI/models/text_encoders/` |
| `sd3_vae.safetensors` | 168 MB | `ComfyUI/models/vae/` |

Encoder + VAE source: `calcuis/sd3.5-large-gguf` on HuggingFace
(`diffusion_pytorch_model.safetensors` in that repo IS the SD3.5 VAE —
244 tensors, `decoder.*`/`encoder.*` keys). The gated
`stabilityai/stable-diffusion-3.5-large` repo has the same file at
`vae/diffusion_pytorch_model.safetensors`. Reference workflow:
`docs/scratch/calcuis_sd35_gguf_workflow.json` (non-turbo variant:
40 steps, cfg 4.5, dpmpp_2m/sgm_uniform).

Working API workflow: `docs/scratch/gguf_test_sd35_turbo_fixed.json`
— UnetLoaderGGUF → ModelSamplingSD3(3) → TripleCLIPLoader →
KSampler(4 steps, cfg 1.2, euler, sgm_uniform) → VAEDecode(sd3_vae) →
SaveImage.

## Measured on GTX 1070 Ti (8 GB, ~7 GB free at start)

| Run | Graph | 4-step sampling | Peak VRAM (nvidia-smi) | Decode |
|-----|-------|-----------------|------------------------|--------|
| as-is 1024² | sdxl_vae | ~24 s cold (~6 s/step) | 2015 MiB | RuntimeError (4 vs 16 ch) |
| fluxvae 512² | ae.safetensors | ~7.3 s warm (~1.8 s/step) | 6473 MiB | "success" → texture garbage |
| fluxvae 768² | ae.safetensors | ~12.9 s warm (~3.2 s/step) | 6461 MiB | "success" → texture garbage |
| **fixed 1024²** | sd3_vae + triple CLIP + ModelSamplingSD3 | ~48.5 s warm (~12 s/step) | **7539 MiB** | **success — real landscape** |

The fixed run is the proof: `sd35turbo_sd3vae_1024_00001_.png`
(`docs/scratch/comfy_out/sd35_fixed_1024.png`) is a coherent
photorealistic golden-hour river scene — vision model reports no color
cast beyond the intended warm grade and no artifacts. 1024² with the
full encoder stack fit on the 8 GB card but at **92% VRAM** — no
headroom for anything else resident on the GPU.

Notes: ComfyUI 0.44 uses dynamic VRAM loading — the 4.44 GB GGUF streams
from disk/RAM, so peak device memory stayed ~2 GB on the failing run and
~6.4–7.5 GB once real decodes ran. Warm runs (models cached) sample
~3× faster than cold. 768² fit with ~1.7 GB headroom.

## FLUX.1-schnell control run (same thread, 2026-11-12)

To prove the VAE-family rule from the other direction, the original
FLUX schnell GGUF graph (`flux1-schnell-Q4_0.gguf` 6.31 GB +
`t5-v1_1-xxl-encoder-Q4_K_M.gguf` via `CLIPLoaderGGUF` type `flux3`,
4 steps, cfg 1.0, euler/simple, seed 1234) was rerun with the VAE
swapped from `sdxl_vae` to `ae.safetensors` — the one change that makes
FLUX latents decodable.

| Size | Total prompt time | 4-step sampling | Peak VRAM | Result |
|------|-------------------|-----------------|-----------|--------|
| 512×512 | ~13.3 min (cold: model load dominated) | ~18.5 s (~4.6 s/step) | 7884 MiB | coherent golden-hour landscape, matches prompt |
| 768×768 | ~6.2 min (warm) | ~346 s wall — includes a ~233 s stall between steps 1→2 (VRAM thrash) | **8016 MiB (98%)** | coherent mountain golden-hour landscape, matches prompt |

768² output: `ComfyUI/output/fluxschnell_gguf_768_00001_.png`
(copy `docs/scratch/comfy_out/`). Vision check: coherent layered
mountain landscape in golden hour, sharp, no artifacts. The mid-sample
stall is the 6.31 GB GGUF + 768² latent exceeding what fits resident —
ComfyUI offloaded and reloaded weights mid-sampler. At 98% peak VRAM
this model is at the edge of what the card can do; treat 768² as the
practical ceiling and expect multi-minute stalls, not smooth sampling.

512² output: `ComfyUI/output/fluxschnell_gguf_512_00001_.png`
(copy `docs/scratch/comfy_out/`). Vision check: coherent scene —
grassy hill, dark tree, fence, hazy mountains, warm golden grade, no
artifacts. Note the graph still loads **only T5** (no CLIP-L), same
single-encoder defect as the SD3.5 graph — FLUX wants CLIP-L + T5-XXL
via `DualCLIPLoader`. Prompt adherence was still good on this prompt,
but complex prompts will under-condition.

Peak VRAM 7884/8192 MiB (96%) — the 6.31 GB schnell GGUF is the
largest model run on this card; it fits only because ComfyUI streams
weights, and there is zero headroom for co-resident GPU work.

### FLUX encoder fix — DualCLIPLoaderGGUF (verified 2026-11-12)

The missing-encoder defect is now fixed and verified. No CLIP-L GGUF
download was needed: `clip_l.safetensors` (246 MB, ViT-L/14) was
already in `ComfyUI/models/text_encoders/` from the SD3.5 encoder
setup, and `DualCLIPLoaderGGUF` resolves `clip` folder paths across
both `clip/` and `text_encoders/` — its loader accepts a safetensors
CLIP next to a GGUF T5. FLUX's trained conditioning is CLIP-L (pooled)
+ T5-XXL, so this is the architecturally correct stack; T5-only is an
approximation.

Canonical workflow: `tools/mcp/comfyui-workflows/flux-schnell-gguf-dualclip.json`
(API format) — UnetLoaderGGUF(`flux1-schnell-Q4_0.gguf`) →
DualCLIPLoaderGGUF(`clip_l.safetensors` +
`t5-v1_1-xxl-encoder-Q4_K_M.gguf`, type `flux`) → KSampler(4 steps,
cfg 1.0, euler/simple, seed 1234) → VAEDecode(`ae.safetensors`) →
SaveImage. Scratch copy: `docs/scratch/flux_dualclip_512.json`.

Complex-prompt A/B at 512×512, seed 1234 — "a red vintage bicycle
leaning against a blue wooden fence, a ginger cat sitting on the
bicycle seat, golden hour sunlight, photorealistic, shallow depth of
field" — same graph except encoder node (DualCLIP vs T5-only
CLIPLoaderGGUF):

| Graph | Vision adherence (8-point checklist) | Total exec | Peak VRAM | Output |
|-------|--------------------------------------|------------|-----------|--------|
| DualCLIP (clip_l + t5xxl) | **8/8 faithful, no artifacts** | 723.5 s | 7867 MiB | `fluxschnell_dualclip_512_00001_.png` |
| T5-only (control) | **8/8 faithful, no artifacts** | 888.6 s | 7885 MiB | `fluxschnell_t5only_512_00001_.png` |

Honest verdict: **no measurable adherence difference on this prompt** —
T5-only also nailed all subjects, colors, the spatial relation
(cat on seat, bike on fence), lighting, and DoF. The dual stack is
still the right canonical choice: it matches FLUX's trained
conditioning, and T5-only is expected to degrade first on prompts with
attribute binding, counting, or negation-heavy descriptions. Both
runs sat at ~96–98% VRAM and showed multi-minute inter-step stalls —
the encoder swap did not change the memory ceiling.

## Gotchas worth remembering

- `CLIPLoaderGGUF` loads ONE encoder file. SD3/Flux-family models need
  all their encoders; for SD3.5 that means `TripleCLIPLoader`, for
  FLUX `DualCLIPLoaderGGUF` (CLIP-L + T5-XXL, type `flux`) — not a
  bigger GGUF.
- `DualCLIPLoaderGGUF` accepts mixed formats: a safetensors CLIP-L
  from `models/text_encoders/` pairs fine with a GGUF T5 — no
  CLIP-L GGUF is required.
- GGUF checkpoints contain **no VAE and no text encoders** — city96's
  format is one-model-per-file by design.
- `EmptySD3LatentImage` always makes 16-channel latents; feeding it to
  an SD1.5/SDXL pipeline is the other direction of the same channel
  mismatch.
- Websocket progress events (`/ws`) are the only way to time per-step
  sampling; `/history` has no per-step data. Use a **unique clientId per
  connection** — a killed session's zombie socket can silently eat
  events for a reused clientId.
- HF `black-forest-labs/FLUX.1-schnell` is gated (401 on `ae.safetensors`);
  public mirrors serve the byte-identical 335,304,388-byte file.

## Related

- [[prompting-guide-for-local-gguf-image-models-flux-1-schnell-and-sd3-5-turbo-2026|prompting-guide-for-local-gguf-image-models-flux-1-schnell-and-sd3-5-turbo-2026]] :see-also
- [[higgsfield-comfyui-challenge-2026|higgsfield-comfyui-challenge-2026]] :see-also
- [[animatediff-evolved-2026|animatediff-evolved-2026]] :cites
- [[wangp-local-video-generation-2026|wangp-local-video-generation-2026]] :implements
- [[3d-generation-2026-updates|3d-generation-2026-updates]] :see-also
- [[text-to-3d-options-2026|text-to-3d-options-2026]] :see-also
