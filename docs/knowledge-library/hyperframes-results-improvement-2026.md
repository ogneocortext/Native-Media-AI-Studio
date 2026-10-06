---
tags:
  - technical
  - creative
  - performance
aliases:
  - HyperFrames Results Improvement 2026
  - HyperFrames Render Quality Fixes
  - HF Quality Audit
cssclasses:
  - technical-guide
date: 2026-10-06
---

# HyperFrames Results Improvement — Audit Findings & Fix Specs

> [!info] Purpose
> Handoff for the implementing agent. On 2026-10-06 the user reported weak
> results from the studio's HyperFrames path. Orion audited the compiler
> (`packages/backend/app/services/storyboard_hyperframes.py`), the render API
> (`packages/backend/app/api/hyperframes.py`), and the upstream
> `heygen-com/hyperframes` repo (Apache-2.0, v0.8.73+ era). Findings are
> ordered by expected impact on output quality. Each carries file:line evidence
> per the repo's "state the evidence" rule — verify by snapshot, not by
> re-reading: `npx hyperframes snapshot . --at 0,5,15,30` before and after each
> fix, and compare bass-hit frames specifically.

> **Prerequisites:**
>
> - [[hyperframes-audio-reactive-2026]] — the audio-reactive contract this audit is measured against
> - [[lyric-beat-visualization-2026]] — LRC/lyric timing data contracts
> - `docs/architecture/decision-log.md` — do not re-litigate D-decisions; these are fixes inside the existing architecture

---

## F1. Frequency bands are synthesized, not measured (highest impact)

**Evidence:** `packages/backend/app/services/storyboard_hyperframes.py:89`

```python
band_values = [max(0.0, min(1.0, energy * (1.0 - band / (bands * 1.6)))) for band in range(bands)]
```

All 16 `bands[]` are a deterministic falloff from a single per-frame `energy`
scalar. There is no spectral analysis anywhere in the payload path. A kick
drum and a hi-hat produce the identical band shape at different amplitudes, so
no composition can ever react to bass vs. treble — the core promise of the
audio-reactive contract in [[hyperframes-audio-reactive-2026]] §1 is unmet.

**Impact:** Every "audio-reactive" visual is really just energy-reactive with
a fake spectral gradient. Bass-pulse, treble-glow, and band-mapped effects all
move together, which reads as flat and generic no matter how good the art
direction is.

**Fix spec:**
1. Replace the synthetic falloff with measured per-frame band amplitudes.
   Two in-repo sources already exist — use one, do not build a third:
   - `packages/backend/app/services/audio_analyzer.py` already computes
     librosa spectral features (centroid, rolloff, bandwidth). Extend the
     frame loop to emit N log-spaced band magnitudes from the STFT, or
   - the HyperFrames skill's bundled `extract-audio-data.py`
     (`<HF_SKILL_DIR>/scripts/extract-audio-data.py input.mp3 -o audio-data.json --fps 30 --bands 16`).
2. Normalize each band independently across the full track (0–1), matching the
   contract in §1.2 of the audio-reactive guide.
3. Keep `build_hyperframes_audio_payload()`'s signature; the `bands` parameter
   already exists. The synthetic falloff may remain as an explicit
   `synthetic=True` fallback for when no audio file is present — never as the
   default when audio exists.

**Verify:** render a track with isolated kick vs. hat sections; snapshot the
bass-mapped element at a kick frame and a hat frame. Before the fix the two
frames are indistinguishable; after, they must differ.

---

## F2. Per-frame tweens smear instead of snapping

**Evidence:** `packages/backend/app/services/storyboard_hyperframes.py:112`
(generated `<script>` block):

```js
tl.to('.motif', {scale: ..., opacity: ..., boxShadow: ...}, f/AUDIO_DATA.fps);
```

No `duration` is set, so GSAP applies its default **0.5 s** per tween. At
30 fps a new tween starts every ~33 ms while each runs 500 ms — roughly 15
concurrent tweens fighting over the same element's properties, with default
`overwrite: false`. The result is a laggy, washed-out average instead of crisp
per-frame response. This directly contradicts the guide's mandatory pattern
([[hyperframes-audio-reactive-2026]] §1.3: per-frame sampling via `tl.call()`,
not overlapping tweens).

**Fix spec:** replace the per-frame `tl.to()` with one of:
- `tl.set('.motif', {...}, f / AUDIO_DATA.fps)` — cheapest, exact per-frame values; or
- `tl.to('.motif', {... , duration: 1 / AUDIO_DATA.fps, overwrite: 'auto'}, f / AUDIO_DATA.fps)` — if eased interpolation between frames is wanted.

