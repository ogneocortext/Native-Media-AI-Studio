# Audio Mastering & Stem Quality Plan — Oct 2026

**Status:** Proposed 2026-10-19 — awaiting owner review
**Decides:** none (extends `studio-quality-2026-10.md` Phase 3)
**Owner:** repo owner (implementation: local coding agent)
**Source research:** [[ai-music-mastering-stems-2026]], [[stem-system-evaluation-2026]]

> Read `docs/architecture/decision-log.md` before implementing. New backend routes
> belong in the module matching their responsibility per D15: mastering routes go
> in `audio_mastering.py` (new module) or `audio_edit.py`, registered in `main.py`.

---

## Problem

The studio's audio pipeline has three gaps that affect output quality and user trust:

1. **No mastering control** — Users cannot normalize to platform targets (Spotify -14 LUFS, Apple -16 LUFS) or apply true-peak limiting. The audio goes from separation → visualization → export with no delivery loudness standard.
2. **Stem separation UX gaps** — No idempotency (re-running wastes GPU), no draft/deliverable presets, no clarity that stems are reconstructions (not surgical tools), and no phase/mono checks.
3. **No quality metrics** — Exported audio has no QC report (LUFS, true peak, LRA, phase correlation), so users can't verify the output meets platform specs.

All three are Phase 3 items from `studio-quality-2026-10.md`, which remains blocked on nothing.

---

## Feature specs

### M1 — Mastering module (backend)

New `app/services/mastering.py` with pure DSP functions:

1. **Measure** — integrated LUFS, true peak (dBTP), loudness range (LRA) using `pyloudnorm` (BS.1770) plus a true-peak meter. Reuse existing audio loading where possible.
2. **Normalize/limit** — gain to target preset (`spotify -14 / apple -16 / competitive -11`, ceiling -1 dBTP, Amazon -2), then apply a true-peak limiter (look-ahead or ISP-safe oversampled ceiling).
3. **Tone (v1, static)** — conservative de-mud wide cut ~300 Hz, gentle presence control (the "safe half" of the AI-defect chain from the research doc). Dynamic de-harsh and M/S side cleanup are v2 and out of scope.
4. **QC report JSON** — before/after LUFS-TP-LRA, mono-fold delta, phase correlation — returned with the response and displayed next to the export.

**Backend routes** (new module `audio_mastering.py` per D15, registered in `main.py`):
- `POST /api/audio/master` — accepts `filename`, `target_lufs` (enum), `ceiling_dbtp`, `tone_fixes: bool`. Returns the mastered file path + QC report.
- `GET /api/audio/master/measure/{filename}` — measurement-only endpoint for preview.

**Frontend: Mastering panel** (new component under the audio analysis or stem mixer surface):
- Target preset chips (Spotify / Apple / Competitive / Amazon)
- Gain slider (manual override of auto-gain)
- True-peak ceiling slider
- Tone fixes toggle (static de-mud + presence)
- Preview A/B at matched loudness (quick-switch before export)
- QC metrics display (before/after LUFS, TP, LRA, phase)
- Export button that writes to `output/audio/mastered/`

