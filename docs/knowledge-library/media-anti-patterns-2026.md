---
title: "Media Anti-Patterns — The Slop List and Its Replacements 2026"
date: 2026-11-07
type: concept
tags:
  - production
  - ai
  - video-generation
aliases:
  - Media Anti-Patterns 2026
  - Anti-Slop Canon
cssclasses:
  - production-guide
---

# Media Anti-Patterns 2026

> The canonical anti-pattern reference for all media work in
> this studio, written 2026-11-07 as step 1 of T-VID-25,
> closing the gap measured in
> [[media-anti-patterns-audit-2026]]. It carries the owner's
> governing rule into the library his executors actually read:
> **avoiding AI slop patterns goes through everything.**

## 1. The mechanism — slop is a specification failure

Slop is not a model failure. An underspecified brief returns
the category average, and average reads as generic. Every
dimension the brief leaves open — medium, composition, light,
palette, texture, motion — is a decision the model makes at
the mean of its training data. The fix is never a better
adjective; it is a decision, stated.

**The discipline (every media brief, every medium):**
1. Name a **medium with physical constraints** (risograph,
   film stock + lens, flat illustration, a named render
   budget) — not a vibe.
2. Decide **composition** up front: one focal idea; negative
   space with a stated job.
3. Cap the **palette** (house kit / the active style record;
   ≤5 colors doing work).
4. Specify **texture** (grain, halftone, misregistration,
   dust — or its deliberate absence).
5. Carry an explicit **AVOID list** into the brief, the
   prompt, and the negative prompt — every time.
6. **Grade the result** against §9 before presenting it as
   done. A failing result gets one targeted revision naming
   the single thing to change; a second failure means
   re-brief (change medium or composition), never re-roll.

## 2. Defect negatives ≠ pattern negatives

`prompt-engineering.md`'s universal negative string fights
**defects** (ugly, blurry, deformed, watermark). Keep it —
but know its limit: a technically flawless render can still
be pure slop. **Pattern negatives** fight the aesthetic
tells below (glow wash, bokeh filler, average composition).
A complete negative carries both classes.

## 3. Cross-medium patterns

| Pattern | Why it reads as slop | The replacement move |
|---|---|---|
| Adjective stacks ("cinematic, epic, stunning, dramatic lighting") | Adjectives are averages wearing perfume; the model hears the category, not a decision | Replace each adjective with the decision it was hiding: lens, light direction, palette token, era, budget |
| Naming a decade or genre as the whole brief | Returns the genre's poster, not its traits | Name 3–5 concrete traits (instruments, materials, typography era, light) and let the era emerge |
| Copying the tool's demo/showcase look | The demo is the mean by design | Anchor on a reference (an image, a track, a style record) and state what transfers |
| Unspecified framing | Default center-subject, default aspect, default depth | State the crop, the aspect, and what the empty space is for |
| "High quality / detailed / 8k" filler | Quality tokens add no information the model can spend | Spend the tokens on medium, texture, and the AVOID list instead |

## 4. Image patterns

- **Neon glow wash on a dark cosmic background** — the #1
  tell. Replacement: a named light source in a place, or the
  flat disciplines of Analog Print / Monochrome Signal.
- **Bokeh and particle filler** — depth and magic faked with
  blur dots. Replacement: real depth (foreground/mid/back
  decisions) or honest flatness.
- **Lens flare as decoration.** Replacement: flare only when
  the scene's light earns it — which is almost never.
- **Floating-in-void product/subject shots.** Replacement: a
  ground, a surface, a shadow — a place.
- **Typography from the image model.** Replacement: compose
  text in layout afterward, always.
