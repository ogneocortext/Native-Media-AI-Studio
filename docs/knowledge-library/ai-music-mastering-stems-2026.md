---
tags:
  - production
  - audio
aliases:
  - AI Music Mastering 2026
  - Stem Splitting Mastering Research
  - Mastering and Stems for AI Music
cssclasses:
  - production-guide
date: 2026-10-02
---

# Mastering & Stem Splitting for AI-Generated Music — 2026 Practices

> [!info] Purpose
> Web research (2025-12 → 2026-08) on finishing AI-generated music: loudness
> targets, AI-specific tonal defects, what stem splitting can and cannot fix,
> and how to run Demucs well on an 8 GB workstation. Synthesized with an
> explicit gap analysis against this repo's current audio stack (Master EQ,
> StemMixer, analysis pipeline). Sources listed at the end.

> [!tip] Companion docs
> [[stem-system-evaluation-2026]] (per-stem pipeline audit),
> [[audio-reactive-best-practices-2026]] (visual side),
> [[visualizer-ux-audit-2026-10]] (live findings incl. the P0 stem bug),
> D4 (stem stack), D2 (env separation), D7 (8 GB VRAM budget).

---

## 1. Measure before touching anything

Every 2026 source agrees the workflow starts with three numbers read off the
actual file:

- **Integrated LUFS** (ITU-R BS.1770 — `pyloudnorm` is the standard Python
  implementation);
- **True peak in dBTP** (inter-sample peaks — sample peak can read -0.1 dBFS
  while true peak is above 0, and lossy encoders will clip it);
- **Loudness range (LRA)** — whether dynamics are even worth preserving.

**Streaming targets (2026):**

| Platform / use | Integrated | True-peak ceiling |
|---|---|---|
| Spotify / YouTube / Amazon (normalization) | -14 LUFS | -1 dBTP (Amazon: **-2 dBTP**) |
| Apple Music (Sound Check) | -16 LUFS | -1 dBTP |
| Competitive / TikTok, SoundCloud, sync | -10 … -12 LUFS | -1 dBTP |
| Genre-loud starting points (pop/EDM/metal per one source) | -8 … -9.5 LUFS | -1 dBTP |

Normalization means one master serves all platforms: loud files are turned
down cleanly; quiet files may only be raised as far as peak headroom allows.
So **never master quietly** — a -20 LUFS track may only be lifted to ~-16.
Amazon's -2 dBTP is the one genuine per-platform exception.

> Note the sources disagree on where raw AI exports land (one measured median
> **-15.2 LUFS** across 12 exports; another claims **-8 … -10**). Both can be
> true across generators/settings — which is the point: **measure each track,
> never assume.**

## 2. The AI-specific defects (what to fix, in order)

Recurring across Suno/Udio analyses in 2026 sources:

1. **Low-mid mud, 250–500 Hz** — generated instruments, vocal warmth and
   rendered reverb all pile into the same band. Fix: wide gentle
   **subtractive** cut, 1–3 dB (the "de-mud" move).
2. **Fizz / sheen, 4–7 kHz** — the "plasticky at low volume, fatiguing at high
   volume" AI signature. A static cut dulls the whole track; the right tool is
   a **dynamic EQ / resonance suppressor** that engages only when the band
   spikes.
3. **Side-channel artifact fog below ~2 kHz** — L/R decoded somewhat
   independently leaves codec hash, shimmer and non-mono bass in the *side*.
   Fix: M/S processing — clean the side, keep mid intact. Measured as the
   single most consistent move across genre test sets.
4. **Bass that should be mono isn't** — collapse low frequencies below a
   crossover (~100–150 Hz) to mono; phones/club systems are mono.
5. **Missing content (MP3 sources)** — nothing above ~16 kHz, quantization
   noise in 2–5 kHz. **Restore first, master second**, or mastering exaggerates
   the artifacts.
6. **Already-compressed dynamics** — do not chase loudness by slamming a
   limiter into an AI mix whose dynamics were spent at generation time; it
   distorts fast. Fix tone + true peak, then set level.