**Acceptance:**
- Round-trip on a real track lands within ±0.5 LU of target
- True peak under ceiling (no clipping)
- QC numbers displayed match a re-measure of the exported file (D17's lesson: assert the artifact, not the intent)
- Unit tests for the DSP pipeline (mock audio, assert expected gains/limits)
- Live test: `POST /api/audio/master` on a real library track returns HTTP 200 + valid MP3/WAV

**Files:**
- Backend: `app/services/mastering.py`, `app/api/audio_mastering.py` (new), `main.py` (router registration)
- Frontend: `MasteringPanel.tsx` (new), wiring in audio analysis or stem mixer
- Tests: `tests/test_mastering.py` (backend), `MasteringPanel.spec.ts` (Playwright)

---

### M2 — Separation hardening

Enhancements to `services/source_separation.py` and the stem separation API:

1. **Pre-separation normalize** — normalize input to ~-14 LUFS / -1 dBFS before separation (research in the mastering doc shows quiet inputs underperform Demucs).
2. **Idempotency key** — `sha256(content + model + params)` → cache hit skips GPU entirely. Current behavior: double-click/retry re-runs Demucs from scratch.
3. **2-stem vocal shortcut** — feed the vocal stem to faster-whisper (D4) and expose karaoke/instrumental as first-class outputs (mirrors `--two-stem` semantics).
4. **Draft/deliverable presets** — `htdemucs` + shifts=1 for draft (fast), `htdemucs_ft` + shifts=2 for deliverable (4× time). Make the cost visible in the UI like D9's estimator does.
5. **Telemetry** — log per job: model, shifts, seconds, device (structured JSON) so "why is this slow" is answerable (extends D8 metrics path).

**Backend changes:**
- `source_separation.py`: add pre-normalization step, cache key computation, draft/deliverable preset logic, structured logging
- `audio_stems.py`: add `preset` parameter (`draft`/`deliverable`) to the separation endpoint, return estimated time before starting
- Frontend: add preset selector in stem mixer UI, show "Draft (fast, ~30s)" vs "Deliverable (high quality, ~2m)" labels

**Acceptance:**
- Identical separation requests (same file + params) hit cache and return instantly (measured wall-clock time)
- Draft preset completes faster than deliverable on the same track (measured)
- 2-stem output includes karaoke/instrumental files and vocal transcript
- Telemetry JSON written to `output/logs/stem-telemetry.json` with required fields
- Unit tests for cache key computation, preset time estimates

**Files:**
- Backend: `services/source_separation.py`, `app/api/audio_stems.py`
- Frontend: `StemMixerPanel.tsx` (preset selector, time estimate display)
- Tests: `tests/test_source_separation.py` (cache, presets)

---

### M3 — Stem mixer honesty

UX improvements to the stem mixer to set user expectations:

1. **Bleed warning copy** — Add a prominent note: "Stems are AI reconstructions — use for balance, not surgical editing. Vocal bleed is normal."
2. **Per-stem phase/mono check button** — A button that checks each stem for phase issues (phase correlation < 0.5) and mono compatibility (when summed to mono). Display results inline.
3. **Relative stem gain persistence** — Confirm that relative stem gains survive Demucs' auto-rescale (document whether Demucs uses clamp or rescale, and if gains are absolute or relative).

**Frontend changes:**
- `StemMixerPanel.tsx`: add warning banner, phase/mono check button with results display
- Backend: `POST /api/audio/stems/check/{stems_dir}` — runs phase correlation and mono fold checks, returns per-stem report

**Acceptance:**
- Warning banner visible on stem mixer page load
- Phase/mono check completes in < 5s on a 4-stem set
- Results show per-stem phase correlation and mono fold delta
- Stem gain settings persist across separation re-runs (if not already true)

**Files:**
- Backend: `app/api/audio_stems.py` (new check endpoint), `services/stem_analysis.py` (phase/mono logic)
- Frontend: `StemMixerPanel.tsx` (warning, check button, results display)
- Tests: `tests/test_stem_analysis.py` (phase/mono math)

---

## Suggested order

M1 (mastering module) → M2 (separation hardening) → M3 (stem mixer honesty)

Rationale:
- M1 provides immediate user-facing value (delivery standards)
- M2 builds on M1's telemetry pattern and improves the separation workflow
- M3 is pure UX and can be implemented in parallel with M2

---

## Non-goals

- Dynamic de-harsh / M/S side cleanup (v2 of tone fixes, out of scope)
- Stem re-synthesis or surgical editing (stems are for balance/mixing, not reconstruction)
- Cloud mastering services (keep local-first)
- Changing decided architecture (D1–D44, Q1–Q6 are settled)

---

## Verification gates

| Gate | Command |
| --- | --- |
| Backend type check | `ruff check packages/backend/app/services/mastering.py packages/backend/app/api/audio_mastering.py` |
| Backend tests | `pytest tests/test_mastering.py tests/test_source_separation.py` |
| Integration test | `POST /api/audio/master` on a real library track, verify output file + QC report |
| Frontend build | `pnpm build` in `packages/frontend` |
| Playwright smoke | `pnpm exec playwright test mastering.spec.ts` (new spec) |
| Knowledge docs | `python tools/validate-knowledge-tags.py` |

---

## Out of scope

- Unity-visualizer (protected per AGENTS.md)
- ComfyUI workflow changes
- Decision-log reversals
- Q1–Q6 (all resolved)
