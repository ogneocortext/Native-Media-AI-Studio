---
tags:
  - creative
  - visualization
  - audio
aliases:
  - Audio-Reactive Best Practices 2026
  - Reactive Visuals Research 2026
  - FFT Onset Latency Research
cssclasses:
  - creative-guide
date: 2026-10-02
---

# Audio-Reactive Visuals — 2026 Best Practices

> [!info] Purpose
> Web research (2026) on what makes audio-reactive visuals read as *musical*
> rather than *noisy*, synthesized into checkable practices, with an explicit
> gap analysis against this repo's visualizer. Sources are 2026 engineering
> write-ups (AUTOVJCLUB, Novus, RenderWave, Sonic Weaver, LavX/Sudonull, and
> others) — practitioner material, not vendor marketing. Every "gap" below was
> verified against source before being listed.

> [!tip] Companion docs
> - [[visualizer-ux-audit-2026-10]] — what the live app looks like today
> - [[audio-reactive-production]] — this repo's existing mapping guide
> - [[webgl-webgpu-audio-viz-2026]] / [[hyperframes-audio-reactive-2026]] — stack-level notes
> - [[3d-visualization-best-practices-2026]], `docs/architecture/visualizer.md`

---

## 1. The signal stack (what to measure)

Best practice in 2026 is a **stack of five distinct signals**, not one FFT:

| Layer | What it answers | Typical implementation |
|---|---|---|
| FFT bands | which frequencies are loud now | `AnalyserNode.getByteFrequencyData`, 32 bands or a 26–40 filter **mel** bank |
| Loudness (RMS / peak) | how loud overall | RMS for slow swells, peak for transients |
| Tempo lock (BPM/phase) | **when** the grid is | continuous BPM estimator + phase; keep *separate* from modulation |
| Onset detection | did an event just land | energy jump vs a **moving average** (works in quiet *and* loud passages); kick = sub-envelope derivative, snare = 1.5–3 kHz burst |
| LFO / drift | alive-but-not-reactive motion | slow sine/noise, blended under reactive layers |

Key distinctions the research repeats:

- **Tempo says when, modulation says how much.** Tools that conflate them feel
  either rigid or flaily. Onset ≠ beat ≠ raw energy spike: naive thresholding
  fires on every loud moment in a busy mix; onset-relative-to-average and true
  tempo inference do not.
- **Onsets and RMS want opposite smoothing.** A camera shake on a beat wants
  *almost no* smoothing (hit the transient); a background swell wants heavy
  smoothing. Exposing both fast and slow signals — and binding the right one to
  the right behavior — is "a large part of the difference between motion that
  feels musical and motion that feels like a noisy meter".
- **Per-band envelope followers with independent attack/release.** Fast attack
  for percussion, long release for pads. This is the asymmetric smoothing this
  repo already has in `canvas2dHelpers.ts` (`asymmetricSmoothBands`, 0.8/0.12)
  per the AE doc's P0 — **now wired into `bars` and `stacked-frequency-bands`**
  via `ASYMMETRIC_SMOOTHING_MODES`. It was tested-but-unwired for a while; see
  §5.1 for how that half-wired state survived a green test suite.

## 2. Perceive on the way in, perceive on the way out

- **Input: mel scale.** A linear FFT spends equal width on 200–400 Hz (huge
  musically) and 10–10.2 kHz (tiny). Map bins through a mel filterbank so the
  perceptually loaded 300–3000 Hz speech/mid band gets proportional space.
  This repo already ships `hzToMel` / `hzToBark` / `hzToERB` in
  `canvas2dHelpers.ts` wired via `perceptualScale` (D18) — good; see §5 for
  what is still open.
- **Output: gamma.** Eyes respond logarithmically; a raw linear
  energy→brightness map looks wrong and clips early. Gamma-correct the drive
  value before it reaches pixels; HSV/OKLCH beats raw RGB for
  frequency→color work ([[shader-color-science-2026]]).
- **Frequency→color convention** used across sources: lows warm (red-orange),
  mids yellow-green, highs blue-violet; palettes keyed to musical intervals
  (complementary = octave) "feel more musical".
- **Temporal + spatial smoothing:** per-bin exponential smoothing (different
  alpha per band — ~0.1 lows to ~0.3 highs "creates an illusion of inertia")
  plus a small spatial convolution across neighboring bins to kill pixel jumps.

## 3. Latency and windowing (the invisible quality)

