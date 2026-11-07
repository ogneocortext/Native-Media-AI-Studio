---
title: "Media Anti-Patterns Audit — Does the Library Teach Slop-Avoidance? 2026"
date: 2026-11-07
type: synthesis
tags:
  - production
  - ai
  - video-generation
aliases:
  - Media Anti-Patterns Audit 2026
cssclasses:
  - production-guide
---

# Media Anti-Patterns Audit 2026

> Written 2026-11-07 at the owner's request ("investigate the
> need to add anti-patterns into docs so media work avoids
> low-effort AI slop"), under his governing rule of the same
> night: avoiding AI slop patterns goes through everything.
> Method: full-text measurement of the library and the
> generation surfaces, not impressions.

## 1. The verdict

**The need is real, and it is not close.** The library teaches
generation *capability* in depth and slop-avoidance almost
nowhere. An agent who learned media work from these docs alone
would produce competent, generic output — the category average
in every medium — because the docs specify what to make and
almost never what to refuse.

## 2. Measured coverage

- **49** library docs carry media tags (`video-generation` /
  `comfyui`). Only **17** contain any avoid-language at all;
  **32 contain none** — including generation-front-door docs:
  `3d-generation-options`, `text-to-3d-options`,
  `animatediff-evolved`, `higgsfield-comfyui-challenge`.
- Exactly **one** doc in the library carries a named
  anti-pattern list: `character-driven-visualization-research`
  (negative prompts for generic AI characters).
- The word **"slop"** appears in **zero** media docs before
  tonight (the tree's other hits are "slope" false positives
  and one external anti-slop UI reference in
  `design-philosophy-2026`).
- The owner's actual anti-slop doctrine — name a medium with
  physical constraints, decide composition, cap the palette,
  specify texture, carry an explicit AVOID list, grade against
  the checklist — lives **outside the repo** (his standing
  instructions to his research agent). The agents who execute
  media work from these docs never see it.

## 3. What exists, and why it isn't enough

- **`prompt-engineering.md` §Negative Prompts** — a universal
  negative string plus genre negatives. These are *defect*
  negatives (ugly / blurry / deformed class): they fight
  rendering errors, not aesthetic tells. A flawless, sharp,
  well-formed image can still be pure slop — defect negatives
  say nothing about glow washes, bokeh filler, average
  composition, or adjective-stack prompting.
- **The style system's §4** (tonight) — anti-patterns for
  *visual style records* specifically, with the governing
  rule. One surface of five.
- **Session-level practice** — Suno packages carry Exclude
  Styles; the lyric rules ban stock phrases ("neon light")
  and burned imagery. Both live in session files and agent
  memory, not in the library an executor reads.

## 4. The surfaces confess

The repo's three ComfyUI workflows (`config/comfyui/workflows/`)
ship with **positive prompts only and no negative prompt at
all** — and the positives are themselves the pattern the
doctrine forbids: short adjective stacks ("cinematic music
video scene, camera movement, dramatic lighting"). The
generation surface an agent is most likely to copy is,
verbatim, an example of the failure mode.

## 5. The patterns the canonical doc must name (by medium)

Preview of the rollout's content — each pattern paired with
its specification move, because slop is a specification
failure, not a model failure:

- **Cross-medium:** adjective stacks instead of decisions;
  unspecified dimensions (medium, light, composition,
  palette) defaulting to the category average; "cinematic /
  epic / stunning" as load-bearing words; copying a genre's
  poster instead of its traits.
- **Image:** neon glow wash on dark cosmic backgrounds;
  bokeh/particle filler; lens flare; floating-in-void product
  composition; typography asked of the image model.
- **Video / motion:** gradient-wash skies; default bloom;
  camera moves with no motivation; the vaporwave checklist
  (outrun disc, grid floor, palm silhouettes) — §3.3 of the
  style system is the worked example.
- **3D:** unbudgeted generation accepted as-is (the flat
  50k-face target T-VID-12 exists to kill); textureless
  plastic as a finished look; scale/grounding absence.
- **Music (Suno):** era pastiche from naming a decade instead
  of traits; style-box adjective stacks; instruction text in
  the lyrics field (sung literally — a scar, not a theory).
- **Lyrics:** stock AI phrases in hooks ("neon light" is the
  flagged specimen); generic genre-draft situations instead
  of the writer's actual specifics; burned imagery reused
  past its life.

## 6. Rollout shape (registered as T-VID-25)

1. **One canonical doc** — `media-anti-patterns-2026`:
   the per-medium lists above, fully written, each pattern
   with its replacement move. Single source, per the
   library's convention.
2. **Pointers, not copies** — the generation-front-door docs
   (ComfyUI workflows, 3D generation, Hunyuan, AnimateDiff,
   prompt-engineering, character pipeline, bones/skin) each
   gain a one-line pointer to the canonical doc;
   prompt-engineering's section gains the defect-vs-pattern
   distinction.
3. **Surface fixes** — the three workflows get real negative
   prompts and decision-led positives (executor lane, proven
   on the rig); docs follow the surfaces, not the reverse.

Until step 1 lands, this audit is the library's only
map of the gap — and the governing rule (§4 of
[[visual-style-system-2026]]) is the standing instruction.
