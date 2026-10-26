---
tags:
  - creative
  - design
  - visualization
  - audio
aliases:
  - Visualizer UX Audit 2026-10
  - Screenshot Friction Audit
  - Visualizer Friction Findings
cssclasses:
  - creative-guide
date: 2026-10-02
type: tracker
---

# Visualizer UX Audit — October 2026 (Screenshot-Driven)

> [!info] Method
> Captured live against the running frontend (Vite :5173 + FastAPI :8000, no
> servers were restarted) with headless browser automation at 1600x900 and
> 780x410, on `/visualizer` (empty state, shader/2D/3D modes while playing a
> real track, more-controls menu, keyboard-shortcuts panel, stem mixer), on
> `/audio-analysis`, and on `/three-js-studio`. Console errors and failed
> network requests were captured alongside every screenshot.
>
> Screenshots: `packages/frontend/tests/browser/out/` per D5. This audit is
> evidence from one session, not a full usability study — items are ordered by
> severity, and each states how it was observed.

> [!tip] Companion docs
> - [[audio-reactive-best-practices-2026]] — 2026 research this audit measures against
> - [[ai-music-mastering-stems-2026]] — mastering/stem research for the audio side
> - [[stem-system-evaluation-2026]] — earlier per-stem pipeline audit
> - [[visualizer-state-analysis-2026]] — prior vision-model feedback
> - Plan: `docs/plans/studio-quality-2026-10.md`

---

## 1. Critical: two live bugs found by clicking, not by reading

Both were reproduced in the browser during this session. Neither is recorded
anywhere in the library or the decision log; both were introduced by feature
commits that no test executes end-to-end (the same "works path never runs" shape
as D15/D17).

### 1.1 Stem separation is completely broken (P0)

**Observed:** clicking **Load Stems (vocals / drums / bass / other)** in the
visualizer's Stem Mixer returns the panel state `unavailable` with the raw
Python error:

```
'SeparationOptions' object has no attribute 'source_path'
```

**Root cause** (`packages/backend/app/services/source_separation.py`, introduced
in `f0d325d` "make stem separation and mixing first-class features"):

- L553: `source = opts.source_path or audio_path` — but the `SeparationOptions`
  dataclass (L121-126) declares only `model`, `segment_size`, `overlap`,
  `denoise`. **Every** Demucs run raises `AttributeError` here, so single-pass
  separation has never worked since that commit.
- L428-436: the hierarchical path additionally calls
  `_separate_demucs(..., source_path=instrumental)` — a keyword the function
  signature does not accept, so hierarchical mode would fail with `TypeError`
  even after L553 is fixed.

**Why tests pass anyway:** `tests/test_separation_queue.py:48` monkeypatches
`_separate_demucs` with a fake, so the broken function is never invoked. The
route surface, the queue, and the mixer UI are all green while the headline
feature 500s on every request.

**User impact:** the entire stem-splitting half of the product (StemMixer,
stem-reactive visualization, vocal isolation for transcription) is dead, and the
UI shows an internal exception string rather than an actionable message.

### 1.2 Shader visualizer fetches analysis by display name → 404 (P1)

**Observed:** with a track loaded, the browser logged repeated 404s:

```
/api/audio/analysis/by-filename/NeoCortext%20-%20I%20Won%E2%80%99t%20Ride%20with%20the%20Choir   404
/api/audio/spectral-timeline/NeoCortext%20-%20I%20Won%E2%80%99t%20Ride%20with%20the%20Choir     404
```

**Verified against the backend directly:**

| Request filename | Result |
|---|---|
| `NeoCortext - I Won't Ride with the Choir` (clean display name) | **404** |
| `32129cfa_03c5fbfd_NeoCortext - I Won't Ride with the Choir.mp3` (actual) | 200 |
| `32129cfa_03c5fbfd_NeoCortext - I Won't Ride with the Choir` (no ext) | 200 |

