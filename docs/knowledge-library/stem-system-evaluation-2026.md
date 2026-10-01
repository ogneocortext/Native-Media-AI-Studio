---
tags:
  - production
  - audio
  - visualization
  - technical
aliases:
  - Stem System Evaluation 2026
  - Stem System Audit
cssclasses:
  - production-guide
  - technical-audit
date: 2026-09-30
---

# 🎛️ Stem System Evaluation — Fall 2026

> [!info] Scope
> Full audit of the per-stem audio pipeline: separation backend (`Demucs`/`Spleeter`),
> REST API, frontend `StemMixer`, visualization integration, and tooling.
> Findings below are ordered by severity; fixes are tracked in the companion
> implementation plan.

> [!tip] Companion docs
> - [[a1-a6-media-pipeline-tooling-2026#A5 — Stem-reactive visualizer mode|A5 — Stem-reactive visualizer mode]]
> - [[audio-reactive-production]]
> - [[hyperframes-audio-reactive-2026]]
> - Architecture Decision Log: **D4** (stem stack), **D3** (audio backends)

---

## 1. Evaluation Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 2 | Data-integrity bug + render-loop thrash |
| 🟠 High | 5 | DRY violations, missing guards, test gaps |
| 🟡 Medium | 5 | UX, performance, API completeness |
| 🟢 Low | 4 | Polish, deduplication, tooling hygiene |

---

## 2. Critical Findings

### 2.1 `getStemEnergy` samples all stems with drums' duration

**File:** `packages/frontend/src/features/visualizer/viz-styles/helpers.ts` (L76–L91)

```ts
const dur = stems.drums?.duration || 1;   // ← bug
const curve = stems.drums?.energy_curve;   // ← bug
const idx = Math.floor((elapsed / dur) * curve.length);
return {
  vocals: stems.vocals?.energy_curve[idx] ?? 0,   // sampled at drums index
  drums: stems.drums?.energy_curve[idx] ?? 0,
  bass:  stems.bass?.energy_curve[idx] ?? 0,      // sampled at drums index
  other: stems.other?.energy_curve[idx] ?? 0,     // sampled at drums index
};
```

**Impact:** If any stem has a different duration than `drums` (edge case but possible
with variable-length stems or post-processing), `vocals`/`bass`/`other` sample at
the wrong time offset. The shader sees misaligned energy — e.g. a vocal hit maps to
the bass energy curve at the drums-indexed timestamp.

**Root cause:** Copy-paste from a drums-only helper; the per-stem duration was never
factored out.

**Fix:** Sample each stem independently using its own `duration` and `energy_curve`.

---

### 2.2 `onLevels` inline-callback thrash restarts the metering RAF every render

**File:** `packages/frontend/src/features/visualizer/components/StemMixer.tsx` (L263–L281)

```ts
useEffect(() => {
  if (!onLevels) return;
  const tick = () => { onLevels(levels); rafRef.current = requestAnimationFrame(tick); };
  rafRef.current = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafRef.current);
}, [onLevels]);   // ← restarts when onLevels identity changes
```

`StemMixerPanel` does not pass `onLevels`, but any consumer that does (e.g. a
future full-mode panel) will likely pass an inline arrow function:
`onLevels={(lvl) => setStemLevels(lvl)}`. That function is a new reference every
parent render, so the effect tears down and restarts the RAF loop on every frame.

**Impact:** Dropped metering frames, visual jitter, unnecessary GC pressure from
cancelled/recreated `requestAnimationFrame` chains.

**Fix:** Stabilize `onLevels` with `useRef` inside `useStemMixer` so the RAF loop
always reads the latest callback without restarting.

---

## 3. High-Priority Findings

### 3.1 Duplicated Windows fallback in `source_separation.py`

**File:** `packages/backend/app/services/source_separation.py` (L216–L222, L307–L313)

`_separate_demucs` and `_separate_spleeter` both contain a verbatim copy of the
`NotImplementedError` → `asyncio.to_thread(subprocess.run)` fallback. Any future
change to the thread-pool strategy must be applied twice.

**Fix:** Extract `_run_subprocess_async(cmd, timeout_s)` and call it from both
separators.

---

### 3.2 `STEM_NAMES` defined in 3 places

| Location | Definition |
|----------|-----------|
| `StemMixer.tsx:20` | `export const STEM_NAMES: StemName[] = [...]` |
| `source_separation.py:27` | `STEM_NAMES = ("vocals", "drums", "bass", "other")` |
| `api/audio.py:1985` | hardcoded `for stem_name in ["vocals", ...]` |

Adding a new stem (e.g. `"harmony"`) requires three independent edits. The backend
`get_stems`, `get_stem_analysis`, and `serve_stem_file` each have their own inline
lists too.

**Fix:** Define `STEM_NAMES` once in `source_separation.py` and import it everywhere
else. The frontend can import from a shared `@shared/stem-types` or a simple
re-export.

---

### 3.3 No backend guard against re-separating existing stems

**File:** `packages/backend/app/api/audio.py` (L2091–L2126) `separate_library_file`

The endpoint unconditionally runs Demucs even if stems already exist on disk. For a
4-minute track on CPU this wastes ~10 minutes. The frontend mitigates this by
calling `getAudioStems` first, but any direct API consumer (scripts, future batch
tools) hits the full Demucs latency.

**Fix:** Before calling `source_separator.separate()`, check whether all four stem
WAV files already exist. If so, return the existing paths immediately with
`success: true` and `skipped_existing: true`.

---

### 3.4 Circular-ish dependency: `stem_analysis` → `api/audio` → `stem_analysis`

**File:** `packages/backend/app/services/stem_analysis.py` (L85)

```python
from ..api.audio import _find_stem_dir as _api_find_stem_dir
```

The service layer reaches back into the API module for a path-resolution helper.
This works at runtime but breaks the intended dependency direction (`api → service`,
not `service → api`). It also makes the service impossible to test without the full
FastAPI app stack.

**Fix:** Move `_find_stem_dir` to a shared module (`services/stem_paths.py` or
`core/stem_utils.py`) and import it from both `api/audio.py` and `stem_analysis.py`.

---

### 3.5 Minimal backend test coverage for stems

**File:** `packages/backend/tests/test_stem_analysis.py` (21 lines)

Only 2 tests exist:
- `test_stem_analysis_returns_empty_when_no_separation`
- `test_stem_analysis_requires_valid_path`

No tests cover: actual stem separation, `serve_stem_file`, MP3 lazy encoding,
`get_stems_status`, `_find_stem_dir` resolution logic, or `stem_visualization`.

**Fix:** Add at least 6 tests:
1. `test_separate_library_file_skips_existing_stems` (once 3.3 is fixed)
2. `test_serve_stem_file_wav_and_mp3`
3. `test_serve_stem_file_rejects_invalid_stem_name`
4. `test_find_stem_dir_exact_and_normalized`
5. `test_get_stems_status_returns_library`
6. `test_stem_visualization_normalizes_curves`

---

## 4. Medium-Priority Findings

### 4.1 `get_stems_status` rescans the entire library synchronously

**File:** `packages/backend/app/api/audio.py` (L2031–L2047)

`get_stems_status` walks every audio file and calls `_find_stem_dir` per track.
On a library of 500+ files this blocks the event loop for seconds.

**Fix:** Cache the status dict with a short TTL (e.g. 30 s) and invalidate on
`POST /api/audio/separate-file` completion. Use `asyncio.to_thread` for the
filesystem walk as a stopgap.

---

### 4.2 No cancellation mechanism for long-running separation

**File:** `packages/backend/app/api/audio.py` (L2091–L2126)

`separate_library_file` holds the HTTP connection open for up to 10 minutes with no
way to cancel mid-flight from the frontend. If the user navigates away, the process
continues.

**Fix:** Accept an optional `job_id` in the request, register it in the existing
`queue_manager`, and support `DELETE /api/audio/separate/{job_id}` to kill the
Demucs subprocess. The frontend can then wire the Retry button to a cancel action.

---

### 4.3 `ensureStems` silently auto-separates on track selection

**File:** `packages/frontend/src/features/visualizer/components/StemMixer.tsx` (L132–L170)

When a user selects a track with no stems, `ensureStems` automatically launches a
2–10 minute Demucs job. The UI shows "separating…" but the user may not realize
a heavy background process just started.

**Fix:** Add a confirmation step: after `checking` returns `found: false`, show a
card explaining the time cost and offering "Separate" and "Skip" buttons. Default
to Skip.

---

### 4.4 `StemsAnalysisResponse` lacks `stems_mp3` URLs

**File:** `packages/frontend/src/services/api/audio.ts` (L289–L319)

`getStemsAnalysis` returns `StemsAnalysisResponse` whose `stems` entries only carry
the WAV `url`. The backend `get_stems` endpoint returns both `stems` (WAV) and
`stems_mp3` (MP3). For analysis-path playback the frontend always hits the larger
WAV files even though MP3s exist.

**Fix:** Add an optional `mp3_url` field to the per-stem response type and populate
it in the backend.

---

### 4.5 `sampleStemEnergy` duplicated between `ShaderVisualizer.tsx` and `helpers.ts`

**File:** `packages/frontend/src/features/visualizer/ShaderVisualizer.tsx` (L73–L84)
vs `viz-styles/helpers.ts` (L76–L91)

The correct per-stem sampling logic exists in `ShaderVisualizer.tsx` while the
buggy drums-duration version lives in `helpers.ts`. Two implementations of the same
concept will drift.

**Fix:** Replace `getStemEnergy` in `helpers.ts` with a call to the canonical
`sampleStemEnergy` from `ShaderVisualizer.tsx` (or extract both to a shared
`audioSampling.ts` module).

---

## 5. Low-Priority Findings

### 5.1 Partial stem failure UX

When 1–2 of 4 stems fail to load, the mixer shows "unavailable" and the track is
unmixable. The remaining stems are discarded.

**Recommendation:** Allow partial playback. Render only successfully loaded stems,
show a warning icon next to missing stems, and disable their sliders.

---

### 5.2 Transport sync interval vs drift threshold mismatch

`syncTransport` runs every 500 ms but only seeks when drift exceeds 200 ms.
For fast BPM tracks (160–180 BPM), 200 ms is ~2 beats — noticeable.

**Recommendation:** Reduce the sync interval to 250 ms and keep the 200 ms seek
threshold. Seeking cost is low on preloaded MP3 stems.

---

### 5.3 No stem-specific Playwright test helpers

`helpers.ts` in the test suite has mocks for health, GPU, and settings, but no
`mockApiStems` helper. Browser tests for the stem mixer must manually mock fetch.

**Recommendation:** Add `mockApiStems` / `mockApiStemAnalysis` helpers.

---

### 5.4 Hardcoded paths in `tools/scripts/stems_to_mp3.py`

The script has a hardcoded `STEM_DIR` pointing to a single project path, making it
unreusable.

**Recommendation:** Accept `--dir` / `--track` CLI args, or fold the script into
`batch_process.py` as a `stems-to-mp3` subcommand.

---

## 6. Recommended Fix Sequence

| Phase | Items | Effort | Risk |
|-------|-------|--------|------|
| **P1 — Data correctness** | 2.1, 2.2, 3.1, 3.2 | ~1 hour | Low |
| **P2 — API hardening** | 3.3, 3.4, 3.5, 4.1, 4.2 | ~2 hours | Medium |
| **P3 — UX polish** | 4.3, 4.4, 4.5, 5.1, 5.2 | ~1.5 hours | Low |
| **P4 — Test & tooling** | 3.5 (continued), 5.3, 5.4 | ~1 hour | Low |

**Total estimated effort:** ~5.5 engineer-hours.

---

## 7. Rationale Against Common Alternatives

| Alternative considered | Why rejected |
|------------------------|-------------|
| Keep per-file `STEM_NAMES` lists | Divergence risk; a single source is cheaper to maintain |
| Live Demucs re-run on missing stems | Wastes CPU/GPU; the existing `getAudioStems` first-check is correct |
| SSE-based separation progress | Overkill for a single-shot 2–10 min job; polling is simpler and already works |
| Cancel via `asyncio.CancelledError` | Demucs spawns a child process; `cancel()` only cancels the await, not the running process. Need explicit `process.kill()`. |
| Web Worker for metering | `AnalyserNode.getByteTimeDomainData` is already fast; the bottleneck is the RAF callback, not the main thread |

---

## 8. Suno-Specific Findings (2026-09-30)

Suno-generated tracks have known separation enemies that the system now
accounts for explicitly:

| Artifact | Cause | Mitigation |
|----------|-------|------------|
| Baked-in compression | Suno's loudness mastering | Use `mdx_extra_q` (MDX-Net) which handles compressed sources better than `htdemucs` |
| AI-hallucinated stereo widening | Synthetic stereo generation | Model-specific training data exposure; `mdx_extra_q` reduces phase smearing |
| Pseudo-reverb / ghost reflections | Synthetic reverb baked into stems | Expected in instrumental; StemMixer treats as signal, not bug |
| Vocal formant harshness | Aggressive MP3 high-end encoding | Downstream EQ can compensate; stem energy curves preserve transient detail |

**Implementation notes:**
- Default model is now `mdx_extra_q` (MDX-Net high-quality variant).
- `--shifts 0` for fast iteration, `--shifts 1` for final renders.
- `--segment_size` cap available for 8 GB GPUs on long tracks.
- Windows validation: `torchaudio.list_audio_backends()` checked; `soundfile`
  must be installed (`pip install soundfile`) or decoding fails silently.

---

## 9. Open Questions

1. **Should stem analysis be cached server-side with a TTL?** The current
   `_analysis_cache` in `audio.py` is in-memory only (max 200 entries) and lost on
   restart. A disk-backed cache (e.g. `output/cache/stems-analysis/{hash}.json`)
   would survive restarts and serve repeat plays instantly.

2. **Should `StemMixer` support more than 4 stems?** Demucs 4.1.0 outputs exactly
   4 stems, but future models (`htdemucs_6s`, custom models) may produce more.
   The hardcoded `STEM_NAMES` array and the backend `_find_stem_dir` loop both
   assume 4.

3. **Should per-stem EQ state persist across track switches?** Currently lost on
   track change. A `localStorage` keyed by `filename + stem_name` would preserve
   user preferences with minimal code.

---

## 10. See Also

- [[a1-a6-media-pipeline-tooling-2026#A5 — Stem-reactive visualizer mode]]
- [[audio-reactive-production]]
- [[hyperframes-audio-reactive-2026]]
- Architecture Decision Log: **D3**, **D4**
- `docs/architecture/decision-log.md`

---

_Last updated: 2026-09-30_
