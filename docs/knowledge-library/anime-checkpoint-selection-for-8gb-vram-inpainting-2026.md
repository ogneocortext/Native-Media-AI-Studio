---
tags:
  - technical
aliases:
  - anime checkpoint, illustrious, animagine, noobai, pony diffusion, sdxl anime, civitai model
cssclasses:
  - technical-guide
date: 2026-11-10
type: concept
---

> [!info] Purpose
> Which anime/illustration checkpoint to download for stylized inpainting
> (mouth-variant generation, asset repair) on the GTX 1070 Ti 8 GB, and the
> settings each candidate needs inside ComfyUI.

---

## Context

The Path C lip-sync prototype (`docs/plans/tasks/platform-and-workflow.md`
T-LIPSYNC-02) reached a ceiling: procedural mouth shapes don't match the art
style, and `sd_xl_base_1.0` inpainting produces amorphous blob mouths because
SDXL base has no anime prior — the same domain-gap failure as MuseTalk, one
level down. The fix is an anime-tuned checkpoint; this doc records which one
fits this GPU and why.

Hardware: GTX 1070 Ti, 8 GB VRAM (Pascal sm_61), ComfyUI 0.44.0 already
running with ~7 GB free, PyTorch 2.14+cu126. Anything SDXL-class fp16
(~6.5 GB) runs via ComfyUI's automatic weight offloading — proven in
practice: `sd_xl_base_1.0.safetensors` (6.46 GB) already inpainted three
mouth variants at 1024², ~2–3 min each, no OOM.

## Candidates (2026 research)

| Checkpoint | Base | Size | Min VRAM | License | Prompt style | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Animagine XL 4.0** | SDXL | ~6.5 GB | 8 GB | CreativeML OpenRAIL++-M — **commercial OK** | booru tags + plain English | Clean modern anime, polished out-of-box, forgiving defaults. Safest license of the SDXL anime set. |
| **Illustrious XL v2.0** | SDXL | ~6.5 GB | 8 GB | Fair AI Public License 1.0-SD | Danbooru tags; v2.0 takes plain English | Cleanest line work, largest LoRA/merge ecosystem, native up to 1536 px. FAPL allows commercial use under its terms — verify before commercial catalog use. |
| NoobAI-XL (v-pred) | Illustrious | ~7.1 GB | 8 GB | **Non-commercial** | booru tags | Deepest character/tag knowledge; license disqualifies commercial renders. |
| Pony Diffusion V6 XL | SDXL | ~6.9 GB | 8 GB | OpenRAIL++-M | **requires** `score_9, score_8_up, …` prefix + `source_anime`/`rating_safe` + **CLIP Skip 2** | Largest LoRA library but the fiddliest prompt contract; wrong settings = garbage. |
| Anything V5 / Counterfeit V3 | SD 1.5 | ~2 GB | 4 GB | varies | booru tags | Legacy; can't compete at 1024² native. Only if VRAM were tighter. |
| Anima (~2.9B) | own arch | GGUF Q4 ~1.4 GB | fits easily | check model card | — | Newest (July 2026 knowledge cutoff), tiny footprint, but young ecosystem — few LoRAs/workflows. |

Consensus across 2026 guides: for SDXL anime on 8 GB+, **NoobAI-XL or
Illustrious XL** are the quality leaders; **Animagine XL 4.0** is the
license-safe alternative with the cleanest defaults.

## Recommendation for this repo

**Animagine XL 4.0** as the primary download:

- Permissive license (OpenRAIL++-M) — safe for catalog/commercial renders,
  unlike NoobAI.
- Same SDXL architecture → the existing `comfy_mouth_gen.py` workflow
  (`docs/scratch/`, CheckpointLoaderSimple → VAEEncodeForInpaint →
  InpaintModelConditioning → KSampler → VAEDecode → SaveImage) works
  unchanged; only `ckpt_name` and prompt dialect differ.
- ~6.5 GB fp16 safetensors → `ComfyUI\models\checkpoints\`.
- Settings delta vs the SDXL-base run: sampler `euler_a` (or DPM++ 2M
  Karras), CFG ~5.5–7, steps ~28–35, and anime-appropriate prompting
  (booru-ish tags: `1girl, open mouth, teeth, pink lips, anime style`).

Illustrious XL v2.0 is the fallback if Animagine's output style misses —
bigger ecosystem, native 1536 px headroom, but confirm FAPL terms for the
intended use.

## Inpainting-specific notes

- Regular (non-inpaint) anime checkpoints work with
  `InpaintModelConditioning` — proven with SDXL base. Dedicated
  `stable-diffusion-xl-1.0-inpainting-0.1` exists but is photoreal-biased;
  skip it for anime work.
- Keep the mask tight (inner-lip polygon + ~10 px dilation, feathered) —
  a wide mask lets the model repaint surrounding line work and causes the
  seams seen in the SDXL-base variants.
- Denoise ~0.9: high enough to invent the mouth interior, low enough to
  keep lip-edge structure.
- Generate 3–4 seeds per mouth shape and pick — anime checkpoints vary
  more per-seed than the base model did.

## Sources

- insiderllm.com — Best Anime and Stylized Checkpoints for Local Image
  Gen (2026): https://insiderllm.com/guides/best-anime-stylized-checkpoints-local-image-generation/
- localaimaster.com — Best Local Anime Image Model: Illustrious vs NoobAI
  (license + VRAM table): https://localaimaster.com/blog/best-local-anime-image-model
- topimageprompt.com — Best SD Anime Checkpoints & LoRA 2026 (prompt
  contracts, Pony score-tag warning):
  https://topimageprompt.com/blog/best-stable-diffusion-anime-checkpoints-lora-2026
- modeltrends.ai — Pony vs Illustrious 2026 (settings table):
  https://modeltrends.ai/ai-model-guides/pony-vs-illustrious
- civitai.com — Trinity SDXL Workflow (Illustrious/Pony/NoobAI inpainting
  node graph reference): https://civitai.com/models/2834962/

## Related

- [[musetalk-quality-and-stylized-lip-sync-options-2026]]:see-also — the lip-sync research that motivated this
- [[mp4-encoding-for-maximum-player-compatibility-2026]]:see-also — playback compatibility for rendered outputs
- [[hardware-verified-models|hardware-verified-models]]:implements — GPU/model verification records