**Root cause:** `Visualizer.tsx:1682` passes
`trackName={cleanTrackName(currentFilename ?? "")}` into `ShaderVisualizer`,
which feeds the same string to `useKeyPalette` (L181) and `useSpectralTimeline`
(L204). `cleanTrackName` is a *display* helper (D16); here it is used as an
**API cache key**. `/api/audio/spectral-timeline/{filename}` resolves
`AUDIO_DIR / filename` and 404s when the file is not there
(`audio.py:583-585`).

**User impact:** for every hash-prefixed file (most of the 54-track library):

- the per-frame **spectral timeline bridge is absent**, so shader modes lose the
  data feed they were built for (`audio.py` docstring: "the data bridge for
  Remotion/WebGL uniform binding");
- the **key-derived palette** (Q5 Tier 1) silently falls back to neutral — the
  feature ships but never engages;
- console noise on every track load with no user-facing hint.

The 2D path passes the raw `currentFilename` (L1809) and is unaffected — which
is why this survived: the feature it breaks was only ever checked visually.

---

## 2. High-friction UX findings (screenshot evidence)

### 2.1 The transport is the browser's native `<audio controls>`

The playback bar under the canvas is Chrome's stock grey audio player —
system-styled, visually unrelated to the studio's dark chrome, with its own
⋮ overflow menu. It duplicates the header's ▶ button (and Three.js Studio adds
a *third* and *fourth* transport: PREVIEW and AUDIO play/stop pairs). One
custom transport component would serve every page.

### 2.2 Mixer panels own the viewport; the canvas starves

At 1600x900 the STEM MIXER (a single purple **Load Stems** button + two selects)
and MASTER EQ (six preset chips) are expanded *by default* below the transport,
occupying ~40% of the page. At 780x410 the canvas collapses to a ~60 px sliver
above the transport — the visualization, the product's entire point, is the
smallest element on screen. Both panels are collapsed-able in principle
(`Simple Mixer` toggle exists) but nothing remembers the state, and nothing
starts collapsed.

### 2.3 Overlapping floating panels, one of them unreadable

- **FX panel** (Spectral Reactor: Speed/Brightness/Contrast/Hue/Saturation)
  floats directly over the canvas with no scrim; opening **More controls**
  renders it *underneath* the menu, both partially visible at once.
- **More controls** menu items are near-zero contrast — dark grey text on a
  near-black panel, with unlabeled icon rows. In the capture, the menu content
  is effectively unreadable (a known class of defect this repo already tracks:
  [[color-strategy-2026]], [[dark-ui-color-system-2026]]).
- **3D preset list** overlays the canvas as a bare column of text rows; the
  selected row has an outline but hover/contrast states are weak.

### 2.4 Blown-out 3D preset, unreadable lyrics

The `Cosmic Dust` 3D preset rendered a near-white field filling the canvas; the
lyric card (white text on a translucent grey card) over it was unreadable. Two
independent defects: no auto-exposure/tonemap ceiling on 3D output, and a lyric
card whose scrim assumes a dark background. A luminance-aware scrim (or
`backdrop-filter: blur` + darker alpha) fixes the text regardless of the scene.

> **Resolved 2026-10-02.** The scrim + exposure clamp + soft-knee tonemap
> landed first and made the text readable, but the white field itself traced to
> two shader bugs in `instancedParticles.tsx`, not to grading: the vertex
> shader built billboard offsets from world-space camera axes and then ran them
> through `modelViewMatrix`, so the LrcViz wrapper's continuous `rotation.y`
> sheared the quads — face-on and frame-filling once per turn (frame mean 0.71+),
> edge-on slivers the rest of the time (0.03), which is why earlier triage kept
> finding "wash bands" at different musical positions in different runs; and
> `baseSize` was never destructured, so every style's dust rendered at the
> hardcoded 0.4–1.4 world units instead of the 0.08–0.1 its callers pass —
> roughly 10× the intended area. The fix is a view-space billboard
> (`mvPosition.xy += offset` after the modelView transform), honoring
> `baseSize`, plus an `uAlpha` uniform for tuning. Post-fix: scene mean
> 0.08–0.28 relative luminance across the sampled track, `frac(L>0.92)`
> ≈ 0.009–0.011 (about 1% of pixels, the specular particle cores rather than
> frame-filling wash), lyric contrast 10.4–17.3:1, and brightness is
> rotation-invariant
> (baseline/rot0/rot+π within 0.006). Evidence: `plan14-fix-*` and
> `plan14-causal-run.json` in `tests/browser/out/`.