- **The generic AI face/character** (the one in
  `character-driven-visualization-research`'s negative list):
  symmetric, airbrushed, ageless. Replacement: the character
  pipeline's identity rules — asymmetry, age, wear, a
  decided face.

## 5. Video & motion patterns

- **Gradient-wash skies and backgrounds.** Replacement: flat
  banded fields or a real environment (see Vice Sunset's
  redesign in [[visual-style-system-2026]] §3.3 — the worked
  example of a pattern rebuilt into a look).
- **Default bloom on everything emissive.** Replacement:
  bloom as an accent with a threshold, per the style record.
- **The vaporwave checklist** — outrun sun disc, chrome grid
  floor, palm silhouettes, neon signage. Banned by name in
  house work.
- **Unmotivated camera moves** (the slow push-in on nothing).
  Replacement: a move per decision — track the subject, reveal
  the information, or hold still.
- **Visualizer wallpaper** — generic spectrum bars + glow as
  a finished visual. Replacement: the measured-bands
  discipline (real per-band data, a style record's motion
  character) — motion that shows the music, not a screensaver
  near it.
- **AI-skin smear accepted unchecked.** Replacement: the
  frame-package contract (depth/normals/ID/pose) verified per
  [[3d-bones-ai-skin-pipeline-2026]] before skin is trusted.

## 6. 3D patterns

- **Unbudgeted generation accepted as-is** — whatever face
  count/texture size the generator felt like. Replacement:
  the Pascal budget discipline (draw calls, tris, KTX2
  residency) and T-VID-12's flat target.
- **Textureless plastic presented as a look.** Replacement:
  material decisions within the five-scalar ceiling (or a
  named map), per the scene-vocabulary work (T-VID-18).
- **Floating objects, absent scale.** Replacement: ground
  contact, a human-scale reference, consistent meters.
- **The demo-asset silhouette** (the generator's default
  humanoid/prop). Replacement: silhouette decided in the
  brief; HouseRig proportions for characters.

## 7. Music patterns (Suno)

- **Style-box adjective stacks** — same disease as §3, in
  the style field. Replacement: the canonical tag set —
  genre anchors, instrumentation, vocal profile, production
  character, numeric BPM/key where the model takes them.
- **Decade pastiche** — naming "80s" buys the poster.
  Replacement: trait anchors (the energy canon's method:
  Pendulum/Prodigy/NFSU2 as *trait sources*, 2020s spin).
- **Instruction text in the lyrics field** — v6-mini sings
  everything in that field, literally (a scar, not a theory:
  it ruined a take). Instructions live in the style field
  and the session notes, never the lyrics.
- **Contradictory tag piles** (every genre the track might
  be). Replacement: one primary genre claim + one influence,
  decided.
- **Model-vocabulary smuggling** — one platform's prompt
  language pasted into another's brief. Style descriptors
  are model-specific; translate traits, never wording.

## 8. Lyric patterns

- **Stock AI phrases in hooks** — "neon light" is the flagged
  specimen; the class is any phrase that could open ten
  thousand generated songs. Hooks get the smallest
  consonant-cluster budget *and* the strictest originality
  check.
- **Generic genre-draft situations** — the song about
  "chasing dreams" that belongs to no one. Replacement:
  relatability first — the writer's actual specifics,
  situation generalized, voice/texture kept.
- **Burned imagery reused past its life** — the retired set
  (2 AM / cold coffee / humming fans) stays retired; mine
  fresh material, recent weeks first.
- **Slogan hooks and earnest anthemic uplift** as the default
  register. The house register is dry, deadpan, skeptical —
  uplift is a deliberate exception, never the mean.
- **Diary-entry specifics** that make a song unusable in
  public. Generalize the situation; keep the texture.

## 9. The grading checklist

Before any media result is presented as done, five questions:

1. Could this be **any** tool's stock output for the category?
2. Count the **glow effects**. Is each one decided?
3. Is a **human decision visible** — crop, restraint, medium,
   palette — or only competence?
4. Does it use the **house palette / active style record**, or
   the platform defaults (cyan-magenta on dark blue-purple
   is the #1 palette tell)?
5. Can the brief's **AVOID list** be pointed to in the result
   — i.e., is it actually absent?

Any "no" → §1 rule 6: one targeted revision, then re-brief.

## 10. How this doc is referenced

Pattern lists live **here only**. Other docs point (one line,
in the relevant section) rather than copying subsets — copies
drift. The style system's §4 remains the governing statement
for style records and cross-references this canon for the
per-medium lists. Pointer rollout + workflow surface fixes:
T-VID-25 steps 2–3.
