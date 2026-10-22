---
tags:
  - production
  - audio
  - visualization
aliases:
  - Storyboard Enrichment
  - Track-Practice Storyboard Rules
cssclasses:
  - production-guide
date: 2026-10-22
type: concept
---

# Storyboard Enrichment — Track-Production Practice as Storyboard Data

> [!info] Purpose
> Design note (2026-10-22, owner-requested) for growing the studio's
> storyboard system from a theme-driven scene generator into a
> track-driven one. The rules below are not theory: each was learned
> producing a real music video by hand (the "Unproductive" V5 cut,
> Oct 2026) and is stated with its evidence. The lyric library the
> owner built with his research agent is inventoried in §4 as the
> storyboard source data this design consumes. Scoped build steps live
> in `docs/plans/next-actions-2026-10.md`, Step 5.

## 1. Where the storyboard system stands

- **Generator** — `packages/backend/app/services/storyboard_generator.py`:
  an Ollama job whose entire input is `theme` + `num_scenes` + `model`.
  It returns generic `scenes` JSON (style, transitions, estimated
  durations). No track, analysis, or lyric data enters the job.
- **Compiler** — `packages/backend/app/services/storyboard_hyperframes.py`:
  storyboard → HyperFrames is wired and exposed in the Storyboard page
  ("Compile HyperFrames"). The utilization audit's remaining gap: a
  preview action and optional asset/caption mapping, after validating
  real storyboard payloads.
- **Production boards** — `docs/visual-storytelling/` holds the playbook
  and per-track boards. The most developed (Still I Rise) keeps a
  BPM/energy analysis JSON and a Whisper timing JSON beside the board.
  That pairing — analysis + transcription next to the board — is the
  seed of this design; the gap is that nothing in the *system* produces
  or consumes it.

## 2. Practice rules (evidence from the Unproductive production)

**R1 — A board's tempo is a measured beat grid, never metadata.**
On Unproductive, three numbers claimed to be the tempo: the lyric
library's `bpm: 136` (its own note: "Target was 126; rendered at a
stable 136"), the audio analyzer's 123.0, and the hand-measured truth
for the render actually cut, **126.0 BPM**. The board must carry a
verified grid plus a conflict flag when sources disagree, and panel
timing anchors to the grid — not to estimated durations.
(Complements the parked madmom A/B: `beat_confidence()` measures grid
regularity, not accuracy; a board needs the accuracy-checked number.)

**R2 — Panels derive from what is actually sung, not the lyric sheet.**
The Valley Phonk lyric set contains a written Bridge (4 lines). In the
Extended V2 render used for the video, that bridge is **not sung** — it
earned no panels and no on-screen text. Rule: lyric mapping consumes a
transcription (Whisper, as Still I Rise already keeps) diffed against
the lyric sheet; sheet-only sections are marked `not_sung` and produce
nothing visual.

**R3 — Character lock is board data, and the character stays off-axis.**
The V5 cut locked its character (Sol) from a single portrait reference;
every character panel was generated image-to-video anchored to it, and
identity held across locations (monsoon, Route 66) against a checklist:
freckles, sunglasses, hoop earring. The board therefore carries, per
character: the reference asset, the identity checklist, and the
**off-axis rule** — the character never faces camera head-on in
performance shots. (Storyboard-first replaced lip-sync on this project
after a mock lip-sync demo rendered silent video; fake sync is the
failure the off-axis rule exists to avoid.)

**R4 — Panels are planned as coverage, with framing recorded.**
V5 intercut wides (place) with mediums (character); the mediums were
portrait generations (768×1152) cropped to 16:9. The board records per
panel: intended framing (wide / medium / close), source aspect, and
crop intent — decisions that previously lived only in the editor's
head and had to be re-derived at assembly.

**R5 — Panels have states, and rejection is normal data.**
One generated panel (neon dance) rendered as generic Chinatown instead
of Arizona and was dropped. Panel lifecycle: `planned → generated →
accepted | rejected(+reason)`, with a conformance check against the
board's place/theme before acceptance. The vision-critique loop for
that check is the local VLM route chosen 2026-10-22 (Gemma 4 E2B via
Ollama; see `video-to-glsl-shader-recreation-2026.md` §4 for the
cost-routing pattern it follows).

**R6 — Musical accents and assembly accounting are board/compiler data.**
Biggest visual changes land on the major hooks; V5's peak sections
carried a 2.5% beat-pulse zoom on every kick, phase-aligned to the
grid. Those accents belong on the board, not in assembly-time memory.
And the compiler's manifest must carry **absolute start times computed
from the beat grid on the input timeline**: V5's two real assembly
bugs were a pulse filter that needed per-frame evaluation and a
slow-mo applied to output timestamps, which shifted every later cut
and lyric. A frame-verification pass at panel boundaries (rendered
frame vs board expectation) is part of "done", not an extra.

## 3. Contract sketch (for the implementing agent to finalize)

Generator job params grow from `{theme, num_scenes, model}` to accept:

- `track_lyrics_id` — an entry from the track-lyrics library (§4)
- `analysis` — measured BPM + beat grid + section boundaries, with the
  R1 conflict flag when metadata disagrees
- `transcript` — Whisper segments; drives the R2 sung/not-sung diff
- `characters[]` — reference asset + identity checklist + off-axis (R3)
- `place_theme` — the conformance target for R5

Scene objects grow: `section` (name from the lyric set), `lyric_lines[]`
(refs into the library entry), `start_beat` / `end_beat` (grid-anchored,
absolute times derived), `framing`, `source_aspect`, `character_ref`,
`accent` (e.g. beat-pulse), `state`, `reject_reason`. The HyperFrames
compiler consumes the same fields; its manifest emits the absolute
times R6 requires.