### 2.5 Analysis state is silent

Beyond the 404s (§1.2), nothing on screen says "this track has no analysis yet"
or offers the fix inline — a 2D-mode **Analyze** button exists top-right of the
canvas, but only in 2D mode, and only if you notice it. The Audio Analysis page
itself lists 54 files with per-row affordances of *rename* only; after picking
a track the capture shows no results panel or per-row Analyze action (the page's
workflows are reachable, but not self-evident from the list).

### 2.6 Raw identifiers leak into the UI

- Audio Analysis list shows `32129cfa_03c5fbfd_NeoCortext - …mp3` and bare
  uuid `.wav` rows — the exact D16 failure class, which was fixed for
  *selectors* but not for this list view (D16 itself notes uuid rows render as
  `Unnamed track ec2c16` in selectors).
- Three.js Studio's benchmark detail prints `161312ms` (the select correctly
  shows `161.3s`), and its top toolbar carries **seven icon-only buttons** with
  no accessible names in the snapshot (crown/planet/gem/person/expand/clipboard/
  lightning).

### 2.7 Minor / cosmetic

- Shortcuts panel documents cycle order "3D → FX → 2D" while the mode button
  cycles shader → 2D → 3D (label only; behavior is consistent).
- Track `<select>` truncates to `NeoCortext - I Won't Ride with t…` while the
  full title is displayed one row below the canvas — redundant truncation.
- A toast notification appeared during track load (dismissible) whose origin
  was not surfaced in the panel — notification provenance is worth a glance.

---

## 3. What works well (keep these)

- **Empty state**: "Drop a song to see it" with a numbered 3-step onboarding,
  `54 tracks ready`, direct links to Audio Analysis, and a Shorts tip. This is
  the strongest screen in the capture set.
