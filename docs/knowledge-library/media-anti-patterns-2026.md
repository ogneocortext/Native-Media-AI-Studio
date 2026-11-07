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
> Amended the same day by an alignment pass against current
> vendor documentation and practitioner research (§13 lists
> the basis): per-model negatives, the expired typography
> ban, temporal video tells, Suno v5-line field findings, and
> new UI / voice / social sections.

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
6. **Grade the result** against §12 before presenting it as
   done. A failing result gets one targeted revision naming
   the single thing to change; a second failure means
   re-brief (change medium or composition), never re-roll.

The mechanism has a name in the current literature:
Anthropic's prompting guidance calls it **distributional
convergence** — safe choices dominate the training data, so
an unguided model regresses to them. Two corollaries the
alignment research added: **volume is itself a tell** (slop
is "produced usually in quantity" — a flood of unreviewed
output reads as slop regardless of per-piece quality), and
**universal ban lists converge too** — a fixed anti-slop
aesthetic (the cream-and-serif look currently sweeping AI
frontends) becomes the next slop cluster. The durable fix is
a *project-owned* spec — which is what this studio's style
records and budgets already are. This canon names patterns;
the project's own specs outrank it wherever they speak.

## 2. Defect negatives ≠ pattern negatives

`prompt-engineering.md`'s universal negative string fights
**defects** (ugly, blurry, deformed, watermark). Keep it —
but know its limit: a technically flawless render can still
be pure slop. **Pattern negatives** fight the aesthetic
tells below (glow wash, bokeh filler, average composition).

**But negative prompting is now per-model** (verified
against vendor documentation in the 2026-11-07 alignment
pass) — the "one universal negative" era is over:

| Surface | Negative support | Current practice |
|---|---|---|
| SDXL / SD-class (ComfyUI) | Real negative field | Keep it short and concrete; both classes |
| Midjourney | `--no` parameter (≈ −0.5 weight) | 3–5 concrete terms, no strings |
| FLUX.2 / FLUX 3 (BFL) | **Not supported** — FLUX 3 has no negative field at all | Positive specification only |
| Gemini / GPT Image | No negative field | **Semantic negatives**: describe the absence positively ("empty, deserted street", not "no cars") |
| Runway Gen-4/4.5 | Vendor warns negatives "may result in the opposite happening" | Positive phrasing only |
| Kling | In-prompt negatives (legacy API field) | State exclusions inside the prompt |
| Veo (API) | Field exists | Google still teaches positive reframing as the default |

Where a surface takes no negatives, the AVOID list moves
into the positive brief as decided presences and semantic
absences — the discipline survives the mechanism.

## 3. Cross-medium patterns

| Pattern | Why it reads as slop | The replacement move |
|---|---|---|
| Adjective stacks ("cinematic, epic, stunning, dramatic lighting") | Adjectives are averages wearing perfume; the model hears the category, not a decision | Replace each adjective with the decision it was hiding: lens, light direction, palette token, era, budget |
| Naming a decade or genre as the whole brief | Returns the genre's poster, not its traits | Name 3–5 concrete traits (instruments, materials, typography era, light) and let the era emerge |
| Copying the tool's demo/showcase look | The demo is the mean by design | Anchor on a reference (an image, a track, a style record) and state what transfers |
| Unspecified framing | Default center-subject, default aspect, default depth | State the crop, the aspect, and what the empty space is for |
| "High quality / detailed / 8k" filler | Quality tokens add no information the model can spend | Spend the tokens on medium, texture, and the AVOID list instead |

## 4. Image patterns

Each pattern below is a tell as an *unmotivated default*;
the same element, decided and placed, is craft — Google's
own model examples use neon, bokeh, and flare on purpose.
The pattern is reaching for them without a reason.

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
- **Long or load-bearing text from the image model.**
  Amended 2026-11-07: the blanket ban expired. Current
  text-strong models (Nano Banana Pro, GPT Image, Ideogram,
  FLUX.2-flex) render short quoted, placed text reliably —
  one 200-prompt test put short phrases near 100% and
  sub-15-word sentences near 95%, degrading past ~30 words;
  Midjourney remains weak at text. Rule: short placed text
  is permitted on text-strong models; paragraphs, prices,
  and brand-critical type are still set in layout.
- **The generic AI face/character** (the one in
  `character-driven-visualization-research`'s negative list):
  symmetric, airbrushed, ageless. Replacement: the character
  pipeline's identity rules — asymmetry, age, wear, a
  decided face.
- **Waxy/plastic skin and the house gloss** — the current
  models' default finish (pore-less skin, everything
  slightly lacquered, oversaturated teal-orange grade).
  Replacement: name the finish (matte, film grain, a
  decided grade) — the medium decision of §1 again.
- **Functional implausibility** — the most prevalent and
  least noticed tell class in current studies (a cited CHI
  2025 analysis puts it in ~59% of AI images): objects that
  could not work — impossible shadows, wrong reflections,
  tools with no mechanism, text-like signage. Faces, by
  contrast, are now near chance-level as a tell.
  Replacement: the grading pass checks *plausibility*, not
  just prettiness (§12, question 6).

## 5. Video & motion patterns

