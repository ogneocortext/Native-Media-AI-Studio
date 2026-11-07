---
tags:
  - research
  - visualization
  - audio-reactive
  - performance
aliases:
  - Audio-Reactive Visualization Research 2026-11
  - Reactive Viz Techniques Update
  - Onset Detection and Latency Research
cssclasses:
  - research-report
date: 2026-11-05
type: synthesis
---

# Audio-Reactive Visualization — Research Update 2026-11

> [!info] Scope
> Web research pass (2026-11-05) expanding the reactive-visualization
> knowledge base ahead of the T-VIZ-16–24 implementation cluster. Sources:
> BLOKS learning center, Pururut shader player docs, arkestra.app,
> Synesthesia SSF uniform docs, makemusic.video beat-sync guide,
> platima/beatdet, Sascha Becker's RPM rhythm engine, sakimyto canvas
> particle guide, web.dev canvas performance, htmlhub WebGL guide,
> side-line.com, renderforest, framefields, dasca.studio, wearefevr.com.
>
> Companion docs: [[audio-reactive-best-practices-2026]] (craft rules),
> [[audio-reactive-production]] (production mapping),
> `docs/knowledge/visualizer-smoothness-plan-2026-11-03/` (T-VIZ-14–19),
> `docs/knowledge/visualizer-mode-research-2026-11-03/` (T-VIZ-21–25).

---

## 1. Band→parameter mapping craft (validated + extended)

The strongest recurring rule across sources: **percussive sources drive
fast, large parameters; sustained sources drive slow, atmospheric ones.**

| Source | Map to | Response |
|---|---|---|
| Kick / transient | scale, displacement, flash | fast attack, minimal smoothing |
| Snare / clap | break, glitch, hit marker | sharp, short |
| Hats / treble | sparkle, rim, fine motion | very fast, low amplitude |
| Bass sustained | horizon, fog, camera drift | slow, heavy smoothing |
| Vocals / mid | frame distortion, type motion | medium |
| Level / energy | build intensity, bloom | slow envelope |
| Beat grid (not level) | anything on the beat | tempo-locked, not amplitude-driven |

This **validates T-VIZ-15's per-band-group envelopes** and extends them:
the grouping isn't only about smoothing constants — it should also drive
*which parameter class* each band controls. When T-VIZ-22 (Stem Scene)
and T-VIZ-23 (Terrain) land, assign drums→strike parameters,
bass→heave/drift, vocals→central form, other→atmosphere — matching the
ledger spec, now with external corroboration.

Design corollary (side-line/renderforest): **one visual rule per track**,
strongest musical event → strongest visual change, arrangement changes
(not constant motion) as structure. Several sources warn against every
element reacting independently — one strong reactive element beats five
mediocre ones. Relevant when authoring the T-VIZ-20 warp presets and any
future mode: presets should pick a *role* (driver vs. responder), not
react to everything.

## 2. Onset detection — concrete constants for T-VIZ-16

The makemusic.video write-up and platima/beatdet converge on a refined
spectral-flux pipeline worth adopting wholesale for the T-VIZ-16 onset
envelope:

1. **Positive-only spectral flux** — sum `max(0, bin[t] - bin[t-1])`
   across bands; onsets are attacks, decays contribute nothing. RMS
   volume fails on compressed masters.
2. **Adaptive threshold** — rolling ~1 s history (≈40 frames at 60 fps);
   beat = flux > mean + **1.5σ**. Self-tunes quiet verses vs loud
   choruses; no per-track constants.
3. **Per-band onsets** — kick 30–200 Hz (measure in amplitude domain so
   a loud kick beats a quiet bass entry), snare 800 Hz–5 kHz, hats
   6–16 kHz. Enables per-stem/per-band onset envelopes.
4. **Ghost-note suppression** — normalize each hit's strength against
   the strongest hits in a ±2 s window so retriggers don't flash as hard
   as main hits.
5. **Sub-frame refinement** — refine each onset against a finely
   sampled energy envelope of a filtered band copy; reported precision
   ≈2 ms. Matters for T-VIZ-19's "peaks land on beats" acceptance.
6. **Output as decaying envelope, not boolean** — matches the T-VIZ-16
   spec exactly; consumers stop re-implementing decay (our envelope
   stage now owns this pattern for bands; onset should get the same
   treatment as a scalar channel).