## 4. The lyric library as storyboard source data

Canonical text lives in `packages/frontend/public/track-lyrics/`
(`index.json` + one JSON per track; loader
`packages/frontend/src/data/trackLyrics.ts`). Eight tracks, 268 lines
(six at first writing; The Last Original's two sets were captured
from Suno later the same day — see the gap note below). A second
capture the same day added three more tracks the owner named from
the library inventory (Stay Until the Lights Come On, Prototype
Heart, Out for Delivery) and the two early Rinse and Repeat
renders, bringing the library to eleven tracks, 384 lines, and
25 renders with per-render prompts,
all `lyricsStatus: complete`, **none with an LRC** — the loader spreads
lines evenly across `durationSec` as *estimated* timing. Per the
manifest's own warning, that estimate is preview-only, never a render
source; R1/R2 data supersedes it per track as it is produced.

| Track (library id) | Source | Dur | BPM (as filed) | Sections / lines | Storyboard notes |
|---|---|---:|---:|---|---|
| Unproductive (Valley Phonk) (`unproductive-valley-phonk`) | Flow Music (Lyria 3.5) v1 | 2:47 | 136 — note: "target was 126" (R1 conflict, see §5) | 8 / 32 | Hook: "Nothing to prove today". Bridge written, **not sung** in the Extended V2 render (R2). The V5 video's track — worked example, §5. |
| Unproductive (`unproductive-v6-mini`) | Suno v6-mini | 3:00 | 140 (lyric-sheet tag) | 11 / 38 | Cleaned non-phonk set; two renders lyric-identical. Has a Post-Chorus / Drop (2 lines, "Unproductive and free-ee-ee") — the accent slot R6 targets. |
| Rinse and Repeat (`rinse-and-repeat`) | Suno v6-mini | 3:29 | 130 (V3 preferred; V1/V2 rendered at 115 — same lyrics, two grids) | 6 / 35 | Verses split `[Verse - male]` / `[Verse - female]`: vocal handoffs are coverage cues (R4) — cut or reframe on the handoff. Hook: "Ten channels, one thread, same screenshot on the screen". |
| Human in the Loop V2 (`human-in-the-loop-v2`) | Flow Music (Lyria 3.5) | 4:06 | 145, C minor | 12 / 39 | Build-up sections ("YOU GLITCH") precede each hook return — pre-marked accent points. A Whisper transcript diff for the Suno render exists in the Suno goal files; the R2 diff has a head start here. Hook: "You glitch, I bleed". |
| Ad Nauseam (`ad-nauseam`) | Suno v6-mini | 3:29 | 145 | 5 / 34 | V1/V2 lyric-identical (one file covers both). Male/female verse split like Rinse and Repeat. Hook: "Is it real or is it fake, I can't tell anymore". |
| Patch Notes (`patch-notes-v3`) | Suno v6-mini | 3:04 (v3.5; v3 is 2:53) | 150 — stated in both renders' style prompts (2026-10-22 capture); unmeasured | 7 / 38 | v3/v3.5 lyric-identical, but made with different prompts (both now on file in the library entry). Chorus is 8 lines ("These are my patch notes") with a 4-line Drop Hook — hook weight is measurable from the sheet alone. Still needs its R1 measured grid. |

**The Last Original — gap closed 2026-10-22.** At first writing, its
two lyric sets existed only as Suno pages. They were captured the same
day (read-only pass, like 2026-09-30's) and now live in the library as
`the-last-original-v1.json` (set 1: V1/V1.2, 25 lines) and
`the-last-original-v2.json` (set 2: V2/V2.2, 27 lines). All four renders
share one style prompt — the exception to the library's usual pattern,
found in the same capture, that paired renders carry *different*
prompts (Ad Nauseam, Patch Notes, Rinse and Repeat, Unproductive,
Human in the Loop, and all four Valley Phonk renders each have
per-render prompts, now stored in every entry's `renders[]`).

## 5. Worked example — Unproductive, Extended V2 (the V5 cut)

The render actually cut: Suno "Unproductive (Valley Phonk) Extended
V2", 240.0 s, **hand-measured 126.0 BPM** (analyzer 123.0; library
entry 136 for the shorter Flow v1 render — three numbers, one song
family; R1 exists because of exactly this). Night-drive direction:
desert highways, Phoenix skyline, neon, palm trees. Section map from
the phonk lyric set (32 lines), as storyboarded:

| Section | Lines | Board treatment (what V5 did) |
|---|---|---|
| Intro | 1 | Wide — Valley establish, no character |
| Verse 1 | 7 | Wides + first Sol mediums (off-axis, R3) |
| Hook | 4 | Largest visual change (R6): new location, pulse on |
| Verse 2 | 7 | Coverage alternates; monsoon sequence |
| Hook | 4 | Route 66 Sol panels, identity checklist verified |
| Bridge | 4 | **`not_sung` in this render (R2)** — no panels, no text |
| Hook | 4 | Peak: beat-pulse 2.5%/kick, phase-aligned cuts |
| Outro | 1 | Wide pull-back, "Unproductive... and free" |

Plus the R5 receipt: one generated panel rejected (neon dance →
generic Chinatown, wrong place) and the R6 receipts: both assembly
bugs (per-frame pulse evaluation; output-timestamp slow-mo shifting
later cuts) were caught by frame verification at panel boundaries
before delivery — the delivered cut's boundaries were verified, which
is why the verification pass is in the rule and not optional.

## 6. Sequencing

Scoped build steps: `docs/plans/next-actions-2026-10.md` Step 5
(S1–S5). This doc is the design source; the playbook in
`docs/visual-storytelling/VISUAL_STORYTELLING_2026.md` remains the
craft reference and is not superseded by it.