The current framing is **temporal**: any single frame can
pass while the clip fails — identity drift across frames,
texture swimming, background morphing, objects losing
permanence, physics and cadence errors. Grade motion as
motion. Vendor formulas have also converged (Veo:
cinematography + subject + action + context + style;
Runway's image-to-video rule below) — and two currency
notes from the alignment pass: **Sora is discontinued**
(app/web April 2026, API September 2026) and **AnimateDiff
is legacy** in the open stack, whose center is now Wan 2.x
and HunyuanVideo 1.5; native audio/dialogue is a first-class
prompt slot on current video models.

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
- **Re-describing the image in image-to-video.** Runway's
  Gen-4 guidance (verified in the alignment pass): the
  prompt describes **motion only** — start with one essential
  motion, add one element at a time, one scene per clip.
  Cross-model rule: one camera move + one subject action per
  shot, action in timed beats; reference ingredients /
  first-and-last-frame are the pro workflow, not prose.

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
- **Field indiscipline on current Suno (v5-line findings,
  alignment pass):** the style field is **front-weighted** —
  the first descriptor dominates, so order is a decision;
  layer 1–2 genre tags at a time (Suno's own guidance)
  rather than dumping the pile; the dedicated **Exclude
  Styles** field is more reliable than inline "no X";
  BPM now lands within roughly ±3, so tempo asks are
  honest numbers, not wishes.

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
- The stakes are measured, not aesthetic: in a 2025 listener
  study, **lyric songs were the easiest AI music to unmask
  (~75%)** — lyric slop is the most detectable slop this
  studio ships. Production-side tells compound it: missing
  or evenly-spaced breaths, smeared sibilants, uniform
  reverb distance — the mix decisions of the finishing stage
  are anti-pattern work too.

## 9. UI & frontend patterns

Added in the alignment pass — the best-documented slop
domain of all, previously missing here:

- **The default AI frontend**: Inter for everything, purple
  gradient accents, identical rounded cards in a row, dark
  hero with an aurora glow. It is distributional convergence
  with a CSS file. Replacement: the project's own type,
  palette, and component decisions — the brand kit and style
  records are exactly this spec.
- **Template sameness**: every section the same rhythm
  (heading, three cards, CTA). Replacement: information
  decides layout; a page whose sections are interchangeable
  has no decisions in it.

## 10. Voice & TTS patterns

- **The stability trade-off ignored**: high stability reads
  flat and robotic; low reads chaotic — the default middle
  is neither directed nor natural. Replacement: set the
  voice parameters per piece, like a casting decision.
- **Prose read aloud**: text written for the eye (long
  subordinate sentences, parentheticals) trips every TTS.
  Replacement: script for the ear — short breath units,
  spoken contractions — and a full listen-through before
  shipping, the audio equivalent of the say-it test.

## 11. Social, thumbnails & platform enforcement

- **Thumbnail sameness** — shocked face, red arrow, yellow
  text: the feed's own average, and the owner's long-standing
  complaint about misleading packaging made formal. The
  house thumbnail is a decided frame from the work, type set
  in layout (§4's rule), no borrowed outrage.
- **Platforms now enforce an operational definition of
  slop**: YouTube's "inauthentic content" policy (renamed
  July 2025) demonetizes generic, unoriginal AI templates;
  Deezer tags AI tracks and de-recommends them (~90k AI
  uploads/day by mid-2026, over half of intake, at 1–3% of
  streams). Mass-templated output is not just an aesthetic
  failure — it is a distribution failure.
- **Provenance is part of shipping**: SynthID-class
  watermarking and platform AI labels are the default
  expectation; plan disclosure in the brief, not as an
  afterthought.

## 12. The grading checklist

Before any media result is presented as done, six questions:

1. Could this be **any** tool's stock output for the category?
2. Count the **glow effects**. Is each one decided?
3. Is a **human decision visible** — crop, restraint, medium,
   palette — or only competence?
4. Does it use the **house palette / active style record**, or
   the platform defaults (cyan-magenta on dark blue-purple
   is the #1 palette tell)?
5. Can the brief's **AVOID list** be pointed to in the result
   — i.e., is it actually absent?
6. Would the things in it **actually work** — shadows,
   reflections, mechanisms, physics plausible (§4)?

Any "no" → §1 rule 6: one targeted revision, then re-brief.

## 13. How this doc is referenced

Pattern lists live **here only**. Other docs point (one line,
in the relevant section) rather than copying subsets — copies
drift. The style system's §4 remains the governing statement
for style records and cross-references this canon for the
per-medium lists. Pointer rollout + workflow surface fixes:
T-VID-25 steps 2–3.

**Alignment-pass research basis (2026-11-07):** Anthropic
Claude Cookbook prompting guidance (distributional
convergence); Black Forest Labs FLUX prompting documentation
(visible-only specification, negative support); Google's Veo
3.1 and Gemini image prompting guides (formula, semantic
negatives, text-in-image); Runway Gen-4 guide (motion-only
image-to-video); Kobak et al., *Science Advances* 2025
(excess-vocabulary measurement); Wikipedia, "Signs of AI
writing" (living catalogue); Suno v5-line field guides
(front-weighting, Exclude Styles, BPM accuracy); Deezer and
YouTube policy reporting (AI-track volume, inauthentic-content
enforcement). Full working notes live outside the repo with
the research agent's session files; claims above are stated
at the strength the sources support.