**QC checklist before release:** re-measure LUFS/TP after processing; mono
fold-down (does the vocal/bass vanish?); phase correlation; DC offset; listen
once on earbuds and once on a laptop speaker.

## 3. What stem splitting is (and is not)

- **Estimation, not extraction.** The original multitrack is not hidden in the
  stereo file; the model guesses masks. Artifacts are structural: spectral
  bleed (snare in the vocal), metallic ringing/reverb tails, tonal shift,
  low-end mud (kick vs bass fundamentals share 40–120 Hz). No 2026 model is
  artifact-free.
- **2-stem beats 4-stem when you only need vocals/instrumental** — solving for
  one source yields a better instrumental. **>4 stems degrades sharply**
  (piano in a dense mix is the classic failure).
- **Input quality decides output quality.** Feed lossless (WAV) when possible;
  heavily limited masters separate worse than dynamic ones; quiet inputs
  underperform — normalize to roughly **-14 LUFS / -1 dBFS peak before
  separation**.
- **Bleed means: use stems for balance, not surgery.** Vocal up 2 dB, mute a
  section, re-arrange, karaoke/instrumental versions — these survive bleed.
  Surgical per-track editing does not; every edit makes the bleed audible.
- **Master the full mix, not a stem-reconstructed one.** Re-summing processed
  AI stems compounds reconstruction artifacts and breaks the inter-track
  relationships mastering engines analyze. Deliberate corrective stem moves
  (de-ess the vocal, re-balance) are legitimate; "separate → master each →
  recombine" as a default is not.
- **Separate vocal → Whisper** is a well-established win: isolating the voice
  before transcription raises ASR accuracy — directly relevant to this repo's
  D4 faster-whisper step.
- **Per-stem post-chain** when stems go to production: time-align to bar 1,
  high-pass ~30–40 Hz (except kick/bass), narrow notch for metallic ringing,
  de-ess vocals 5–8 kHz (separation exaggerates sibilance), broadband denoise
  for the noise floor, then check mono/phase before summing back.

## 4. Running Demucs well (operational practice)

From the Demucs repo and 2026 production guides, mapped to this workstation's
8 GB (D7):

| Knob | Practice |
|---|---|
| model | `htdemucs` default; `htdemucs_ft` only for hero/mastering deliverables (**4× slower**, +~0.2 dB SDR with shifts); `mdx_extra_q` for low VRAM |
| `--two-stem=vocals` | when only vocal/instrumental is needed — better result than discarding 4-stem output |
| `--shifts` | 1 drafts, 2–5 deliverables (GPU only — each shift is a full extra prediction) |
| `--overlap` | 0.25 default; 0.5 when seam artifacts bother you (2× time) |
| `--segment` | memory/quality trade; shrink on OOM *gradually* (small = seams); HT models cap at 7.8 s |
| OOM ladder | shrink segment → `PYTORCH_NO_CUDA_MEMORY_CACHING=1` → CPU fallback (`-d cpu`, ~1.5× track duration) — treat OOM as normal, not exceptional |
| idempotency | job key = `sha256(content + model + params)`; cache the result — never re-separate on retry/double-click |
| observability | log per job: model, shifts/overlap, seconds, GPU/CPU — so "why is this track slow/poor" is answerable |
| clip mode | Demucs auto-rescales stems to avoid clipping, **which can break relative stem volumes**; `--clip-mode clamp` keeps levels but risks clipping — know which one your mixer assumed |

**VRAM reality check (D2/D7):** separation runs in `nma-studio-cuda`, serially
against the queue — never alongside a ComfyUI generation on the same 8 GB.

## 5. Gap analysis vs this repo (verified 2026-10-02)