- **Audio-to-visual latency:** < ~30 ms reads as *locked*; > 50 ms reads
  *delayed* even with perfect BPM sync; > 100 ms is distracting.
- **Visual should lead audio slightly:** perceptual A/V sync research in this
  space targets the picture arriving **20–40 ms before** the sound (the classic
  "smilf" bias — visuals ahead read as tighter).
- **FFT window tradeoff is fundamental:** short window = responsive but noisy
  spectrum; long window = fine frequency but smeared transients. Tune toward
  responsiveness and use **50% overlapping frames** to buy back resolution;
  end-to-end budget matters more than bin-perfect spectra.
- **Determinism:** the same band math must run in preview and export; motion
  derives from the audio clock, never `performance.now()` — which is exactly
  D14's rule 2 and `audioTiming.ts`'s latency-compensated clock. This repo's
  foundation here is already correct; what is missing is a *measured* latency
  budget (nothing currently asserts < 30 ms or the 20–40 ms lead).

## 4. Mapping and controls (playable, genre-aware)

- **Sensitivity** scales how hard a given level may push a parameter — turn
  down for brickwalled masters (everything pins to max and strobes), up for
  quiet demos. **Attack/release** per binding. **Beat response** as its own
  control. These three appear in every modern engine's control surface; this
  repo's FX panel exposes Speed/Brightness/Contrast/Hue/Saturation — i.e.
  *look* parameters, not *reactivity* parameters.
- **Per-band, per-parameter modulation** (any band → any uniform, with depth,
  curve, smoothing) is the top rung of the ladder; discrete **event triggers**
  (shader swaps, strobes, section changes) ride on top as a separate path.
- **Genre routing:**
  - four-on-the-floor → separate kick/bass/hat/snare bands, else the scene
    pumps as one envelope;
  - breakbeat → event triggers on snare cracks, not bar lines;
  - ambient → amplitude tells you almost nothing; drive from pitch/harmonic
    content and slow band averages with long releases;
  - vocal-led → mid-band emphasis so imagery tracks melody;
  - one code path cannot serve all genres — sources describe a "mixture of
    experts" future. The practical step today is **per-genre preset bundles**
    over the same signal stack.

## 5. Gap analysis vs this repo (verified)

| Practice | Repo status | Verdict |
|---|---|---|
| FFT + per-stem energy + beat detection | implemented (D18 audit) | ✅ |
| Mel/Bark/ERB perceptual scales | `canvas2dHelpers.ts`, `perceptualScale` prop (D18) | ✅ — Bark inverse was wrong, now fixed (§5.1) |
| Latency-compensated audio clock | `audioTiming.ts`, `estimateOutputLatency` on context creation | ✅ foundation |
| Effect restraint (not everything reacts) | `canvas2dModeBudget.ts`, `MAX_EFFECTS=2`, validated live (D24) | ✅ unusual strength |
| Asymmetric attack/release smoothing | `asymmetricSmoothBands` wired to `bars` + `stacked-frequency-bands` | ✅ — was a P1 gap, now closed |
| Motion vocabulary (named moves, impulse trigger) | `motion/` — 151 assertions, **no style consumes it yet** (D23) | ⚠️ P1 gap — deliberately open per-style tuning |
| Reactivity controls (sensitivity, attack/release, beat response) | absent from UI | ❌ P2 gap |
| Onset vs tempo separation | `beatPhase` + drum classification exist; no user control | ⚠️ partial |
| Frequency→color convention / gamma on drive | key→hue shipped (Q5 Tier 1); gamma on brightness not verified | ⚠️ P2 |
| Measured A/V latency budget (< 30 ms, 20–40 ms lead) | not measured anywhere | ❌ P2 gap — add to debug overlay (RenderStats) |
| Per-genre reactivity presets | EQ presets exist (warm/bright/…) but no *reactivity* presets | ❌ P2 gap |
| Spectral timeline data bridge for shaders | built (`useSpectralTimeline`) but **404s for hash-prefixed files** | ❌ P0 — see [[visualizer-ux-audit-2026-10]] §1.2 |

## 5.1 Two defects found by re-deriving from the sources (2026-10-02)

Checking §2's "mel/bark is implemented" row against the actual code turned up
two defects, both instructive for the same reason: **each passed a test suite
that looked adequate.**

### `barkFreqMap` inverted Bark with the ERB formula

