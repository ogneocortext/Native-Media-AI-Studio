---
tags:
  - research
  - audio
aliases:
  - Measuring Similarity Between Tracks
  - Tempo and Chroma Similarity for Mashups
  - MIR Similarity Findings 2026
cssclasses:
  - research
date: 2026-10-02
---

# Measuring Similarity Between Tracks (for mashups) - What Actually Works

> [!info] Purpose
> We wanted to suggest which library tracks are "similar enough to mash up with".
> That requires a similarity measure. Three candidates were measured against the
> real stem library before anything was built. **Two of the three are unusable on
> this material**, and the reason is a property of the audio, not of the code.
> This note records the measurements so the same dead end is not walked twice.

> [!tip] Companion docs
> [[ai-music-mastering-stems-2026]] (stem separation and mastering),
> `services/stem_remixer.py` (`probe_track`), D32 (import-graph gate).

---

## 1. The question, precisely

For a stem mashup, "similar" has to mean something operationally useful:

- **tempo close** - so beats line up without a hard time-stretch
- **harmonically related** - so neither track has to be transposed absurdly
- **same kind of material** - so the result is not a drum loop under a choir

The third is a constraint (stem type must match), not a ranking. The first two are
what we tried to measure.

---

## 2. Finding 1: librosa's BPM estimate is grid-quantised

`librosa.beat.beat_track` does not return a continuous tempo. It snaps to a grid
derived from the onset-envelope frame rate. Feeding it clean synthetic click
trains at known BPM:

| input BPM | reported | |
|---|---|---|
| 150.0 | 151.999 | |
| 151.0 | 151.999 | |
| 152.0 | 151.999 | |
| 153.0 | 151.999 | |
| 154.0 | 151.999 | |
| 155.0 | 151.999 | |

A full 60-220 sweep at 1 BPM steps produced **24 distinct outputs for 161 inputs**.
Cell width is roughly 5-7 BPM in the 140-160 region.

**Consequence:** four unrelated library tracks reporting exactly `151.999` is not
a coincidence and not evidence they share a tempo. It is the grid. Four of our
probes sit on it: `demucs_test_input`, `take-the-crown`, `f259df2d...`,
`fc37eecb...`.

Resolution near 152 is therefore +/-3 BPM at best. Any suggestion UI implying more
precision than that is lying.

## 3. Finding 2: octave aliasing is universal

Above roughly 157 BPM the estimator folds to about half:

| input | reported | input/2 |
|---|---|---|
| 180 | 89.103 | 90.0 |
| 200 | 99.384 | 100.0 |
| 240 | 117.454 | 120.0 |
| 300 | 99.384 | 150.0 |

This is not a bug to route around; it is the standard tempo-octave ambiguity (is a
beat a quarter note or an eighth?). Autocorrelation does not solve it either -
tested as an independent estimate, it returned `69.84` where `beat_track` returned
`143.55` for the same audio. Both are "correct" up to an octave.

> [!warning] A trap worth naming
> Folding candidates with `min(delta, bpm*2 - subj, bpm/2 - subj)` looks like it
> handles octave ambiguity. It does not - it makes two *different* half-tempo
> readings look identical. It reported distance 0.0 between a 71.8 BPM reading and
> a 143.6 BPM reading. Code that folds this way will confidently rank unrelated
> tracks as a perfect match.