| Practice | Repo status | Verdict |
|---|---|---|
| Stem separation engine (Demucs 4.1 + hierarchical UVR5) | exists (D4) but **every run raises `AttributeError: source_path`** | ❌ P0 — audit §1.1 |
| Segment/overlap/denoise knobs exposed in UI | yes (StemMixer MODE/SEGMENT selects) | ✅ |
| Quality presets (draft vs deliverable: shifts/overlap/model) | `shifts` not exposed; no draft/deliverable tiers | ⚠️ P2 |
| Idempotency cache (content+params key) | `find_stem_dir` + analysis cache exist; separation cache keying unverified | ⚠️ P2 |
| Input normalization before separation | not done | ⚠️ P2 |
| 2-stem vocal option for ASR / karaoke | MDX-Net vocal models selectable in backend; no 2-stem UI shortcut; transcription does **not** pre-separate vocals | ⚠️ P2 |
| LUFS / true-peak measurement | **absent** — Master EQ is six static EQ presets (flat/warm/bright/vocalPresence/bassBoost/aiStudio), no meter, no limiter | ❌ P1 — core gap |
| Platform targets / export QC (mono, phase, TP) | absent | ❌ P2 |
| Dynamic de-harsh / M/S side cleanup / mono bass | absent (static EQ only) | ❌ P2 |
| Pre/post stem QC copy (bleed warning, time-align) | StemMixer shows per-stem load failures (D4) but no bleed/quality guidance | ⚠️ P3 |
| Analysis exists for committed tracks | yes, but keyed by hashed filename — display-name lookups 404 | ❌ P0 — audit §1.2 |

**The headline:** this app has the *separation* half (broken, §P0) and a static
EQ named "Master EQ" — but none of the *measurement* that defines mastering
(2026 practice starts with LUFS/TP/LRA and ends with a QC report). The
research-backed path is: **fix separation → add a measure/normalize/limit
pass → add the AI-defect chain (de-mud, dynamic de-harsh, M/S side, mono bass)
→ QC report.**

## 6. The chain was written, not working (2026-10-02)

`suno_enhancer.py` — the 14-step chain this document's §2 describes — had never
produced a single output file. It aborted at step 5 on every run, and five
defects were stacked behind that first one, each hiding the next. Every number
below is measured on `output/stems/htdemucs/SunoV6Mini-Ad-Nauseam` (209 s, four
stems), comparing the rendered file against the summed stems in matched 20 s
windows.

| # | Defect | Symptom |
|---|---|---|
| 1 | `_db_to_linear` used `math.pow` on an ndarray | aborts: `only 0-dimensional arrays can be converted to Python scalars` |
| 2 | `np.convolve` on a (channels, samples) array | `ValueError: object too deep for desired array` |
| 3 | compressor looped the channel axis | right channel never compressed |
| 4 | limiter looped the channel axis | ceiling never engaged; peak −14.4 dBFS |
| 5 | step 2a called `_high_pass(y[0], …)` | every stem became mono; exported `channels=1` |

Defects 3 and 4 are the same mistake in two places: `for i in range(len(y))` on
a `(2, N)` array iterates *channels*, not samples. Any DSP helper that loops over
its input needs the channel axis handled explicitly.

### The two that made the output actively worse than its input

Both were found by measuring the render, not by reading the code, and both are
worth carrying to any future chain:

**The reverb was drowning the track.** `_reverb_and_delay` peak-normalised its
white-noise impulse response. Peak is the wrong normaliser for convolution:
noise of length N scales RMS by `ir_rms · √N`, which for a 1.8 s IR is ≈6× *before*
`mix` is applied. Measured: **87.8% of output energy was the reverb tail**, and the
noise floor in a quiet passage sat at −22.4 dBFS against −32.2 dry — a 9.8 dB hiss
across the whole track. L2-normalising the IR makes `mix` mean what it says:
reverb contribution **87.8% → 4.8%**, noise floor **−22.4 → −32.0 dBFS**.

**The high-pass was deleting the bass.** `pre_highpass_hz` was `120.0`, against
this module's own stated intent (strip rumble, ~30 Hz) and its `_high_pass`
default of `30.0`. On the 48 kHz source, **62.0% of all energy is below 120 Hz**,
so 89% of the 10–250 Hz bass band was being removed. That is not a rumble
filter; it is the opposite of one.

Combined, measured the same way at each step:

| | correlation with stems | bass delta (t=20/60/120/180 s) |
|---|---|---|
| peak-normalised IR | 0.19 | −6.7 −11.4 −37.0 −41.8 |
| + L2-normalised IR | 0.53 | −10.4 −8.7 −31.4 −32.9 |
| + 30 Hz high-pass | **0.86** | +5.6 +10.3 −9.8 −15.5 |