- **Keyboard shortcuts panel**: complete, well-typed keycaps, includes focus
  mode and per-mode digit keys (consistent with D25's 1–9 mapping).
- **Reactivity is genuine**: BASS/MID/TREBLE meters tracked real audio, and
  distinct frames were confirmed per mode while playing — consistent with
  D24's measured validation.
- **Status surfaces**: CUDA/GPU badge on Audio Analysis, system status dot,
  V2.0.0 footer, per-track `(92 BPM) ✓` in the selector.

---

## 4. Findings → actions

| # | Finding | Severity | Evidence | Plan item |
|---|---------|----------|----------|-----------|
| 1.1 | `SeparationOptions.source_path` AttributeError kills all stem separation | P0 | live error in UI + code L553/L435 | `visualizer-quality-2026-10` Phase 0 |
| 1.2 | `cleanTrackName` used as API key → analysis/spectral 404s | P1 | live 404s + direct endpoint probes | Phase 0 |
| 2.1 | Native `<audio>` transport, triplicated play controls | P1 | screenshot | Phase 1 |
| 2.2 | Mixer panels expand by default; canvas starves at small heights | P1 | screenshots at both viewports | Phase 1 |
| 2.3 | Panel overlap + unreadable More-controls menu | P1 | screenshot | Phase 1 |
| 2.4 | Blown-out 3D preset + lyric scrim assumes dark bg | P2 | screenshot | Phase 1 |
| 2.5 | Silent analysis state, no inline Analyze CTA | P2 | screenshots + 404 log | Phase 1 |
| 2.6 | Raw hashes/uuids/unlabeled icons in UI | P2 | screenshots | Phase 1 |
| 2.7 | Label/copy mismatches | P3 | screenshots | Phase 2 (fold in) |

Research-backed depth items (envelope followers, sensitivity, motion wiring,
mastering chain, stem QC) live in
[[audio-reactive-best-practices-2026]] and [[ai-music-mastering-stems-2026]],
and are sequenced in `docs/plans/studio-quality-2026-10.md`.

## 5. Interaction-State Vision Analysis (2026-10-26)

Captured 9 interaction-state screenshots of `/visualizer` by clicking through
states a real user would traverse, then analyzed 7 of them with Gemma4 via
Ollama (2 states could not be analyzed — VRAM pressure from prior analyses
caused Ollama 500 errors; system was held at 86% VRAM for the remainder of the
session). States analyzed:

| # | State | File | Analyzed |
|---|-------|------|----------|
| 1 | Modal closed (base state) | `interaction-modal-closed.png` | ✓ |
| 2 | Track dropdown open | `interaction-track-dropdown.png` | ✓ |
| 3 | Focus tab: Bass | `interaction-focus-bass.png` | ✓ |
| 4 | Focus tab: Vocals | `interaction-focus-vocals.png` | ✓ |
| 5 | Focus tab: Highs | `interaction-focus-highs.png` | ✓ |
| 6 | Genre preset: EDM | `interaction-genre-edm.png` | ✓ |
| 7 | Genre preset: Phonk/Bass | `interaction-genre-phonk.png` | ✓ |
| 8 | Mode toggle: 3D | `interaction-mode-3d.png` | ✗ (Ollama 500, VRAM 86%) |
| 9 | Mode toggle: 2D | `interaction-mode-2d.png` | ✗ (not attempted, VRAM 86%) |

### Cross-state patterns (issues appearing in multiple states)

**No hover/focus states on any interactive element** — all 7 states
Sliders, buttons, sidebar items, mode icons, genre presets — none show hover
or focus rings. Users cannot tell what is interactive or which element is
active without clicking.

**Dense control panel with no visual grouping** — 5 of 7 states
The Reactivity Tuning panel has 10+ sliders crammed together with no visual
separation between energy controls, frequency controls, and triad controls.
Cognitive overload risk.

**Sidebar too long / dense** — 6 of 7 states
16+ navigation items in a single flat list, no collapsible sections or visual
grouping. Hard to scan quickly.

**Missing visual feedback on state changes** — 4 of 7 states
Track dropdown open but no indication of which track is selected. Focus tab
changes (Bass/Vocals/Highs) but no clear active indicator. Genre preset
selection not visually distinct.

**Contrast / WCAG concerns** — 4 of 7 states
Dark theme text contrast needs verification against WCAG 4.5:1. Specific
warning text flagged as critical by Qwen analysis (yellow on dark background).

### State-specific findings

| State | Unique Issues |
|-------|--------------|
| Modal closed | Context mismatch ("Visualizer modal vs Media Library"); dropdown lacks placeholder/icon |
| Track dropdown open | No hover/focus on dropdown; sliders lack min/max labels; toolbar needs icons |
| Focus: Bass | Sidebar lacks grouping/hierarchy; mode icons small with no hover states |
| Focus: Vocals | Inconsistent vertical spacing (8pt grid violation); tight line-height in sidebar |
| Focus: Highs | 8+ toolbar toggles cause clutter; excessive sidebar length |
| Genre: EDM | Genre presets tightly packed; no separation between visualizer and tuning panel |
| Genre: Phonk/Bass | Presets use small text; tuning panel cluttered; sidebar causes excessive scrolling |

### Prioritized recommendations

1. **Add hover/focus states to all interactive elements** (sliders, buttons, sidebar items, mode icons, genre presets) — affects every state
2. **Group the Reactivity Tuning panel** with visual dividers/sub-headings — affects 5 states
3. **Make the sidebar collapsible** with grouped sections — affects 6 states
4. **Add visual feedback for active states** (focus tab highlight, genre preset selection, track selection indicator) — affects 4 states

### Notes on vision-analysis methodology

- Sequential single-model analysis (gemma4:e2b-it-qat) is safer than parallel
  multi-model analysis on an 8 GB GPU — cold-loading Qwen3.5:4b through Atomic
  Chat on top of a resident Ollama model pushed VRAM to 86% and caused Ollama
  500 errors.
- Always check `GET /api/integrations/vram/status` before starting a vision
  analysis session; skip if VRAM > 70%.
- Interaction-state screenshots reveal issues a single static screenshot
  cannot (state-change feedback, active-state indicators, focus rings). The
  combination of interaction + vision analysis is valuable but must be
  resource-budgeted for the host machine.

## 6. Research: Improving the Interaction + Vision Analysis Concept

The following external work is directly applicable to evolving the current
manual screenshot → vision-model analysis loop into a more systematic
interaction-state vision analysis practice. Sources are listed with the
concept most relevant to this repo's visualizer.

### 6.1 Closed-loop perception → action → re-verify

**Source:** RFNIT (IEEE/ACM ICSE 2026) — multi-modal robotic GUI testing
framework integrating vision perception, LLM reasoning, and physical actuation
in a closed loop. Each action is verified by re-capturing the screen state;
the loop continues until the expected state is reached or a bug is detected.

**Application:** The current visualizer audit captures one static state per
screenshot. A closed-loop version would: capture state → vision model identifies
an issue → agent performs the interaction that should fix or trigger it →
re-capture → vision model verifies the change. This catches issues that only
appear mid-transition (e.g., a focus ring that appears on hover but the static
screenshot was taken before hover registered).

**Relevant files:** `packages/frontend/tests/browser/` — Playwright E2E specs
already exist (`canvas2d.spec.ts`, `lrc-visualizer.spec.ts`) and could be
extended with vision-model state verification between interactions.

### 6.2 Structured UI parsing before vision analysis

**Source:** OmniParser (arXiv:2408.00203) — parses UI screenshots into
structured elements: interactable icon detection, icon description, and OCR,
producing a DOM-like representation with bounding boxes. Significantly improves
VLM grounding by relieving the model of element detection and letting it focus
on reasoning.

**Application:** Before sending a visualizer screenshot to Gemma4/Qwen, run an
OmniParser-style pre-pass that overlays bounding boxes + labels on interactive
elements (sidebar items, sliders, mode toggles, genre presets, track dropdown).
The vision model then receives a structured map instead of raw pixels, reducing
hallucination about element identity and enabling precise findings like "the
Bass focus tab lacks a focus ring at coordinates [x,y]."

**Relevant files:** `tools/vision/analyze.mjs` — the `--source` flag already
attaches source code; a structured UI overlay could be added as an image
pre-processing step before the model call.

### 6.3 Three-frame transition capture (rest / mid / settled)

**Source:** visual-qa online tool (tool.lu) — motion and interaction capture
guidance: for every interactive element, capture three frames per transition:
rest (before), mid-transition (~100ms in), and settled (after). Compare settled
state to settled state for pixel fidelity; separately verify motion against
stated intent.

**Application:** The visualizer's Reactivity Tuning sliders, focus tabs, and
genre presets all have transitions. Current screenshots capture only the
settled state. A three-frame capture would reveal: does the slider thumb
actually move mid-drag? Does the focus tab highlight animate smoothly? Does
the genre preset selection settle in the correct visual state?

**Relevant files:** `packages/frontend/tests/browser/out/` — screenshot output
directory; a `capture-transition` helper could drive an element, wait ~100ms,
capture, then wait for settle and capture again.

### 6.4 Interaction-dependent accessibility auditing per state

**Source:** Site Accessibility Auditor (2026) — Chrome DevTools extension with
an "interaction lens" that drives the page through reachable states and audits
WCAG criteria per state: focus rings (2.4.7), target sizes (2.5.8), focus-ring
contrast (1.4.11), hidden/clipped controls (2.4.11/2.4.12). Findings are
linked to page state, DOM trace, and coordinates.

**Application:** The visualizer's interaction analysis found missing hover/focus
states on all interactive elements and contrast concerns in 4 of 7 states. An
interaction lens would: drive through each state (modal closed, dropdown open,
each focus tab, each genre preset), then check focus-ring visibility, target
sizes, and contrast per state. Findings would be tied to specific states rather
than generic "the UI lacks hover states."

**Relevant files:** `docs/knowledge-library/visualizer-ux-audit-2026-10.md` §5
already records these as cross-state patterns; a tool could automate the
per-state verification.

### 6.5 State-conditioned grounding benchmarks

**Source:** FineState-Bench (ACL 2026) — evaluates whether a vision model can
ground an instruction to the exact target UI state (2,209 instances, 23 UI
component types, four interaction families). Metrics include localization
success rate, interaction success rate, and exact state success rate.

**Application:** Could be used as a regression test for the visualizer vision
analysis itself: given a target state (e.g., "focus tab = Vocals active"), can
the vision model correctly identify which element is active and whether its
visual state matches? This guards against the vision model misreading active
states in future analyses.

**Relevant files:** `tools/vision/analyze.mjs` — could add a `--verify-state`
mode that checks whether a specified interaction state is visually correct.

### 6.6 Grid overlays for coordinate-precise vision actions

**Source:** UW CSE503 final report "Using Vision LLMs For UI Testing" — overlays
a numbered grid on screenshots so the VLM can indicate click targets by grid
cell rather than pixel coordinates. Combined with Playwright execution, this
forms an automated testing loop: expected behavior → steps → LLM decides next
action → Playwright executes → re-capture → verify.

**Application:** For visualizer fixes that require interaction (e.g., "click
the Bass focus tab and verify it highlights"), a grid overlay would let the
vision model precisely indicate which element to interact with, and the Playwright
backend would execute and re-verify.

**Relevant files:** `packages/frontend/tests/browser/` — Playwright specs could
be extended with vision-guided interaction testing.

### 6.7 Agentic per-criterion accessibility auditing

**Source:** Agentic Web Accessibility Auditing (arXiv:2609.09379) — one worker
agent per targeted WCAG success criterion, each with criterion-specific
instructions and a shared tool library (DOM queries, screenshots, computed
styles, keyboard operations, contrast measurement).

**Application:** Instead of one general vision prompt, assign separate workers
to: focus-ring visibility, target-size minimums, contrast ratios, keyboard
traversal order. Each worker drives the visualizer through interaction states
and checks only its criterion. This produces more reliable, criterion-specific
findings than a general "audit this UI" prompt.

**Relevant files:** `docs/knowledge-library/visualizer-ux-audit-2026-10.md`
§5 findings map well to per-criterion workers (focus states, contrast,
target sizes).

### 6.7.1 VLM toolkits for responsive + grounding checks

**Source:** vlmkit (GitHub: mizchi/vlmkit) — VLM toolkit with commands for
checking breakpoints, responsive design sweeps, and grounding/action maps from
screenshots (which element a click at each pixel coordinate reaches).

**Application:** Could be used to verify that visualizer interactive elements
remain correctly targeted across viewport sizes (1600x900 vs 780x410 were both
captured in the original audit) and that click coordinates land on intended
elements after layout changes.

---

## Related
- [[design-philosophy-2026.md]] :see-also

- [[design-auditing-2026.md]] :see-also