`canvas2dHelpers.ts` mapped bar → Bark → back to Hz using
`(10^(x/21.4) - 1) / 0.00437`, which is the inverse of the **ERB** scale, not
Bark. Bark grows more slowly than ERB, so every band landed **~3.4× too low**:
with 32 bars the top bar sampled **~1.2 kHz instead of ~22 kHz**. The "Bark
(critical bands)" option in `SettingsPanel.tsx` therefore never displayed the
top two octaves of the spectrum — the one region where critical-band spacing
is most visibly different from the alternatives.

The two existing tests asserted **range** and **monotonicity**. A uniformly
squashed mapping satisfies both, so a broken scale looked correct. The property
that actually distinguishes the right inverse from the wrong one is *round-trip
fidelity*: invert a known frequency and land back on it. Added
`barkFreqMap round-trips known frequencies through its own scale`, plus a
Nyquist-span check and a bass-vs-treble bins-per-octave check. Mutation-checked:
restoring the ERB inverse fails the two new tests while the old two still pass,
which is precisely the proof that the old ones could not see the bug.

Note the correct Bark inverse (`Traunmüller`, `barkToHz`) already existed in
`perceptualScales.ts` — the scale had an inverse in one file and a wrong
stand-in in the other. `canvas2dHelpers.ts` now defines its own `barkToHz`
beside `hzToBark` so the pair cannot drift again. **The two modules still
duplicate `hzToBark`/`hzToMel`;** consolidating them is unfiled cleanup.

**Known limitation, now measured and asserted:** `barkToHz` is Traunmüller's
*approximation*, and it degrades above ~8 kHz — round-trip error is 0.3% at
1 kHz, 3.4% at 4 kHz, 6.7% at 8 kHz, then 26% at 12 kHz and 38% at 16 kHz.
This is a property of the formula (identical in `perceptualScales.ts`), not of
our call site. A consequence is that `barkFreqMap`'s top bars overshoot
Nyquist (~32 kHz for the last of 64 bars at `freqLength=1024`); they are clamped
to the last bin, so this is harmless for display, but it means **the topmost
few bars carry less perceptual information than the scale implies.** Fixing it
properly needs a lookup table or the Zwicker inverse, not a tighter tolerance.

### The asymmetric smoother was half-wired

`ASYMMETRIC_SMOOTHING_MODES` listed `stacked-frequency-bands` but not `bars`,
while the test asserted `bars` *was* wired. Here the test was right and the
implementation was wrong — the opposite verdict from the Bark case, and the
reminder that "the failing test is stale" is not a safe default assumption.

## 6. Takeaways to build from

1. **Fix the data feed first.** No amount of tuning matters while the spectral
   bridge 404s for most of the library (audit §1.2).
2. **Wire what exists before adding.** `asymmetricSmoothBands` and the motion
   vocabulary are already written and tested; the open work is per-style
   mapping, which D23 explicitly reserved for deliberate tuning.
3. **Expose reactivity, not just look.** Sensitivity + attack/release + beat
   response is the standard 2026 control triad; it also absorbs the
   "compressed master pins everything" failure without per-track code.
4. **Measure latency once, visibly.** Put audio-to-visual delta and lead in
   `RenderStats`; assert the 30 ms band in a debug overlay so regression is
   observable, not folklore.
5. **Bundle genre profiles** over the shared stack rather than forking modes.

All five are sequenced in `docs/plans/studio-quality-2026-10.md` (Phases 0–2).

## Sources (accessed 2026-10-02)

- AUTOVJCLUB — *How Audio-Reactive Visuals Work | FFT, BPM, onset detection* (2026-04) — https://autovj.club/en/guide/audio-reactive-visuals/
- Novus — *Turning sound into motion: reading audio with the Web Audio API* (2026-05) — https://novusstreamsolutions.com/product-blog/turning-sound-into-motion-web-audio
- RenderWave — *Audio-Reactive VJ Software for Mac 2026 | Per-Band FFT Modulation* (2026-05) — https://renderwave.io/audio-reactive-vj-software
- Sonic Weaver — *How Music Visualizers Work* / *How FFT Turns Audio Into Visualizer Bands* (2026-07/08) — https://sonicweaver.com/blog/how-music-visualizers-work
- LavX / Sudonull — *Audio visualization on LEDs: perceptual models and mathematics* (2026-04) — https://sudonull.com/audio-visualization-on-leds-perceptual-models-and-mathematics
- Apatero — *Audio Reactive Video Generation Complete Guide* (2025-11) — https://apatero.com/blog/audio-reactive-video-generation-complete-guide-2025