Crest factor ended at 18.16 dB against 16.02 dB in the stems — slightly *more*
dynamic range than the source, which is the opposite of the flat, lifeless
character these renders exist to correct.

### Two mixer designs that were both wrong

Worth recording because they look equally reasonable and each made the result
worse in a different direction:

- **Normalising weights to sum to 1.0 across four stems** divided the bus by
  ~4 (−12 dB) before the limiter, so the ceiling never engaged.
- **1/RMS per channel** rebalanced stems against each other: stem RMS spans
  −21.1 (bass) to −27.1 dBFS (other). Crest fell 16.0 → 5.7 dB.
- **Peak-normalising each stem** was also wrong, because crest factor differs
  by stem type — vocals peaked at −12.5 dBFS and bass at −3.1 dBFS, so it pushed
  vocals up 6.5 dB relative to drums.

The fix is the boring one: **sum the stems as separated and apply a single gain
to the sum.** Any per-stem normalisation discards balance the separator already
got right.

### The compressor threshold was attenuating, not compressing

The last real loss. Isolating each step on the **drums** stem (bass fraction,
before → after) showed every step flat to within 0.4 points except one:

```
  raw                 84.0%
  lufs_gain_stage     84.0%
  normalize_peak      84.0%
  compress            62.8%   ← here
  stereo_widen        62.8%
  weight_bus          62.8%
  reverb_and_delay    63.2%
```

`threshold_dbfs` was applied literally, and the configured **−24.0 dBFS sits
below the stem's own RMS** (measured −19.7 dBFS). A compressor whose threshold is
under the programme's average level is not compressing peaks — it is attenuating
everything, continuously. Measured: gain reduction active **36% of the time**,
mean −2.6 dB, worst frame −14.7 dB. Because gain reduction scales with level, the
loudest content is ducked hardest, and in a kick-heavy stem the kick *is* the
loudest content.

`threshold_dbfs` is now an **upper bound**, raised to sit 12 dB above the
material's measured RMS (`_adaptive_threshold`). A caller asking for a hotter
setting still gets it; a caller asking for −24 dBFS on a loud stem no longer
crushes the low end to satisfy it.

| | drums bass fraction |
|---|---|
| literal threshold | 84.0% → 62.8% |
| adaptive threshold | 84.0% → **83.8%** |

### Where it ended up

Measured against the summed stems, matched 20 s windows:

| t | stems bass | output bass | delta |
|---|---|---|---|
| 20 s | 41.3% | 66.0% | +24.7 |
| 60 s | 52.8% | 76.2% | +23.4 |
| 120 s | 71.2% | 72.4% | +1.1 |
| 180 s | 78.5% | 75.0% | −3.5 |

Correlation with the stems **0.9284**, `channels=2`, crest 15.26 dB against
16.02 dB in the source.

The two bass-heavy passages that previously lost 10–15% are now within 1–4%. The
two passages that now read ~+24% are doing so because the vocal stem is being
gated down ~9 dB, which raises bass as a *fraction* of what remains — a vocal
level decision rather than a defect, and adjustable via `vocal_balance_db`.

## 7. Community-reported V6 problems, checked against our audio (2026-10-02)

The claims below are from third-party sources, most of them vendors selling an
AI mastering product — so they are hypotheses, not evidence. Each was measured on
`SunoV6Mini-Ad-Nauseam` before anything was implemented. **Two held, one did
not**, and the one that failed is recorded because implementing it would have
added a useless stage.

