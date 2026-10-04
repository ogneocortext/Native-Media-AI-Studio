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

**At this point 2 of 5 library tracks produced a usable tempo.** Section 6a
supersedes that: a third estimator later settled both open cases.

## 6a. Resolution: essentia in WSL settles what librosa and madmom could not (2026-10-02)

The open question above — *is* Human-in-the-Loop at 71.8 or 142? — was answered
by a third, independent algorithm. See section 11 for how it was run.

| track | librosa | madmom | **essentia (multifeature)** | resolution |
|---|---|---|---|---|
| take-the-crown | 152.00 | 150.00 | **150.22** | madmom + essentia agree |
| Ad-Nauseam | 143.55 | 72.29 | **143.63** | librosa + essentia agree |
| Human-in-the-Loop | 71.78 | 71.43 | **142.39** | **essentia doubles both** |
| ec2c16... (10s fixture) | 99.38 | 120.00 | 122.28 | madmom + essentia agree |
| demucs_test_input (10s fixture) | 152.00 | 152.00 | 120.03 | all three disagree |

**This corrects two earlier claims in this document.**

1. **Human-in-the-Loop is at ~142 BPM, not ~72.** librosa *and* madmom both
   returned the half-tempo reading and agreed with each other, so agreement between
   two estimators proved nothing here. essentia returns 142.39 — within 0.1% of
   Ad-Nauseam's 143.63. The "suspect" label in the table above was right and the
   consensus reading was wrong.
2. **On Ad-Nauseam, madmom is the outlier**, not librosa. madmom's 0.504 ratio was
   previously reported as a shared failure of the octave problem; with essentia
   corroborating librosa, it is madmom that folded.

The two 10-second fixtures disagree across all three methods. That is consistent
with them being test fixtures, and they should be excluded from ranking anyway
(`MIN_SOURCE_SECONDS` in `RemixPanel` already does this).

### The rule this supports

> Accept a tempo only when **two of three independent estimators agree within ~5%
> after octave folding**, taking the majority's octave.

Single-estimator agreement is not evidence. The sharpest lesson: two independent
methods agreeing on a *wrong* octave is exactly what the majority vote exists to
catch.

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
   histogram addresses. **Now superseded** - see section 11. The comb-filter
   `tempo` module is *not* in `madmom-infer` (it ships only `beats_hmm` and
   `downbeats`), and on this material the installed port folded Ad-Nauseam to
   72.29 where essentia and librosa both said ~143.5.

4. **Use essentia's RhythmExtractor2013 (WSL) - now the recommended path.** It is
   the third independent estimator section 6a relies on, and it is the only
   candidate that actually resolved a disputed octave. See section 11.

### Tools surveyed

- **madmom-infer 0.2.0** (installed, Windows) - RNN beat/downbeat tracking. Ships
  `beats_hmm` and `downbeats` only; the comb-filter `tempo` module the 2015 paper
  describes is **absent from this port**. It has the same octave ambiguity and
  folded Ad-Nauseam, so it is a useful second opinion but not a resolver.
- **essentia 2.1b6.dev1438** (installed, **WSL only**) - RhythmExtractor2013 with
  `multifeature` and `degara` methods. The third estimator; see section 11.
- **BeatNet** (not installed) - CRNN + particle filtering, streaming and offline,
  sub-50ms latency, also does downbeat and meter.
- **librosa 0.11.0** (installed) - `beat_track`, `feature.tempo`,
  `feature.chroma_cens`. Lightest option, and the weakest of the three on octave
  handling.
- **aubio 0.4.9** (builds, but not recommended) - see section 12.
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

- **Two independent methods agreeing is still not proof** — they can fold to the
  same wrong octave. That is what the third opinion in section 6a is for.
- Read the failing line, not just the error class. `Failed building wheel for
  essentia` reads like a missing compiler; the actual `IndexError` was
  `glob.glob('tmp/lib/python*/*-packages/essentia')[0]` returning empty because the
  build assumes a POSIX layout. No compiler fixes that.

## 11. How essentia runs here: WSL only, and why

**essentia cannot be installed on Windows, at all.** Verified, not assumed:

- Its own docs: *"Essentia C++ library and extractors based on it can be compiled
  and run correctly on Windows, but **Python bindings are not supported yet**."*
- No Windows wheel on PyPI. Latest is a 2019 sdist; `2.1_beta5` ships cp27-cp37
  `manylinux` only.
- Upstream issue #1495, "Python bindings for Windows", opened Dec 2025 - still
  open, unassigned.
- **The build failure is structural.** `pip install essentia` on Windows dies at
  `setup.py` line 46:
  `library = glob.glob('tmp/lib/python*/*-packages/essentia')[0]` -> `IndexError`.
  The build runs `waf configure` first and expects Unix output paths. MSVC 14.44
  and 14.51 are both installed on this machine and neither helps: the problem is a
  filesystem assumption, not a missing toolchain.

### The working route

WSL2 Ubuntu 26.04 (already installed, used for Node tooling - nvm/Node 24 and
`openclaw`). essentia installs there from a **prebuilt manylinux wheel**, no
compile:

```
apt-get install -y python3-venv python3-pip
python3 -m venv <venv>
<venv>/bin/pip install essentia      # -> 2.1b6.dev1438, cp314 manylinux2014_x86_64
```

Usage: `RhythmExtractor2013(method="multifeature")(audio)` returns a 5-tuple;
index 0 is BPM and index 2 is confidence. `MonoLoader(filename=..., sampleRate=44100)`
reads the file.

### Operational notes

- **Throughput:** ~34x realtime (124 s of audio analysed in 3.6 s). A 10 s clip
  takes ~0.3 s. Fast enough to run inside a probe, not just offline.
- **Deterministic:** three repeats on Human-in-the-Loop all returned 142.39.
- **`/tmp` is wiped between WSL sessions.** A probe venv placed there vanished
  mid-investigation. Anything persistent must live outside `/tmp`.
- **Disk:** the WSL virtual disk is a 24.69 GB `ext4.vhdx` on C:, of which
  `/var/snap` is 18 GB (pre-existing snap data, not ours). The essentia venv is
  ~128 MB. On a machine where C: is nearly full, place the venv on D: via
  `/mnt/d` rather than growing the C: vhdx.

## 12. aubio: builds, then fights you (not recommended)

`pip install aubio==0.4.9` **does** build on Windows given MSVC - it produced
`aubio-0.4.9-cp311-cp311-win_amd64.whl`. But every documented calling convention
fails on this build:

| call | result |
|---|---|
| `aubio.tempo(path)` | `failed creating tempo` |
| `aubio.tempo(aubio.source(...))` | `argument 1 must be str` |
| `aubio.tempo(src, samplerate=...)` (the documented form) | `invalid keyword argument` |
| `aubio.onset(path)` / `aubio.pitch(path)` | `failed creating onset/pitch` |

Reproduced on a synthetic 120 BPM click train and on a space-free temp path, so it
is neither the audio nor the spaces in `D:\Backup of Important Data...`. The only
form that works is undocumented: construct with no args and hand-feed 512-frame
buffers.

Measured with that workaround: 152.37 and 152.17 on the two tracks where all
methods agree, but **133.03 at confidence -13.14** and **192.45 at confidence
-0.00** on the two disputed ones. It corroborates nothing that is in dispute.

Rejected: it would mean a hand-rolled buffer-feeding loop around a 2019 sdist
(last release 2019-02-08) whose documented API does not work, in exchange for
agreement only on cases already agreed.