Also note the selector targets **every** `.motif` in the document (one per
scene), so hidden scenes animate identically. Scope the selector to the active
scene's motif or accept the (small) wasted work explicitly.

**Verify:** snapshot consecutive frames around a sharp transient (first kick of
a drop). Before: the motif value at frame N resembles N±7. After: frame N
reflects frame N's data.

---

## F3. Render defaults ship low quality at the wrong frame rate

**Evidence:** `packages/backend/app/api/hyperframes.py` — `hyperframes_render()`
defaults: `quality="standard"`, `fps=24`.

The audio payload is built at 30 fps (`build_hyperframes_audio_payload(fps=30)`
default), and the guide's verification section (§10) renders with
`--quality high`. Anyone rendering through the API default gets standard
quality **and** a 24-vs-30 fps mismatch against the payload the timeline was
authored for.

**Fix spec:** change the endpoint defaults to `quality="high"`, `fps=30`.
Keep them overridable — the point is the default path should be the good
path. If a caller explicitly passes other values, honor them.

**Verify:** same composition rendered before/after; compare a text-heavy frame
at full resolution for sharpness and a beat frame for timing alignment.

---

## F4. Single fixed template — no art direction per scene

**Evidence:** `_composition_html()` in `storyboard_hyperframes.py` emits one
visual treatment for every scene: title card + rotating ring motif + progress
bar. Palette varies; structure never does.

The repo already documents a pattern library it does not use
([[hyperframes-audio-reactive-2026]] §3: bass pulse, spectrum bars, lyric
karaoke, section-aware scenes, particle bursts), and upstream ships
purpose-built workflows for this exact job:
`/music-to-video` (music track → beat-synced video),
`/hyperframes-creative` (audio-reactive composition patterns), and the
component registry (`hyperframes catalog` / `hyperframes add` — check the
registry before hand-building any named look or transition).

**Fix spec (staged, do not boil the ocean):**
1. Short term: add 2–3 composition variants to the compiler selected by scene
   `type` (e.g. `title`, `lyric`, `spectrum`), reusing the guide's §3 patterns.
2. Medium term: evaluate upstream `/music-to-video` + registry blocks as the
   composition source instead of the hand-rolled template; keep the storyboard
   compiler as the data contract, not the art director.
3. Consider a `frame.md`-style design token layer (upstream concept: design
   system translated for the camera) so palettes/moods come from one place.

**Verify:** compile the same storyboard; before/after snapshots should show
structural variety across sections, not just palette swaps.

---

## F5. GSAP loads from CDN at render time

**Evidence:** `packages/backend/app/services/storyboard_hyperframes.py:110`:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
```

Every render depends on a live network fetch of a third-party CDN. A hiccup
stalls or breaks the render, and it weakens the determinism guarantee
`hyperframes check` is supposed to enforce.

**Fix spec:** vendor GSAP locally (pin the exact 3.12.5 build in the repo,
e.g. under `tools/hyperframes-test/vendor/` or the compiled-storyboards
output dir) and reference it relatively. No behavior change, purely a
reliability fix.

---

## F6. Local HyperFrames skills may lag upstream

Upstream `heygen-com/hyperframes` ships 21 versioned skills and updates fast
(5,298 commits since 2026-03). The `skills.sh` registry blob can lag `main`
by hours. Run `npx hyperframes skills update` (installs the core set from
current `main`) before adopting any upstream workflow from F4 — otherwise the
local `/music-to-video` copy may predate the behavior the docs describe.

---

## Suggested order of work

1. **F1 + F2** — data and timing correctness; everything else builds on these.
2. **F3 + F5** — render-path reliability; small, safe, independently verifiable.
3. **F4** — art direction; biggest visible payoff, largest scope. Do after the
   pipeline is truthful.
4. **F6** — maintenance hygiene; fold into the F4 evaluation step.

## Boundary notes

- Do not change the `AUDIO_DATA` contract shape — compositions and the
  frontend bridge already consume it. F1 fills it with real data; the shape
  stays.
- Do not re-litigate architecture decisions in `docs/architecture/decision-log.md`.
- Measure, don't assert: each fix lists its verification. A snapshot
  comparison that shows no difference is a finding about the fix, not a
  license to skip verification.

---

## See also

- [[hyperframes-audio-reactive-2026]] — the contract these fixes restore
- [[audio-reactive-production]] — frequency band mapping, genre-aware pacing
- [[visualization-effects]] — WebGPU/TSL shaders, particles, post-processing
- `packages/backend/app/services/storyboard_hyperframes.py` — the compiler
- `packages/backend/app/api/hyperframes.py` — the render API
- https://github.com/heygen-com/hyperframes — upstream (Apache-2.0)

_Last updated: 2026-10-06_
