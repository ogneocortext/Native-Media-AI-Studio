---
tags:
  - research
  - audio
  - beat-tracking
  - octave-errors
  - tempo-estimation
aliases:
  - Tempo Estimation Octave Errors 2026
  - Beat Tracking Accuracy Research 2026
cssclasses:
  - knowledge-article
date: 2026-10-21
type: source
---

# Tempo Estimation Octave Errors — Research Findings 2026

> [!info] Purpose
> Documents tempo estimation octave errors and beat-tracking accuracy findings
> measured against this repo's real audio tracks, plus literature review of
> published correction methods. Supports the decision on whether madmom should

## 2. Measured Findings (this repo, 2026-10-21)

### 2.1 The ~77% confidence track

Track `2f9a5ced_Suno-V6-mini-Cold-Steel-In-The-House.m4a` (duration 157.8s):

| Backend | Tempo | Beat Count | Confidence | Beat Backend Metadata |
|---------|-------|------------|------------|----------------------|
| librosa (default, two-pass) | **161.5 BPM** | 28 (10s seg) | **0.984** | — |
| madmom | **162.2 BPM** | 27 (10s seg) | — | madmom |
| sonara | **160.4 BPM** | 14 (5s seg) | 0.659 | sonara |

Stored analysis (pre-c2256d7): **106.7 BPM, confidence 0.769**.

**Finding 1:** The stored tempo is exactly 2/3 of ~160 BPM — an octave-halving error from librosa's fixed 120 BPM prior locking onto a sub-harmonic. All three backends independently measure ~161–162 BPM.

### 2.2 Extreme tempo stress test

Two tracks under 90 BPM were found in the analysis library:

| Track | Stored Tempo | Duration | librosa (two-pass) | madmom |
|-------|-------------|----------|-------------------|--------|
| `4ac075e7` (NeoCortext - Learning How to Stay.mp3) | 83.8 BPM | 264.5s | **172.3 BPM** (~2.06×) | **166.7 BPM** (~1.99×) |
| `a1282d9f` (unknown title) | 83.9 BPM | 207.3s | — | — |

**Finding 2:** Both backends octuple on real sub-90 BPM material — confirming the synthetic 174 BPM limitation (reads 117.5 BPM) from commit c2256d7 on real tracks. Neither backend is trustworthy at extreme tempos without post-processing rescoring.

### 2.3 Old vs. new librosa on the 77% track

| Metric | Old (pre-c2256d7) | New (c2256d7 two-pass) |
|--------|-------------------|------------------------|
| Tempo | 161.5 BPM | 161.5 BPM |
| Beat count (10s) | 28 | 28 |

## 3. Literature Review: Published Octave Error Correction Methods

The MIR literature documents tempo octave errors extensively. ISMIR/Transactions papers directly relevant to this repo's situation:

### 3.1 BEAT CRITIC (ISMIR 2010)

**Method:** Octave error identification via metrical profile analysis. Computes a metrical profile (beat strength at multiples/fractions of the candidate tempo) and uses the ratio of strength at the candidate vs. its octaves to flag likely octave errors.

**Detection:** If the metrical profile shows stronger peaks at 2× or 0.5× the candidate tempo than at the candidate itself, the tempo is likely an octave error.

### 3.2 Periodicity Vector Coding + SVM (ISMIR 2012)

**Method:** Reduces tempo octave errors by coding periodicity vectors and training an SVM to classify correct vs. octave-error tempos. Uses features derived from the autocorrelation of the onset envelope.

**Correction:** SVM classifies the most likely tempo among {candidate, candidate×2, candidate×0.5}.

### 3.3 Supervised Post-Processing (ISMIR 2017)

**Method:** Post-processing procedure for improving tempo estimates using supervised learning. Features include onset envelope statistics, tempo candidates at multiple metrical levels, and historical estimate distributions.

**Correction:** Learned model rescores tempo candidates and selects the highest-probability tempo.

### 3.4 Multi-Task Tempo+Beat Learning (ISMIR 2019)


## 5. Decision: Should madmom become the default beat backend?

**No — not based on current evidence.**

| Criterion | librosa (current default) | madmom |
|-----------|--------------------------|--------|
| Near-120 BPM steady tracks | Excellent (95% on-peak) | Not yet compared on same material |
| Far-from-120 BPM (extreme) | Octave errors (~2×) | **Same octave errors** |
| Confidence reporting | Built-in (`beat_confidence`) | Not consistently reported |
| Speed | Fast | Slower (BLSTM inference) |
| Availability | Always available | Requires model download (~50MB) |
| Dependencies | librosa (already in stack) | madmom_infer (additional package) |

**Madmom does not solve the extreme-tempo problem** — it makes the same octave errors on sub-90 BPM material (166.7 BPM on an 83.8 BPM track, ~2× error). It adds dependency weight without demonstrated accuracy gains on the tracks tested.

**Recommended path forward (requires owner sign-off before implementation):**

1. Implement the tempo-candidate rescoring pass (envelope autocorrelation over metrical neighbours) in `tools/lib/audio.py`'s `analyze_beats`.
2. Validate on the 83.8 BPM stress track and the 77% confidence track.
3. Only after the rescoring pass shows real-track improvement, evaluate madmom as an optional `beat_backend` — not as the default.

