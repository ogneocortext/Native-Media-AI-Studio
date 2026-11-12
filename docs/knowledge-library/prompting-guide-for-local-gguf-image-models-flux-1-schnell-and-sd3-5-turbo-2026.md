---
tags:
  - technical
aliases:
  - FLUX schnell prompting
  - SD3.5 turbo prompting
  - GGUF prompt guide
  - negative prompts FLUX
cssclasses:
  - technical-guide
date: 2026-11-12
type: concept
---

> [!info] Purpose
> Prompting guide for the two image models verified working on this
> machine's GTX 1070 Ti — FLUX.1-schnell Q4_0 GGUF and SD3.5 Turbo
> Q4_0 GGUF in ComfyUI — covering prompt structure, hard limits
> (negative prompts, token budgets), and what to avoid.

---

## Overview

Researched 2026-11-12 against BFL/ComfyUI guidance for the two distilled
GGUF checkpoints proven on this card. Both are **few-step distilled
models** — prompt craft matters more than usual because there is no
long sampling trajectory to recover from a weak prompt, and both run
at CFG ≈ 1, which changes how negatives behave.

Working graphs (canonical):

- FLUX: `tools/mcp/comfyui-workflows/flux-schnell-gguf-dualclip.json`
- SD3.5 Turbo: `docs/scratch/gguf_test_sd35_turbo_fixed.json`

See [[comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026|the GGUF VAE/encoder article]]
for the model/VAE setup these prompts run on.

## Shared rules (both models)

- **Write what you WANT, not what you don't want.** At CFG 1 there is
  no unconditional pass for a negative prompt to push against — see
  per-model notes below.
- **Concrete beats keyword soup.** "An old fisherman mending a net on a
  stone harbour wall" beats "a person, detailed, masterpiece, 8k".
  Stacking quality tags (`8k ultra HD trending on artstation`) makes
  outputs look over-processed; both models already produce clean base
  images.
- **Lighting is the highest-impact element.** Name the source,
  direction, and quality: "golden-hour backlight", "softbox from
  camera left", "overcast diffuse morning".
- **Describe spatial layers explicitly** for complex scenes:
  foreground / midground / background.
- **Change one thing at a time** between seeds/attempts so you can tell
  what helped.
- **Front-load importance** — subjects and actions first, style/medium
  last. Both T5 encoders read natural prose better than comma lists,
  though comma lists still work.

## FLUX.1-schnell (flux1-schnell-Q4_0.gguf + CLIP-L + T5-XXL GGUF)

### Prompt structure that works

1. **Subject** — concrete, with 1–2 distinguishing details (age,
   clothing, object type).
2. **Action/pose** — present tense: "leaning against a wall, smoking a
   pipe".
3. **Setting** — where + time of day.
4. **Light and mood** — ONE light source beats several.
5. **Composition** — "close-up", "wide shot", "from above", plus
   camera/lens when useful: "shot on 85mm f/1.4, shallow depth of
   field".
6. **Style/medium** — "analog 35mm film photograph", "oil painting in
   the style of Rembrandt", "studio 3D render". Names of
   photographers/cameras/mediums are recognized.

Verified-good example (produced a faithful image on this machine,
512², 4 steps):

> a red vintage bicycle leaning against a blue wooden fence, a ginger
> cat sitting on the bicycle seat, golden hour sunlight,
> photorealistic, shallow depth of field

### Hard limits

- **Negative prompt is dead weight.** FLUX.1 dev/schnell are distilled
  with CFG fixed at 1.0; the negative conditioning is multiplied by
  zero. Our canonical workflow still has a negative CLIPTextEncode
  node feeding KSampler — it does nothing. Don't bother writing
  negatives; instead phrase exclusions positively inside the prompt
  ("empty street", "no people") or accept them.
- **Keep cfg at 1.0.** Raising CFG runs real dual-pass guidance on top
  of the distilled guidance — doubles compute and burns/blurs the
  image. Same trap as SD3.5 turbo.