Synesthesia's SSF uniforms validate the **two-path architecture**:
their `syn_Spectrum` packs raw / juiced (bin+temporal smoothing, log
scaling, high-end boost) / smooth-resolution FFT / waveform into one
texture, plus `syn_LevelTrail` storing per-band levels over time. Our
split (smoothed shape path + unsmoothed transient path) is the same
idea; the "juiced" middle channel is a possible third resolution tier
if the smoothed path still reads harsh.

## 3. Latency & clock discipline (for T-VIZ-19)

makemusic.video's latency section is the most concrete treatment found:

- Read the visual clock from the **output latency point** (when samples
  actually leave the speakers), not the scheduling point; smooth it so
  it never jitters or runs backwards.
- **Predict one display-refresh ahead** when placing beat-locked events.
- **Integrate motion, don't compute it from the clock** — speed responds
  to loudness/onsets but position only accumulates, so the scene never
  jumps when the clock corrects. Directly applicable to T-VIZ-23's
  "scroll phase from the audio clock" rule: integrate scroll phase,
  don't set it = clock value.
- Pururut's `uChrono` uniform is the shader-ecosystem version: the
  **time-integral of the bands** — rotation/travel speed driven by
  `∫bands dt` accelerates with the music and never jumps back. Prefer
  this over `uTime * bandLevel` for any continuous camera/survey motion
  in warp presets and terrain.

## 4. Canvas2D performance numbers (for T-VIZ-17/18)

Concrete budgets from practitioner sources:

- **~0.1 ms per particle** on modest hardware; practical canvas2D
  ceiling ≈2–4k particles desktop, 1–2k mid-tier mobile. Beyond that,
  WebGL/instancing. Our T-VIZ-18 ~150 draw-call budget is consistent.
- **`fillStyle`/`globalAlpha` changes are the expensive state ops** —
  group draw calls by color/style, single `beginPath`+`fill` per group.
  Reinforces T-VIZ-17's "batch draw state changes" and suggests sorting
  particle draws by color bucket.
- **In-place array compaction** (`writeIdx` swap) beats `.filter()` per
  frame — filter allocates a new array every frame → GC hitches. Audit
  `particles.ts` and `updateIdleParticles` for per-frame allocations.
- **Fixed-timestep physics** (accumulator + `FIXED_DT=1/60`, clamp frame
  dt to ~0.05 s) is the alternative to our T-VIZ-14 dt-damping — we
  chose damping (correct for frame-rate independence); keep the 0.05 s
  clamp idea for tab-return spikes if not already present.
- **IntersectionObserver gating** — never run rAF off-screen (probably
  already handled; verify the visualizer pauses when the tab is hidden
  — rAF does this natively, but our offscreen-buffer path should be
  checked).
- MDN WebGL best practices worth noting for the R3F side: prefer
  vertex-shader work over fragment, batch draw calls, smaller back
  buffer + upscale as a cheap quality step (complements T-VIZ-18's DPR
  ladder).

## 5. Design craft for upcoming modes (T-VIZ-21–24)

- **Kinetic typography (T-VIZ-21):** FEVR's sound+type piece confirms
  cross-modal perception — synchronized audio *validates* motion.
  Typography should respond to frequency bands (bass=weight/scale,
  treble=tracking/texture), not just amplitude. framefields' lyric-video
  guidance: mark phrase timing before animating; line-level timing is
  the right granularity unless word-level proves readable — matches the
  ledger's "extend to word-level only if line timing proves too coarse".
- **Terrain flyover (T-VIZ-23):** side-line's "arrangement changes as
  structure" maps to section-driven speed/heave changes; integrate
  scroll phase (§3) and drive ridgeline from the *enveloped* spectrum.
- **Stem scene (T-VIZ-22):** the kick→scale / hat→flash / vocal→distort
  table above is the agent-behavior spec; isolation check in the ledger
  remains the correctness test.
- **Preset authoring generally:** palette/type/camera consistency across
  a track reads as "one video"; per-section variation should come from
  intensity and arrangement, not motif changes (framefields' master-then-
  adapt-formats guidance).

## 6. Open questions for the next research pass

- WhisperX/phoneme alignment still `Defer` in app-research-gaps §10 —
  word-level kinetic type (T-VIZ-21) may justify revisiting.
- WebGPU compute audio FFT (§12 of the gap register) remains `Monitor`;
  nothing in this pass changed that assessment — Pascal has no native
  WebGPU anyway.
- LTX-2B backend render path (gap register §1 follow-up) still unwired.

---

_Automated research synthesis — verify constants against the linked
sources before treating thresholds as final._

## Related

- [[stylized-3d-character-design-for-audio-reactive-visualization-2026]] :see-also — Stylized 3D Character Design for Audio-Reactive Visualization