The standard fix (madmom's `interval_histogram_comb`, Böck et al. ISMIR 2015)
weights each metrical level so that the metrical prior - not just the strongest
autocorrelation peak - decides. That is a real technique and not a hack.

## 4. Finding 3: degenerate input returns 0.0, silently

| input | reported |
|---|---|
| white noise 20s | 117.454 |
| silence 20s / 60s | **0.000** |
| pure sine 100Hz | **0.000** |

`0.000` is not a tempo. It passed through `probe_track` and would have been stored
in the cache and rendered into the UI as a real number.

Two of our own probes hit a variant of this: on the 20s clips, skipping the first
10s (to avoid a silent intro) leaves less than one beat, and the estimate collapses
to `0.000`.

## 5. Finding 4: the estimator is perfectly reproducible, which does not mean correct

Three runs per track, identical to 0.01 BPM on all five. **Reproducibility is not
evidence of correctness here.** Every one of the failures above is deterministic,
so re-running never surfaces a problem and a cache-version guard cannot detect
this class of failure.

## 6. Finding 5: a discriminator does exist - but it only says "unmeasurable"

Sharpness of the per-frame tempo distribution (4th standardised moment; 3.0 is
Gaussian) separates confident from not:

| track | reported | sharpness | reading |
|---|---|---|---|
| take-the-crown | 152.00 | 8.67 | genuine, sharp peak |
| Ad-Nauseam | 143.55 | 5.29 | genuine |
| Human-in-the-Loop | 71.78 | 2.36 | suspect: octave-folded reading |
| demucs_test_input | 152.00 | 2.32 | suspect |
| ec2c16... | 99.38 | 1.73 | suspect |

Human-in-the-Loop is the clearest failure: it reports `71.78` while its own frame
distribution centres on `129.20`, with only 2.2% of frames agreeing. Sharpness
separates good from bad, but it is a *confidence* measure, not a better estimator -
it tells you when to refuse an answer, not what the right answer is.

**Currently 2 of 5 library tracks produce a usable tempo.**

## 7. Finding 6: chroma similarity fails too, and the control test is what shows it

Pitch-class chroma is the obvious tempo-independent similarity measure. Computed
as CENS (energy-normalised, the robust variant), maximised over all 12
transpositions:

|  | Ad-Nauseam | take-the-crown | ec2c16... |
|---|---|---|---|
| Human-in-the-Loop | 0.81 | 0.88 | 0.63 |
| **white noise** | **0.76** | **0.83** | 0.58 |

**White noise scores 0.76-0.83 against real tracks.** Music-vs-music scores barely
higher. The measure is not separating music from non-music.

The cause is chroma flatness, measured per stem:

| stem | Ad-Nauseam | take-the-crown |
|---|---|---|
| drums | 0.9964 | 0.9911 |
| vocals | 0.9682 | 0.9881 |
| bass | 0.9698 | **0.8593** |
| other | 0.9202 | 0.9604 |

(1.0 = pure noise; white noise measures 0.9997.)

Most stems sit in the 0.96-0.99 range - there is very little pitch-class structure
for chroma to measure. The lowest reading in the table, bass at 0.8593, is the
most musically useful, and it is also the one where noise correlates highest
(0.85). There is no threshold on this measure that separates the cases.

> [!danger] Always run a control
> The noise correlation was measured specifically because `ec2c16...` and
> `demucs_test_input` scored **0.98 against each other**, which looked like a
> genuine near-duplicate. They are two short clips with low RMS (0.037, 0.033).
> The control showed the correlation was measuring "both flat", not "both musical".
> A similarity matrix with no noise/silence control row is not evidence of anything.

## 8. Finding 7: pure-timbre MFCC similarity - the one that may work

Not yet measured on this library. MFCC / spectral-envelope similarity compares
timbre, which for percussive and dense material is far better conditioned than
pitch class, and needs no tempo estimate. Caveats to check before trusting it:

- It is sensitive to loudness and EQ, so it may rank "same master, same chain"
  rather than "compatible".
- On 8 GB with demucs already resident it is real compute per candidate pair.
- It should still ship with the noise/silence/sine control from section 7.

## 9. What this means for the feature

**Do not build a tempo-ranked "similar tracks" suggestion on the current
estimator.** The honest options:

1. **Lineage only.** Show which mashups already used a track and let the recipe be
   reopened and rearranged. No similarity claim at all. This is the part that is
   actually correct today, because it reads manifests rather than audio.
2. **Gate the estimate.** Accept a BPM only when `beat_track` and an independent
   estimate agree within ~5% (after acknowledging octave ambiguity), and mark
   everything else "unmeasured" rather than guessing. Yields 2 of 5 today - useful
   and honest.
3. **Adopt a proper method.** madmom's RNN + comb-filter tempo
   (`madmom.features.beats.RNNBeatProcessor` with
   `madmom.features.tempo.TempoEstimationProcessor`) is the standard accurate
   offline approach and specifically targets the octave problem madmom's comb
   histogram addresses. **Not installed in this environment** - librosa is the
   only MIR library present, so this is an install decision, not a code change.

### Tools surveyed

- **madmom** (not installed) - RNN beat activation + comb-filter tempo histogram.
  Offline-focused, the reference answer for accurate tempo. Böck et al., ISMIR
  2015. Beats/tempo/key/chords modules.
- **BeatNet** (not installed) - CRNN + particle filtering, streaming and offline,
  sub-50ms latency, also does downbeat and meter.
- **librosa** (installed, 0.11.0) - `beat_track`, `feature.tempo`,
  `feature.chroma_cens`. Lightest option, and the weakest of the three on octave
  handling.
- **Chromaprint / AcoustID** - acoustic fingerprints for *identification*, not
  similarity ranking. Requires raw PCM and an external fingerprint database. Wrong
  tool here.
- **Circle of fifths / diatonic set** - the classical basis for harmonic mixing:
  adjacent keys are compatible, so a track can be transposed by a small interval to
  match. **Useless on this library** because it needs a *reliable key*, which
  section 7 shows we cannot get. Do not build on this until key detection works.

## 10. Method notes

All measurements used `output/stems/htdemucs/*/drums.wav` at `sr=22050`,
matching `stem_remixer.REMIX_SR`, via
`D:\conda-envs\nma-studio-cuda\Scripts\python.exe` (librosa 0.11.0).

Lessons that generalise:

- Reproducing a number is not validating it - re-run with a second independent
  method (section 3).
- Always include a control row (section 7).
- A surprising agreement between two unrelated items is usually a shared default,
  not a shared property (sections 2, 4).