- **T5 sequence limit is 256 tokens** (dev gets 512). Long prompts get
  truncated — keep it to ~1–2 dense sentences (~40–50 words) unless
  the scene truly needs more. With only 4 sampling steps, an overlong
  prompt can't be fully realized anyway.
- **Steps 1–4, euler/simple** is the trained regime. More steps do not
  help schnell.
- **Guidance scale**: schnell wants guidance ≈ 0 (timestep-distilled,
  guidance baked into weights). Do not add a FluxGuidance node.

## SD3.5 Turbo (sd3.5_large_turbo-Q4_0.gguf + TripleCLIPLoader)

### Prompt structure that works

SD3.5 was trained on natural-language captions — **write prose, not
keyword lists**. A plain sentence or two is followed more faithfully
than comma-separated tags.

Order that works (subject → action → setting → light → medium →
composition):

> a weathered fisherman in a yellow raincoat mending a net on a stone
> harbour wall, small boats behind him, overcast morning soft diffuse
> light, medium shot eye level, 35mm photograph, natural colour

- **No prompt-weighting syntax** — `(word:1.3)` and `[word]` do nothing
  in SD3.5. No brackets in prompts.
- **Start and end carry weight** — put the most important element
  first or last; middle terms get less attention.
- **Resolution is part of the prompt's context**: the model is natively
  ~1 MP; it accepts 0.25–2 MP but was trained near 1024². On this card
  we run 1024².
- **Negatives are optional** — Stability says they're not necessary.
  At cfg 1.2 (ComfyUI turbo setting) there is effectively no negative
  pass either, so don't rely on them; the official turbo guidance is
  cfg=1, steps=4, euler, sgm_uniform.

### Settings that matter (already in the working graph)

- `ModelSamplingSD3` shift=3 before KSampler — part of the official
  pipeline, not optional decoration.
- steps=4, cfg 1.2 (ComfyUI example) — Stability's hosted default for
  Turbo is cfg=1; both are defensible, don't raise it toward the
  Large model's 4.5.
- euler + sgm_uniform.

## What GGUF Q4 changes (and doesn't)

- Q4_0/Q4_K_M quantization costs a little fine detail vs fp16/fp8 but
  does **not** change prompt semantics — the same prompt rules apply.
  If output looks soft, the fix is usually resolution/steps, not a
  "better prompt".
- GGUF files carry no VAE or encoders — prompt quality is bounded by
  the encoder stack wired in the graph (see the sibling article).

## Quick reference card

| | FLUX.1-schnell | SD3.5 Turbo |
|---|---|---|
| Prompt style | 1–2 plain sentences, ≤256 T5 tokens | prose sentences, natural captions |
| Negative prompt | **ignored** (cfg=1) | effectively ignored at cfg≈1 |
| CFG | must stay 1.0 | 1.0–1.2 |
| Steps | 4 | 4 |
| Sampler/scheduler | euler / simple | euler / sgm_uniform |
| Weighting syntax | none | none |
| Best lever | lighting + composition + lens | subject detail + spatial description |
| Resolution | 512² comfortable, 768² ceiling | 1024² native |

## Sources

- BFL FLUX.1 docs (diffusers pipeline guide): schnell guidance_scale
  must be 0, 1–4 steps, 256-token T5 limit.
- ComfyUI examples (comfyanonymous.github.io/ComfyUI_examples): SD3.5
  turbo = 4 steps cfg 1.2; TripleCLIPLoader file set.
- Stability AI SD3.5 prompting guidance via AWS ML blog + MonAI
  tutorial: natural language, no weighting, front/end weighting.
- deAPI / skywork / HEISS UI FLUX prompting guides: subject→action→
  setting→light→composition frame; negatives dead at CFG 1.

## Related

- [[ollama-prompting-2026|ollama-prompting-2026]] :see-also
- [[comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026|comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026]] :see-also
- [[stable-diffusion-local-models-2026|stable-diffusion-local-models-2026]] :implements
- [[3d-generation-options-2026|3d-generation-options-2026]] :see-also
- [[prompt-engineering|prompt-engineering]] :see-also
