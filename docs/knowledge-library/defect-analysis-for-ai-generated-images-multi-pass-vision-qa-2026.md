---
tags:
  - ai
  - comfyui
  - vision
  - quality-assurance
aliases:
  - AI Image Defect Analysis
  - Generated Image QA Pipeline
cssclasses:
  - ai-guide
date: 2026-11-14
type: synthesis
---

> [!info] Purpose
> How to find defects in locally generated images (ComfyUI/SDXL/FLUX/Animagine)
> reliably enough to drive prompt/parameter refinements — synthesized from
> 2025–2026 research on AIGC artifact detection plus what actually worked on
> this rig (gemma4:e2b-it-qat + `tools/vision/analyze.mjs`).

---

## Overview

A single full-frame vision pass misses the defects that matter most (hands,
eyes, seams, small text). The research consensus is a **multi-pass,
region-focused** pipeline: detect → crop/zoom → classify → feed localized
findings back as concrete prompt/parameter changes. This doc records the
techniques worth adopting on the 8 GB rig and the ones that don't fit.

## What the research says

### 1. Defect taxonomy first — local vs global

Split every check into two classes before looking:

- **Local artifacts** — fingers, eyes, teeth, text, seams, texture blotches.
  These need zoomed crops; a full-frame pass at 832×1216 cannot resolve them.
- **Global artifacts** — extra/missing limbs, impossible geometry, wrong
  object counts, compositional nonsense. These need the whole frame plus
  world-knowledge reasoning.

(Human Artifact Dataset / HADM, arXiv:2411.13842 — 37k annotated artifact
images across SDXL/DALL·E/Midjourney; the local/global split is their core
labeling scheme.)

### 2. The crop-and-zoom loop is the proven pattern

Every serious MLLM-based evaluator converges on the same loop:

- **ArtifactLens** (alphaXiv 2602.09475): per-defect-type *specialists*, each
  given a cropped region of interest ("deformed hands", "deformed face") via
  an object detector, binary verdict per crop, OR-aggregated. Counterfactual
  prompt pairs (artifact vs near-identical clean image) sharpen the VLM.
- **Q-DeepSight / Q-Probe** (arXiv:2604.16858, 2601.15356): interleaved
  think-with-image reasoning — the model decides *where* to zoom, inspects,
  then concludes. Warns of a real failure mode: naive cropping teaches a
  "cropped = degraded" bias, and depth-of-field gets misread as artifacts.
  Mitigate by always sending crops with context (padding) and asking
  explicitly "is this a defect or intentional styling/occlusion?"
- **VIEScore2** (arXiv:2610.00994): N×N grid defect localization — each cell
  is a verdict slot, so output is spatially grounded, not prose.
- **PAL4Inpaint** (arXiv:2208.03357): artifact segmentation → those regions
  become the *next inpaint mask* → iterate. The closed loop: detect →
  localize → treat → re-detect.

### 3. Hand-specific checking deserves its own pass

Hands are the #1 failure class and generic VLM prompts under-count them:

- **HandEval** (arXiv:2510.08978): hand quality is a distinct task; even SOTA
  T2I models produce "structurally distorted but texturally realistic" hands.
  Their fix: hand keypoint priors + paired high/low-quality hand crops.
- **MediaPipe Hand Landmarker** (Google, 21 keypoints/hand, runs CPU):
  cheap deterministic pre-check — if the landmarker can't find 21 plausible
  keypoints in a hand region, the hand is almost certainly broken. This is
  the strongest "numbers, not vibes" signal available locally and it's not
  yet wired into our pipeline.
- Prompt-side mitigation is cheaper: Animagine/SDXL respond to
  `bad hands, extra fingers, missing fingers, fewer digits` in the negative
  and to keeping hands large/simple in the positive.

### 4. Tiling/sliding-window for high-res outputs

When generating above ~1024px, industrial-inspection literature
(arXiv:2403.04932, 2508.12931, PCB tile-inference 2605.24726) is unambiguous:
**full-image downscale = resolution collapse; small defects vanish.** Tile
with ~20–25% overlap, score each tile, merge with neighbor-agreement to kill
boundary artifacts. For our 832×1216 portraits a 2×2 or 3×3 grid of ~400px
crops covers everything a 1216px-tall frame can hide.

### 5. What NOT to adopt on this rig

- Trained artifact detectors (HADM, DiffDoctor, HandEval weights) — GPU
  memory and training-data requirements exceed an 8 GB Pascal card's lane;
  they're reference architectures, not runnable tools here.
