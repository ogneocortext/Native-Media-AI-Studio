---
tags:
  - ai
  - comfyui
  - prompt-engineering
  - danbooru
aliases:
  - Animagine XL Tag Guide
  - Anim4gine Prompting
cssclasses:
  - ai-guide
date: 2026-11-14
type: entity
---

> [!info] Purpose
> Complete tag reference for `animagine-xl-4.0.safetensors` (installed at
> `ComfyUI/models/checkpoints/`): canonical prompt order, the rating / score /
> quality / temporal tag systems, negative-prompt canon, recommended sampler
> settings, known weaknesses, and the LoRA ecosystem. Researched 2026-11-13
> from the official model card, CagliostroLab's optimization post, community
> comparisons, and hands-on runs on this rig.

---

## Overview

Animagine XL 4.0 ("Anim4gine") is an SDXL anime checkpoint trained on 8.4M
Danbooru-tagged images (knowledge cutoff 2025-01-07, ~2650 GPU-hours,
SDXL 1.0 base). It uses **tag-ordering training** — tag position is
semantic, not cosmetic. Natural-language prompts do not work; write Danbooru
tags.

**Checkpoint variants on Hugging Face:** base `animagine-xl-4.0` (this rig's
file — name alone doesn't distinguish; verify by size/behavior if it
matters), `animagine-xl-4.0-opt` (extra dataset: better stability, anatomy,
noise, color — the recommended general-use version), `animagine-xl-4.0-zero`
(pretrain base, intended as a LoRA-training foundation, not for direct use).

## Canonical prompt order (v4 — order is load-bearing)

```
1girl/1boy/1other, [character name], [series/copyright], [artist tags],
[rating tag], [general tags — any order], [quality/score/temporal tags LAST]
```

- Subject counter first (`1girl`, `1boy`, `1other`, `1cat`, …).
- Character + series tags together and early (e.g.
  `arima kana, oshi no ko, hoshimachi suisei \(1st costume\)`).
- **Artist tags go after general tags but before quality tags** — putting
  quality tags first *breaks artist-tag triggering* (official warning).
- Quality/score tags **always at the end**. v4 was originally trained with
  them first; the authors walked that back — end placement is correct.
- For original characters (no canon name): skip character/series slots.

## Rating tags — the content dial

Four values, placed in the rating slot:

| Tag | Effect |
|-----|--------|
| `safe` | biases toward all-ages output |
| `sensitive` | revealing clothing, suggestive |
| `nsfw` | nudity / strong exposure |
| `explicit` | sexual content |

Observed on this rig (2026-11-13): `nsfw` produced unbuttoned-shirt
cleavage; `explicit` alone undershot (topless, ambiguous bottom); `explicit`
+ `completely nude, no clothes, no shirt, no bra` positive **and** clothing
terms negated (`clothes, shirt, bra, panties`) produced fully nude. Negative
clothing tags were the decisive addition.

**SFW hygiene:** most high-quality training images are NSFW, so quality tags
alone leak suggestive content. For guaranteed-safe output add `safe` (or
`general`) to positive AND `nsfw, sensitive` to negative. v3 used
`rating:general` syntax; v4 uses bare `general`/`safe`.

## Quality vs score tags (v4-specific distinction)

- **Quality tags:** `masterpiece`, `best quality`, `low quality`,
  `worst quality`. Coarse on/off.
- **Score tags:** `high score`, `great score`, `good score`, `average score`,
  `bad score`, `low score`. Finer-grained — community testing (iPentec
  comparison) shows score tags steer quality more granularly than quality
  tags; the documented sweet spot is `masterpiece, high score, great score,
  absurdres` all together at the end.
- `absurdres` = high-resolution/detail encouragement (a *meta* tag).
- Putting quality tags in the **negative** prompt also works: v3-era guidance
  used `worst quality, low quality` there; our negative canon already
  includes the full ladder.

## Temporal / year tags — style era control

v4 supports explicit years: `year 2005` … `year 2025`. v3 used buckets:
`newest` (2022–23), `late` (2019–21), `mid` (2015–18), `early` (2011–14),
`oldest` (2005–10). These shift line-art/style era — verified experimentally
to produce visibly different "age of anime" looks across all 20 years.
Place with general tags, before quality tags.

## Negative prompt canon (model-card)

```
lowres, bad anatomy, bad hands, text, error, missing finger, extra digits,
fewer digits, cropped, worst quality, low quality, low score, bad score,
average score, signature, watermark, username, blurry
```

Community-extended negatives seen in the wild: `deformed, distorted,
disfigured, ugly, jpeg artifacts, unfinished, displeasing, chromatic
aberration, extra limbs, missing limbs, mutation, poorly drawn hands,
long neck, cross-eye, nsfw/sensitive` (rating suppression),
`clothes, shirt, bra, panties` (nudity enforcement — proven on this rig).

## Sampler settings (official)

- **Steps:** 25–28 (28 recommended; we run 28)
- **CFG:** 4–7 (5 recommended; we run 5.5 — fine)
- **Sampler:** Euler a preferred. We use `dpmpp_2m` + `karras` — produces
  good results; Euler a is worth an A/B if chasing the last few percent.
