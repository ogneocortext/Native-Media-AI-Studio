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
  per the AE doc's P0 — **tested but not yet wired into any mode**
  (`docs/architecture/visualizer.md`).

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
| Mel/Bark/ERB perceptual scales | `canvas2dHelpers.ts`, `perceptualScale` prop (D18) | ✅ |
| Latency-compensated audio clock | `audioTiming.ts`, `estimateOutputLatency` on context creation | ✅ foundation |
| Effect restraint (not everything reacts) | `canvas2dModeBudget.ts`, `MAX_EFFECTS=2`, validated live (D24) | ✅ unusual strength |
| Asymmetric attack/release smoothing | `asymmetricSmoothBands` **tested, not wired into a mode** | ⚠️ P1 gap — cheapest win |
| Motion vocabulary (named moves, impulse trigger) | `motion/` — 151 assertions, **no style consumes it yet** (D23) | ⚠️ P1 gap — deliberately open per-style tuning |
| Reactivity controls (sensitivity, attack/release, beat response) | absent from UI | ❌ P2 gap |
| Onset vs tempo separation | `beatPhase` + drum classification exist; no user control | ⚠️ partial |
| Frequency→color convention / gamma on drive | key→hue shipped (Q5 Tier 1); gamma on brightness not verified | ⚠️ P2 |
| Measured A/V latency budget (< 30 ms, 20–40 ms lead) | not measured anywhere | ❌ P2 gap — add to debug overlay (RenderStats) |
| Per-genre reactivity presets | EQ presets exist (warm/bright/…) but no *reactivity* presets | ❌ P2 gap |
| Spectral timeline data bridge for shaders | built (`useSpectralTimeline`) but **404s for hash-prefixed files** | ❌ P0 — see [[visualizer-ux-audit-2026-10]] §1.2 |

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

- AUTOVJCLUB — *How Audio-Reactive Visuals Work | FFT, BPM, onset detection* (2026-04)
- Novus — *Turning sound into motion: reading audio with the Web Audio API* (2026-05)
- RenderWave — *Audio-Reactive VJ Software for Mac 2026 | Per-Band FFT Modulation* (2026-05)
- Sonic Weaver — *How Music Visualizers Work* / *How FFT Turns Audio Into Visualizer Bands* (2026-07/08)
- LavX / Sudonull — *Audio visualization on LEDs: perceptual models and mathematics* (2026-04)
- Apatero — *Audio Reactive Video Generation Complete Guide* (2025-11)