| Community claim | Source | Measured here | Verdict |
|---|---|---|---|
| Vocals are buried | undetectr, from r/SunoAI threads over 3 weeks + 24-track spectrum measurement | vocal RMS **7.0 dB below** the rest of the mix | ✅ confirmed |
| V6 darkens over the track | masterforge, 26 tracks split to stems, 10 s windows | mean spectral centroid **3467 → 1279 Hz**, a 63% loss | ✅ confirmed |
| V6 narrows over the track | same | stereo width **0.32 → 0.41** — it *widens* | ❌ **does not reproduce** |
| 250–500 Hz low-mid pileup | freshlybakedstudios, from a 320k-song corpus | 250–500 Hz is 5.7% of the mix; 15.0% of the `other` stem | ⚠️ present but no baseline to judge severity |
| Exports land quiet, −16 to −19 LUFS | suno-down | our sources measure **−14.7 and −14.4 LUFS** via ffmpeg `ebur128` | ❌ **already on target** |
| High-pass at 30–40 Hz | suno-down, freshlybaked | matches the fix already made in §6 | ✅ corroborated |
| Master to −14 LUFS, −1 dBTP | every source | chain targets exactly this | ✅ corroborated |

### What the confirmed findings changed

**Buried vocals — the chain was making it worse.** The single loudest V6
complaint is buried vocals, and the vocal was *already* 7.0 dB down before the
chain ran. The chain then took another **−9 dB** out of it.

The cause was `_spectral_gate`, and it was not doing what its name said. Its
threshold was **absolute** (`_db_to_linear(-40)` ≈ 0.01 in STFT magnitude
terms), but librosa STFT bin magnitudes for normal programme audio run 1e-4 to
1e-2 — so most bins, including most of the vocal's actual content, sat *below*
the line and were gated down. Two further mistakes compounded it: the threshold
was compared against the whole signal rather than each frame's own peak, and
`gate = env / mag` was applied even to bins the envelope had declared *open*
(`env` is an EMA, so it lags below instantaneous magnitude and the ratio lands
under 1 regardless). Net effect: a noise gate that functioned as a broadband
compressor on the vocal.

Gating is now relative to each frame's peak, and open bins pass at unity.
Measured on the vocal stem: **−8.99/−9.59 dB → −0.04/−0.06 dB**.

**Progressive darkening — a static chain cannot fix it.** The centroid fall is
the source doing it, not the mix, and it needs a *different* gain at 60 s than
at 200 s. `_restore_high_end_drift` measures high-band-to-low-band energy per
window, takes the opening quarter as the reference, and applies a smoothed,
capped gain to the high band. Capped at 4 dB on purpose: a curve that tracks the
drift exactly also tracks the arrangement, and pumping the top end up 10 dB into
an outro is a worse artifact than the drift it fixes.

Measured end-to-end, spectral centroid by position:

```
stems    5%:3467  25%:3415  50%:3078  75%:1824  95%:1279
output   5%:3382  25%:3391  50%:3102  75%:1998  95%:1402
```

### What was deliberately not implemented

- **Stereo-width restoration.** The research says V6 narrows; it does not, on the
  track we have. A width stage would be a no-op that still costs CPU and adds a
  knob nobody can hear.
- **250–500 Hz corrective EQ.** The band is measurable but there is no reference
  master here to say how much is too much, and the one concrete prescription
  found (a 2–3 dB vocal cut at 200–400 Hz) would be applied blind.
- **Loudness work.** Our sources already measure −14.7/−14.4 LUFS, which is the
  target. Nothing to fix.

### Where it ended up

Correlation with the summed stems **0.9746** (was 0.19 before this session),
`channels=2`, crest 15.07 dB against 16.02 dB in the source.

The vocal still sits 7.6 dB below the rest — **that is now the separation's
balance, not the chain's doing**, and it is a mixing decision rather than a
defect. `vocal_balance_db` exists for exactly this; no default is imposed,
because lifting a vocal by the right amount is a taste call and the sources
disagree about it.

Still not established: that any of this *sounds* better. Every number here is a
fidelity measurement, not a listening test.

## 8. Remixing across stems — what is automatable, and what is not (2026-10-02)

Added `services/stem_remixer.py` + `/api/audio/remix/*`. The design constraint
that shaped everything: a remix is rendered as a **plain four-stem directory**
(`vocals/drums/bass/other.wav` + `remix.json`), so the enhancer chain,
`/api/audio/stem-file` and the visualizer consume it with no special-casing.
Only the arrangement is new.

An arrangement is a list of **slots over a bar grid**; each slot names the stems
playing in its span. "A's drums under B's vocals, then swap" and "everything at
once" are the same mechanism with different slot contents.