- **Clip skip:** 2 (SeaArt guide; ComfyUI CheckpointLoaderSimple doesn't
  expose it — would need a CLIPSetLastLayer node if pursued)
- **VAE:** bundled in checkpoint; `sdxl_vae`/`PyTorch_vae` suggested for
  better generations if artifacts appear

## Resolution table (training-aligned)

| Orientation | Sizes |
|---|---|
| Square | 1024×1024 |
| Landscape | 1152×896, 1216×832, 1344×768, 1536×640 |
| Portrait | 896×1152, **832×1216** (our default), 768×1344, 640×1536 |

Far-from-training sizes (esp. >1536px or extreme ratios) degrade quality.
VRAM on GTX 1070 Ti: 832×1216 @ 28 steps ≈ 7.5 GiB peak, ~90–235 s.

## Danbooru tag categories (what the model actually learned)

Five categories; only **general** tags describe visible content:

- **General** — visible facts: `long hair`, `smile`, `school uniform`,
  `looking at viewer`, `spread legs`. The bulk of useful prompting.
- **Artist** — style mimicry (`artist:wlop`-style names, space or
  underscore). Powerful for style lock; position per canonical order.
- **Copyright / Character** — series + character names; needed together for
  canon characters, skipped for originals.
- **Meta** — `absurdres`, `highres`, `newest`, year tags, rating-adjacent.

Practical tag sources: Danbooru tag lists / search, WD14-style auto-taggers
(e.g. via ComfyUI Impact Pack or online taggers) to caption a reference
image into prompt vocabulary.

## Known weaknesses (official + observed)

- **Hands/anatomy** — improved in Opt but still the #1 defect class;
  complex finger poses and finger counting remain unreliable. Mitigate with
  simple hand poses, negative hand tags, and the zoomed-crop QA loop in
  [[defect-analysis-for-ai-generated-images-multi-pass-vision-qa-2026]].
- **Text rendering** — unsupported, don't bother.
- **Far-distance shots** — subject quality drops; keep medium/close framing.
- **Recent characters** — post-cutoff characters may not exist.
- **Short prompts** — under-specified prompts produce drift; the model wants
  long, detailed tag lists (SeaArt guide).

## LoRA ecosystem

- Character/style LoRAs trained on Danbooru-tag conventions plug into the
  same checkpoint; trigger words follow the tag vocabulary.
- Training your own: needs ~30+ images per character (author's HF answer);
  use the **Zero** variant as base for LoRA training.
- Civitai hosts a large Animagine LoRA library; check training base
  (v3 vs v4 LoRAs do NOT transfer — v4 is an SDXL retrain, not a v3
  finetune).

## Rig notes (this machine)

- Workflow pattern that works: `CheckpointLoaderSimple → CLIPTextEncode
  (pos/neg) → EmptyLatentImage → KSampler → VAEDecode → SaveImage`, posted
  to `http://127.0.0.1:8188/prompt` — scratch scripts in
  `docs/scratch/make_animagine_*.py`.
- Confirmed working prompt skeleton (SFW mature portrait, corrected v4
  order): `1girl, solo, mature woman, office lady, business suit, ...,
  masterpiece, high score, great score, absurdres`.
- VRAM ceiling ~7.5 GiB at 832×1216 — no headroom for a second model
  resident; unload Ollama vision models before long ComfyUI runs if needed.

## Sources

- Model card — huggingface.co/cagliostrolab/animagine-xl-4.0
- Optimization guide (tag order, rating tags, Opt/Zero) —
  cagliostrolab.net/posts/optimizing-animagine-xl-40-in-depth-guideline-and-update
- Release post (Anim4gine) — cagliostrolab.net/posts/animagine-xl-v4-release
- Quality vs score tag A/B — ipentec.com (Animagine XL v4 comparison)
- Temporal tags experiment — note.com/aicu (20-year tag sweep)
- Tag-order guide (Kazumu) — note.com/kazumu/n/n6390a899bdce
- Danbooru tag taxonomy — safebooru.donmai.us/wiki_pages/help:tags,
  imgtagger.com/guides/danbooru-tags-explained
- Community settings guides — wiki.monai.art/en/models/animagine_xl_v4,
  rinkaillust.com, seaart.ai articleDetail/cru28bte878c73abdpsg
- Hands-on verification — 2026-11-13 runs on this rig (nsfw/explicit
  rating ladder, explicit2 nude escalation)

## Related

- [[prompting-guide-for-local-gguf-image-models-flux-1-schnell-and-sd3-5-turbo-2026|prompting-guide-for-local-gguf-image-models-flux-1-schnell-and-sd3-5-turbo-2026]] :see-also
- [[animatediff-evolved-2026|animatediff-evolved-2026]] :see-also
- [[comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026|comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026]] :see-also
- [[comfyui-workflows|comfyui-workflows]] :see-also
- [[higgsfield-comfyui-challenge-2026|higgsfield-comfyui-challenge-2026]] :see-also
- [[defect-analysis-for-ai-generated-images-multi-pass-vision-qa-2026|defect-analysis-for-ai-generated-images-multi-pass-vision-qa-2026]] :see-also
