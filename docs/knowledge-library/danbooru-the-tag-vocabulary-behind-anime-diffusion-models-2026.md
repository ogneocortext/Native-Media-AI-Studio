---
tags:
  - ai
  - danbooru
  - prompt-engineering
  - comfyui
aliases:
  - Danbooru Tags
  - Danbooru Imageboard
cssclasses:
  - ai-guide
date: 2026-11-14
type: concept
---

> [!info] Purpose
> What Danbooru is, why anime diffusion models speak its tag vocabulary,
> and how to use it when prompting. The conceptual foundation under
> [[animagine-xl-4-0-tag-reference-order-rating-score-and-temporal-tags-2026]].

---

## Overview

**Danbooru** (danbooru.donmai.us — spelled d-a-n-b-o-o-r-u) is an imageboard
dedicated to anime and manga-style images. It is the largest
community-tagged anime image archive in existence, and its tagging
vocabulary became the de-facto caption language for anime diffusion
models.

## What it is

- Users upload anime-style images; every post gets tagged with a controlled
  vocabulary of short lowercase labels.
- Tag examples: `1girl`, `long_hair`, `school_uniform`, `looking_at_viewer`,
  `smile`, `spread_legs`, `absurdres`.
- Multi-word tags use underscores on the site (`looking_at_viewer`), but
  prompt boxes accept spaces or underscores interchangeably.
- It is one of several "boorus" (imageboards with tag systems): Safebooru
  (danbooru.donmai.us → safebooru.donmai.us) mirrors the same vocabulary
  with a SFW-only policy; Gelbooru, Konachan, Yande.re, and Moebooru are
  siblings with similar but not identical tag sets.

## The five tag categories

Every Danbooru tag belongs to exactly one category:

| Category | Records | Examples |
|----------|---------|----------|
| **General** | anything visible in the image | `smile`, `red_scarf`, `from_side`, `tree` |
| **Artist** | who drew it | artist name tags |
| **Copyright** | the series/franchise | `vocaloid`, `touhou`, `oshi no ko` |
| **Character** | a specific named character | `hatsune_miku`, `hakurei_reimu` |
| **Meta** | facts about the file/post, not content | `highres`, `absurdres`, `commentary_request` |

Only **general** tags describe visible content — which is why auto-taggers
(WD14 and similar) only ever predict general + character tags; they cannot
see who drew something or verify resolution from a resized copy.

Every post also carries one **content rating**: `g` (general), `s`
(sensitive), `q` (questionable), `e` (explicit) — the ancestor of the
`safe/sensitive/nsfw/explicit` rating tags in Animagine prompts.

## Why diffusion models speak Danbooru

Anime-focused checkpoints were trained on scraped Danbooru (and similar
booru) images **with their tags as captions**:

- **Animagine XL** — ~8.4M images, knowledge cutoff 2025-01-07
  ([[animagine-xl-4-0-tag-reference-order-rating-score-and-temporal-tags-2026]])
- **NovelAI Diffusion**, **Pony Diffusion**, **Illustrious** — same lineage
- Photoreal models (FLUX, SD3.5, SDXL-base) were trained on natural-language
  captions instead — Danbooru tags actively hurt them.

Consequences that matter when prompting:

1. **Tags, not sentences.** "A girl with long silver hair smiling in a
   classroom" fails; `1girl, long hair, silver hair, smile, classroom`
   works.
2. **Tag position is semantic.** These models use tag-ordering training —
   subject → character → series → rating → general → quality. Scrambling
   the order degrades identity/style accuracy.
3. **The vocabulary is finite and searchable.** If a concept has no tag,
   the model probably can't render it reliably. Danbooru's tag list (or a
   WD14 auto-tagger run on a reference image) is the way to find the exact
   word the model knows.
4. **Character/series names are real tags.** `rem, re:zero` works because
   they're Danbooru character + copyright tags; canon characters need both
   together to disambiguate.

## Practical uses on this rig

- **Find the right tag:** search Danbooru's tag list / wiki, or run a
  WD14-style tagger on a reference image to get prompt-ready vocabulary.
- **Style mimicry:** artist-name tags are the strongest style lever —
  position them after general tags, before quality tags.
- **Rating control:** booru ratings map to prompt rating tags
  (`safe`/`sensitive`/`nsfw`/`explicit`).
- **Don't mix vocabularies:** Danbooru tags in a photoreal model (FLUX,
  SD3.5) or natural language in an anime model both underperform.

## Sources

- Danbooru tag help — safebooru.donmai.us/wiki_pages/help:tags
- Tag taxonomy explainer — imgtagger.com/guides/danbooru-tags-explained
- Danbooru glossary — deepwiki.com/danbooru/danbooru
- Tag checklist conventions — donmai.moe/wiki_pages/howto:tag_checklist

## Related

- [[animagine-xl-4-0-tag-reference-order-rating-score-and-temporal-tags-2026|animagine-xl-4-0-tag-reference-order-rating-score-and-temporal-tags-2026]] :implements
- [[prompting-guide-for-local-gguf-image-models-flux-1-schnell-and-sd3-5-turbo-2026|prompting-guide-for-local-gguf-image-models-flux-1-schnell-and-sd3-5-turbo-2026]] :see-also
- [[animatediff-evolved-2026|animatediff-evolved-2026]] :cites
- [[comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026|comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026]] :see-also
- [[comfyui-workflows|comfyui-workflows]] :implements