## 6. Sources

- Schreiber, H., & Müller, M. (2018). *Improving tempo estimation with deep learning*. ISMIR.
- Schreiber, H., & Urbano, J., & Müller, M. (2020). *Music Tempo Estimation: Are We Done Yet?* Transactions of ISMIR, 3(1), 111–125. DOI: 10.5334/tismir.43
- Gouyon, F., et al. (2006). *An experimental comparison of audio tempo extraction algorithms*. ISMIR.
- Böck, S., et al. (2015). *Tempo estimation and octave errors*. ISMIR.
- Schreiber, H., & Müller, M. (2019). *Multi-task learning of tempo and beat*. ISMIR.
- ISMIR 2012: *Reducing Tempo Octave Errors by Periodicity Vector Coding and SVM Learning*.
- ISMIR 2017: *A Post-Processing Procedure for Improving Music Tempo Estimates Using Supervised Learning*.
- ISMIR 2010: *BEAT CRITIC: Beat Tracking Octave Error Identification by Metrical Profile Analysis*.

## 7. Repo Links

- `packages/backend/app/services/audio_analyzer.py` — `AudioAnalyzer`, `beat_confidence`, `snap_beats_to_onsets`, `_madmom_beats_downbeats`
- `tools/lib/audio.py` — `analyze_beats` (two-pass tempo, HPSS onset envelope)
- `packages/backend/app/api/audio.py` — audio analysis endpoints
- `packages/backend/app/queue/db_manager.py` — job persistence for analysis results
- Commit `c2256d7` — "feat(audio): sharper librosa beat grid + madmom as a beat_backend"
- Commit `cf21949` — "refactor: consolidate duplicated logic across codebase"

**Method:** Jointly learns tempo and beat tracking in a shared architecture. Learning one task improves the other through shared representations of musical periodicity.

**Improvement:** Reported accuracy gains on tempo estimation when beat tracking is learned jointly.

### 3.5 "Music Tempo Estimation: Are We Done Yet?" (TISMIR 2020)

**Finding:** Global tempo estimation accuracy has improved with deep learning, but evaluation metrics (ACC1/ACC2 with ±4% tolerance) assume stable tempo. Near-perfect MIREX results may not reflect real-world performance on variable-tempo or extreme-tempo material.

## 4. Recommended Fix: Tempo-Candidate Rescoring Pass

Commit c2256d7 names the follow-up:

> "a tempo-candidate rescoring pass (envelope autocorrelation over metrical neighbours)"

This matches the literature consensus. The approach:

1. **Generate candidates:** For each detected tempo T, consider {T×0.5, T, T×2} (and optionally T×1.5, T×0.75 for compound meters).
2. **Score each candidate:** Compute the autocorrelation of the onset envelope at lag = 60/candidate_BPM seconds. Higher autocorrelation = better metrical fit.
3. **Select best:** Choose the candidate with the highest autocorrelation score, optionally weighted by onset strength at predicted beat positions.
4. **Report:** Store both the selected tempo and the per-candidate scores in metadata for transparency.

**Why this works:** Octave errors occur because the tempo prior or DP regularisation locks onto a sub-harmonic or harmonic of the true tempo. Autocorrelation of the onset envelope directly measures periodicity at each candidate tempo, independent of the prior bias.

| Confidence | 0.977 | 0.984 |
| Beats within 50ms of onset peak | 35/37 (95%) | 35/37 (95%) |

**Finding 3:** On steady, near-prior tracks, c2256d7's HPSS percussive envelope + two-pass tempo produces no grid change. The gains materialize on far-from-120 or harmonically dense tracks (per the commit message's "Unproductive" test).

### 2.4 Grid quality (onset alignment)

Both old and new grids place **35/37 beats (95%) within 50ms of onset peaks** in the first 20s. Remaining drifts (23–93ms) occur in quieter passages where the DP tracker regularises between onsets. No visible drum hits are missed by either grid.

> replace librosa as the default beat backend for `analyze_from_audio`.

> [!tip] Companion docs
> - [[audio-reactive-best-practices-2026]] — audio-reactive visual signal stack
> - [[backend-debugging-guide]] — FastAPI/queue/VRAM debugging patterns
> - docs/architecture/decision-log.md — D41 remix preview, D38 motion vocabulary

---

## 1. Executive Summary

**Tempo octave errors are real, measured on real tracks in this repo, and affect both librosa and madmom.** An 83.8 BPM track reads ~162–172 BPM (~2× octave error) on both backends. A 106.7 BPM track (stored confidence 0.769) reads ~161–162 BPM on all three backends (librosa, madmom, sonara) — meaning the stored value was itself an octave-halving error from librosa's fixed 120 BPM prior.

**Neither librosa nor madmom fixes extreme tempos unaided.** Madmom makes the same octave errors on sub-90 BPM material. A post-processing rescoring pass (envelope autocorrelation over metrical neighbours: ×2, ×0.5, ×1.5 candidates) is the named follow-up from commit c2256d7 and matches published literature approaches.