- Foundation-model "think with images" agents (Q-DeepSight) — needs a
  tool-using VLM frontier; gemma4:e2b can't emit crop coordinates reliably
  (observed: it returns prose findings, not bboxes, under `--mode ui`).

## Applied to this rig — the working recipe

What actually ran on 2026-11-13 against `animagine-xl` output:

1. **Full-frame pass** — `node tools/vision/analyze.mjs <img> --mode describe
   --model gemma4:e2b-it-qat --json`. Catches global issues, gives a first
   read. ~20 s.
2. **Region discovery** — direct Ollama `/api/generate` call asking gemma4
   for JSON bounding boxes of hands/face (`docs/scratch/find_regions.py`).
   NOTE: bbox accuracy is mediocre — treat returned boxes as *hints*, pad
   them generously, and always run a fallback grid crop.
3. **Zoomed defect pass** — `analyze.mjs --crop "x,y,w,h"` per region with a
   defect-specific prompt ("count digits per hand, flag fused/extra digits,
   skin/clothing seams"). Crops encode in-memory; no files are written.
   ~15–20 s per crop.
4. **Numeric sanity where possible** — pixel stddev in feature regions
   (flat grey = denoise too low, proven on the FLUX d0.60 failure), skin-tone
   delta vs reference for cast checks. Numbers beat VLM prose for pass/fail.
5. **Feed findings back as deltas** — every defect maps to a prompt tag or
   parameter, not a vibe: "fused fingers" → negative `fused fingers` +
   simpler hand pose; "warm cast" → negative `warm color shift`; "glossy"
   → negative `glossy skin`. One change per regeneration so attribution is
   clean.

### Confirmed prompting corrections (Animagine XL 4.0)

Research on the model card/campaign docs surfaced real mistakes in our
first prompts — worth correcting before the next generation:

- **Quality tags belong at the END**, and v4 uses **score tags**:
  `masterpiece, high score, great score, absurdres` — not `best quality,
  very aesthetic` (that was v3 guidance; v4 trains quality tags late in the
  sequence).
- **Canonical tag order**: `1girl/1boy, [character], [series], rating,
  general tags, quality tags`. We used `masterpiece...` first — suboptimal.
- **Rating tags exist**: `safe`, `general`, `sensitive`, `nsfw`, `explicit`
  go in the positive prompt and steer content rating deliberately.
- Our negative list was already close to canonical (`lowres, bad anatomy, bad
  hands, text, error, missing finger, extra digits, fewer digits, cropped,
  worst quality, low quality, low score, bad score, average score, signature,
  watermark, username, blurry`).

## Refinement loop (the closed cycle)

```
generate → full-frame QA → bbox regions → zoomed crops → defect list
   ↑                                                          │
   └──── map each defect to ONE prompt tag / param change ────┘
```

Stop conditions that keep the loop honest:

- One variable per regeneration (seed fixed) so improvements attribute.
- A frame passing every numeric check can still fail visually — the owner's
  eyes are the final gate (learned the hard way on the Maya laugh set:
  invariants all 0.0, style still rejected).
- Cap iterations; if round 3 doesn't beat round 2, the prompt family is the
  problem, not the wording.

## Sources

- HandEval — arXiv:2510.08978 (hand quality assessment, keypoint priors)
- HEIE hierarchical implausibility mapper — CVPR 2025
- HAD / Human Artifact Detection Models — arXiv:2411.13842
- ArtifactLens (specialist crops + counterfactual prompts) — alphaXiv:2602.09475
- Q-DeepSight think-with-image IQA — arXiv:2604.16858
- Q-Probe context-aware probing — arXiv:2601.15356
- VIEScore2 grid defect localization — arXiv:2610.00994
- PAL4Inpaint artifact segmentation → iterative inpaint — arXiv:2208.03357
- Tiled ensemble / scale-aware tile inference — arXiv:2403.04932, 2508.12931, 2605.24726
- MediaPipe Hand Landmarker docs — developers.google.com/edge/mediapipe
- Animagine XL 4.0 optimization guide — cagliostrolab.net (tag order, score tags, rating tags)
- OpenAI image-evals cookbook — developers.openai.com (hard-constraint vs perceptual split)

## Related

- [[animatediff-evolved-2026|animatediff-evolved-2026]] :cites
- [[comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026|comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026]] :extends
- [[higgsfield-comfyui-challenge-2026|higgsfield-comfyui-challenge-2026]] :extends