### Tempo matching works automatically

Measured on this library, stable across runs:

| Track | BPM |
|---|---|
| take-the-crown | 151.999 |
| SunoV6Mini-Ad-Nauseam | 143.555 |
| SunoV6Mini-Human-in-the-Loop-V2 | 135.999 |

Sources are time-stretched by `target_bpm / source_bpm` with
`librosa.effects.time_stretch`, which changes duration without moving pitch.

### Key matching does not, and the service refuses to fake it

Chroma flatness (geometric/arithmetic mean) measured on the separated stems:

| Track | Flatness | Krumhansl r | argmax run 1 → run 2 |
|---|---|---|---|
| ec2c1675… | 0.9803 | 0.16 | E → E |
| fc37eecb… | 0.9784 | 0.15 | E → E |
| SunoV6Mini-Ad-Nauseam | 0.9841 | 0.10 | A# → F |
| SunoV6Mini-Human-in-the-Loop-V2 | 0.9800 | 0.48 | C → C |
| take-the-crown | 0.9936 | 0.21 | E → E |
| f259df2d… | 0.9975 | 0.03 | C# → C# |

1.0 is pure noise, ~0.1 is a single pitch. These profiles are flat, so the
profiles carry essentially no pitch information. Ad-Nauseam even changed its
argmax between two runs (A# → F). **Auto-applying that would pitch-shift a stem
by an arbitrary amount** — worse than leaving keys unmatched. So
`key_shift_semitones` is an explicit per-layer parameter, `probe_track` reports
`key_confident: false` on this material, and `KEY_CONFIDENCE_FLOOR = 0.60` is
never crossed.

### The trap that is not obvious

Several tracks open instrumentally. Ad-Nauseam's vocals are silent for the
first **7.06 s** (peak −57 dBFS). A layer placed at `source_start_bar=0` renders
a digitally silent stem that looks like a broken mixer, not like an intro.
`probe_track` therefore reports `first_audible_sec`, and `preview_recipe`
warns when a layer measures below −50 dBFS.

Confirming this was worth the detour: the first render showed vocals at
−83.8 dBFS, which looked like a renderer bug. Measuring the *source* showed
peak 0.7608 — the renderer was fine and the material was quiet. Chasing the
number also exposed that `bass` rendering at −25 dBFS was likewise the song's
own intro, not attenuation (source peak 0.0535 vs rendered 0.055).

### Crossfade: equal-power, and tested synthetically

`cos`/`sin` ramps, so summed power stays flat; a linear fade dips to ~0.5 of
unity at the midpoint. The test is deliberately synthetic: measured against
real material the overlap read ~3 dB low, but that is the song getting quieter
(drums drop from −18.9 dBFS overall to −26.8 dBFS over their first 6.3 s), not
a fade error. Two full-scale sines with known correlation answer the question
the fade actually poses.

### Sources (accessed 2026-10-02)
- librosa 0.11.0 docs — `beat.beat_track`, `effects.time_stretch`, `effects.pitch_shift`, `feature.chroma_cqt`

## Sources (accessed 2026-10-02)

- Erasy — *How to Master AI Music (2026)* (2026-07)
- TrackGleam — *How to Master AI-Generated Music* (2026-07) — 12-export measurements
- MixMasterAI — *Mix and Master Suno AI Tracks (2026)*
- Neural Analog — *Mastering for AI Music: LUFS, Streaming Standards* (2025-12)
- Undetectr — *AI Music Mastering for Streaming* (2026-03)
- Remasterify — *Stem Splitting vs Full-Mix Mastering* (2026-08)
- MasterForge — *13 Tracks, 13 Recipes* (2026-05) — M/S side-channel findings
- Dubspot — *How to Mix AI-Generated Stems* (2026-06)
- MusicProductionWiki — *AI Stem Separation Guide* (2026-05)
- Mixing-and-Mastering.ai — *Stem Separation for Remix Workflow* (2026-05)
- Mr. Vocal — *AI Vocal Separation in 2026* (2026-05)
- Tomo dahinata — *Demucs v4 Production Guide* (2026-06); facebookresearch/demucs README
