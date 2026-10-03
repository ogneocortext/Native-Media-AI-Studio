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
