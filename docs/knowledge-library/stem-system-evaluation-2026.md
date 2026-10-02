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

> [!warning] Status: re-verified against source 2026-10-02
> This audit is dated 2026-09-30 and several findings were fixed in the interval.
> Every finding below was checked against the current code before this update.
> Findings that no longer hold are marked **[RESOLVED]** with what actually fixed
> them; the rest are open and have been re-confirmed against source.
>
> **Net:** of 16 findings, 5 are resolved, 2 were wrong about the current code,
> and 9 remain open. The two critical findings (2.1, 2.2) are both fixed — the
> code was ahead of this document.

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

*As originally written 2026-09-30, with re-verification status added 2026-10-02:*

| Severity | Count | Description | Resolved | Open / Invalid |
|----------|-------|-------------|----------|----------------|
| 🔴 Critical | 2 | Data-integrity bug + render-loop thrash | **2** | 0 |
| 🟠 High | 5 | DRY violations, missing guards, test gaps | **4** | 1 (3.2 frontend residue) |
| 🟡 Medium | 5 | UX, performance, API completeness | 0 | 5 (one of which, 4.4, is invalid) |
| 🟢 Low | 4 | Polish, deduplication, tooling hygiene | 2 | 2 |
| **Total** | **16** | | **8** | **8** |

Both critical findings are resolved. Of the remaining high/medium/low items, **4.4 is
recorded as invalid** (its premise does not match the code) and **5.2's recommendation
is withdrawn**, so the true open count is 7.

---

## 2. Critical Findings

### 2.1 `getStemEnergy` samples all stems with drums' duration **[RESOLVED]**

**Originally:** `packages/frontend/src/features/visualizer/viz-styles/helpers.ts` (L76–L91)

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

**Status:** fixed before this re-verification. `getStemEnergy` now samples each
stem independently via a `sampleOne(curve, duration)` helper taking that stem's own
`duration`, and clamps the index to `curve.length - 1`. Confirmed by reading the
current `helpers.ts`.

---

### 2.2 `onLevels` inline-callback thrash restarts the metering RAF every render **[RESOLVED]**

**Originally:** `packages/frontend/src/features/visualizer/components/StemMixer.tsx` (L263–L281)

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

**Status:** fixed, and by the exact mechanism recommended. `StemMixer.tsx` now keeps
`const onLevelsRef = useRef(onLevels); onLevelsRef.current = onLevels;` so the RAF
loop reads the latest callback without the effect depending on its identity.

---

## 3. High-Priority Findings

### 3.1 Duplicated Windows fallback in `source_separation.py` **[RESOLVED]**

**Originally:** `packages/backend/app/services/source_separation.py` (L216–L222, L307–L313)

`_separate_demucs` and `_separate_spleeter` both contained a verbatim copy of the
`NotImplementedError` → `asyncio.to_thread(subprocess.run)` fallback. Any future
change to the thread-pool strategy must be applied twice.

**Status:** fixed. The helper `_run_subprocess_async` now exists and there are zero
remaining `to_thread(subprocess.run)` call sites in the file.

**Fix:** Extract `_run_subprocess_async(cmd, timeout_s)` and call it from both
separators.

---

### 3.2 `STEM_NAMES` defined in 3 places **[RESOLVED — 2026-10-02]**

| Location | Definition | Status |
|----------|-----------|--------|
| `source_separation.py:28` | `STEM_NAMES = ("vocals", "drums", "bass", "other")` | **canonical** |
| `StemMixer.tsx:20` | `export const STEM_NAMES: StemName[] = [...]` | frontend copy — still separate (see below) |
| `api/audio.py:1985` | hardcoded `for stem_name in ["vocals", ...]` | **gone** — route moved to `api/audio_stems.py`, which uses `source_separation.STEM_NAMES` |

Adding a new stem (e.g. `"harmony"`) required three independent edits. The backend
`get_stems`, `get_stem_analysis`, and `serve_stem_file` each had their own inline
lists too.

**Status:** the backend is now a single source. `audio_stems.py` reads
`source_separation.STEM_NAMES` throughout (including its 400 error message, which
is derived from the tuple), and on 2026-10-02 the two remaining inline literals were
replaced:

- `source_separation.py` L558 — `for stem_name in ["vocals", "drums", "bass", "other"]` → `for stem_name in STEM_NAMES`
- `stem_analysis.py` L51 — `stem_names = ["vocals", "drums", "bass", "other"]` → `stem_names = source_separation.STEM_NAMES`

Both are now covered by `test_stem_names_is_single_source_of_truth` in
`tests/test_stem_pipeline.py`.

**Still open:** the **frontend** `StemMixer.tsx` keeps its own `STEM_NAMES`. There
is no shared TypeScript module wired up, so a 5th stem would still need a manual
frontend edit. Low risk — the backend is what determines what actually exists — but
the doc's original "import from a shared `@shared/stem-types`" idea is not done.

---

### 3.3 No backend guard against re-separating existing stems **[RESOLVED]**

**Originally:** `packages/backend/app/api/audio.py` (L2091–L2126) `separate_library_file`

The endpoint unconditionally ran Demucs even if stems already exist on disk. For a
4-minute track on CPU this wastes ~10 minutes. The frontend mitigates this by
calling `getAudioStems` first, but any direct API consumer (scripts, future batch
tools) hits the full Demucs latency.

**Status:** fixed. The guard now runs before `source_separator.separate()`:

```python
existing = await get_stems(body.filename)
if existing.get("found") and len(existing.get("stems", {})) >= 4:
    return StemSeparationResponse(success=True, model="existing", ...)
```

Note the literal `>= 4` here — a residual hardcoded stem count, now the last place
that assumes four stems. It should be `len(source_separation.STEM_NAMES)`.

**Status of that residue:** fixed on 2026-10-02. The guard now computes
`required = len(source_separation.STEM_NAMES)`, so adding a stem no longer silently
disables the guard.

Now covered by `test_separate_file_skips_existing_stems`, which asserts
`model == "existing"`. Mutation-checked: disabling the guard makes that test attempt
a real Demucs run and hang, which is exactly the 2–10 minute cost the guard avoids.

**Fix:** Before calling `source_separator.separate()`, check whether all four stem
WAV files already exist. If so, return the existing paths immediately with
`success: true` and `skipped_existing: true`.

---

### 3.4 Circular-ish dependency: `stem_analysis` → `api/audio` → `stem_analysis` **[RESOLVED]**

**Originally:** `packages/backend/app/services/stem_analysis.py` (L85)

```python
from ..api.audio import _find_stem_dir as _api_find_stem_dir
```

The service layer reached back into the API module for a path-resolution helper.
This works at runtime but breaks the intended dependency direction (`api → service`,
not `service → api`). It also makes the service impossible to test without the full
FastAPI app stack.

**Status:** fixed, though by a different route than proposed — which is fine, since
the proposed `services/stem_paths.py` does not exist and the layering is now correct.
`find_stem_dir` is a **public** helper in `services/source_separation.py`, and
`stem_analysis.py` calls it through the `source_separation` module it already
imports. No `from ..api` import remains, so `api → service` holds and the service is
importable without the FastAPI stack. Directly covered by
`test_find_stem_dir_exact_match` / `test_find_stem_dir_tolerates_hash_prefix`.

**Fix:** Move `_find_stem_dir` to a shared module (`services/stem_paths.py` or
`core/stem_utils.py`) and import it from both `api/audio.py` and `stem_analysis.py`.

---

### 3.5 Minimal backend test coverage for stems **[RESOLVED — 2026-10-02]**

**Originally:** `packages/backend/tests/test_stem_analysis.py` (21 lines)

Only 2 tests existed:
- `test_stem_analysis_returns_empty_when_no_separation`
- `test_stem_analysis_requires_valid_path`

**Status:** addressed. New `packages/backend/tests/test_stem_pipeline.py` adds
**19 tests** covering the gaps this finding named, plus a few found while writing
them. Backend suite: **247 passed**.

| Original ask | Status |
|---|---|
| 1. `test_separate_library_file_skips_existing_stems` | done (as `..._skips_existing_stems`) |
| 2. `test_serve_stem_file_wav_and_mp3` | done — WAV serves real RIFF bytes, per-stem |
| 3. `test_serve_stem_file_rejects_invalid_stem_name` | done — via HTTP *and* direct handler call |
| 4. `test_find_stem_dir_exact_and_normalized` | done — exact + hash-prefix tolerance + None |
| 5. `test_get_stems_status_returns_library` | done — also asserts `has_stems` and stem set |
| 6. `test_stem_visualization_normalizes_curves` | **not done** — see below |

Additional coverage beyond the original list: path traversal rejection, unknown-model
rejection, 404 for missing audio, 404 for unseparated stem-file, bad `format`
rejection, `found:false` shape, `stems_mp3` URL presence, and the single-source
`STEM_NAMES` guard.

**Two things worth knowing about the tests:**

- They hit a real trap. A global exception handler rewrites `HTTPException` into
  `{"error": {"code", "message"}}`, **not** FastAPI's default `detail`. Asserting on
  `detail` fails even when the endpoint behaves correctly. `_detail()` in the test
  file handles both shapes.
- `..%2Fsecrets` cannot be tested through HTTP: the ASGI router normalises the path
  and returns 404 before the handler runs. So the invalid-stem-name guard is
  additionally asserted by calling the handler coroutine directly, which is the only
  way to reach it.

**Not covered:** `stem_visualization` curve normalisation, actual Demucs separation,
and MP3 lazy encoding. These are left deliberately — they need real audio fixtures,
and a lazy-MP3 test in particular would encode WAV on a test machine.

**Fix:** Add at least 6 tests:
1. `test_separate_library_file_skips_existing_stems` (once 3.3 is fixed)
2. `test_serve_stem_file_wav_and_mp3`
3. `test_serve_stem_file_rejects_invalid_stem_name`
4. `test_find_stem_dir_exact_and_normalized`
5. `test_get_stems_status_returns_library`
6. `test_stem_visualization_normalizes_curves`

---

## 4. Medium-Priority Findings

### 4.1 `get_stems_status` rescans the entire library synchronously — **OPEN**

**File:** `packages/backend/app/api/audio_stems.py` `get_stems_status`

`get_stems_status` walks every audio file and calls `find_stem_dir` per track.
On a library of 500+ files this blocks the event loop for seconds. Re-verified
2026-10-02: still no TTL cache and no `asyncio.to_thread` around the walk.

**Fix:** Cache the status dict with a short TTL (e.g. 30 s) and invalidate on
`POST /api/audio/separate-file` completion. Use `asyncio.to_thread` for the
filesystem walk as a stopgap.

---

### 4.2 No cancellation mechanism for long-running separation — **OPEN**

**File:** `packages/backend/app/api/audio_stems.py` `separate_library_file`

`separate_library_file` holds the HTTP connection open for up to 10 minutes with no
way to cancel mid-flight from the frontend. If the user navigates away, the process
continues. Re-verified 2026-10-02: there is no `@router.delete` in the module, so the
proposed `DELETE /api/audio/separate/{job_id}` does not exist. There is a
`GET /separate-jobs/{job_id}` for polling, but nothing to cancel with.

**Fix:** Accept an optional `job_id` in the request, register it in the existing
`queue_manager`, and support `DELETE /api/audio/separate/{job_id}` to kill the
Demucs subprocess. The frontend can then wire the Retry button to a cancel action.

---

### 4.3 `ensureStems` silently auto-separates on track selection — **OPEN**

**File:** `packages/frontend/src/features/visualizer/components/StemMixer.tsx` (L148+)

`ensureStems` still calls `separateAudioFile(audioFilename, "mdx_extra_q", ...)`
directly when `getAudioStems` reports no stems. No confirmation gate. The comment
still reads "if missing, separate them automatically (Demucs)", and `ensureStems`
remains wired directly to Retry/Separate buttons (L525, L565). The
separate-file *backend* guard from 3.3 does not help here: there are genuinely no
stems yet, so the first run is still an unattended multi-minute job.

**Fix:** Add a confirmation step: after `checking` returns `found: false`, show a
card explaining the time cost and offering "Separate" and "Skip" buttons. Default
to Skip.

---

### 4.4 `StemsAnalysisResponse` lacks `stems_mp3` URLs — **WRONG ABOUT THE CODE**

**Originally claimed:** `packages/frontend/src/services/api/audio.ts` (L289–L319)

> `getStemsAnalysis` returns `StemsAnalysisResponse` whose `stems` entries only carry
> the WAV `url`. The backend `get_stems` endpoint returns both `stems` (WAV) and
> `stems_mp3` (MP3). For analysis-path playback the frontend always hits the larger
> WAV files even though MP3s exist.

**Status:** the stated conclusion does not hold. Verified 2026-10-02:

- **Playback never uses this endpoint.** `Visualizer.tsx` calls `getStemsAnalysis`
  only to populate `energy_curve` data for the shader, and constructs **no** `Audio`
  element and sets no `.src` from it. Nothing is played from these URLs.
- **Playback already prefers MP3.** `StemMixer` fetches via `getAudioStems()`, and
  `pickStemUrls()` returns `data.stems_mp3` when present, falling back to
  `data.stems`. The comment in the code says so explicitly: *"fall back to WAV when
  the backend predates stems_mp3."*

So the WAV-only concern applies to analysis payload that is never decoded as audio.
Adding `mp3_url` here would be harmless but would not change any bytes fetched.

The type asymmetry is real but cosmetic: `AudioStemsResponse` has `stems_mp3?`
(L37/L76) and `StemsAnalysisResponse` does not, which is *correct* given they serve
different purposes. No change made.

---

### 4.5 `sampleStemEnergy` duplicated between `ShaderVisualizer.tsx` and `helpers.ts` — **OPEN, but no longer divergent**

**Files:** `packages/frontend/src/features/visualizer/ShaderVisualizer.tsx` (L77–L88)
vs `viz-styles/helpers.ts` (L76–L96)

Originally `helpers.ts` held the buggy drums-duration version while `ShaderVisualizer.tsx`
held the correct one. **Both are now correct and semantically equivalent**: each samples
one stem from its own `duration` and `energy_curve`, clamps the index to
`curve.length - 1`, and clamps the output to `[0, 1]`. The latent-drift risk the
finding warned about has not materialised.

**But the duplication is wider than this document recorded.** `getStemEnergy` is
imported by **12** viz styles, each destructuring a fixed
`{ vocals, drums, bass, other }` shape:

`aurora` · `cosmic` · `fractal` · `geometric` · `inferno` · `instancedParticles` ·
`neural` · `ocean` · `pppanik` · `pulse` · `storm` · `synthwave` · `three-particles`

So this is one shared helper with many consumers — which is fine — plus a *second*
copy in `ShaderVisualizer.tsx` used only for the uniform shader path. The return type
is a fixed four-stem object, which is also why a 5th stem (see open question 2) would
be a wide edit rather than a one-line change.

**Fix (still worth doing):** extract `sampleStemEnergy` into a shared `audioSampling.ts`
and have both `ShaderVisualizer.tsx` and `helpers.ts` re-export or delegate to it, so
the next change is made once.

---

## 5. Low-Priority Findings

### 5.1 Partial stem failure UX — **OPEN**

When 1–2 of 4 stems fail to load, the mixer shows "unavailable" and the track is
unmixable. The remaining stems are discarded. Confirmed still present 2026-10-02
(`StemMixer.tsx` "unavailable" path).

**Recommendation:** Allow partial playback. Render only successfully loaded stems,
show a warning icon next to missing stems, and disable their sliders.

---

### 5.2 Transport sync interval vs drift threshold mismatch — **RESOLVED, rationale changed**

`syncTransport` runs every 500 ms but only seeks when drift exceeds 200 ms.
For fast BPM tracks (160–180 BPM), 200 ms is ~2 beats — noticeable.

**Update 2026-10-02:** the recommendation to tighten to 250 ms is **withdrawn**.
`StemMixer.tsx` now carries comments recording that both numbers were arrived at by
measurement: 200 ms as the seek threshold, and 500 ms as the poll interval —
*"checking every frame caused audible skipping."* The two are related: seek more often
and you hear it. This is a trade-off that was deliberately resolved, not an oversight.
Re-open only with evidence of audible drift on fast-BPM tracks.

---

### 5.3 No stem-specific Playwright test helpers — **RESOLVED**

`helpers.ts` in the test suite has mocks for health, GPU, and settings, but no
`mockApiStems` helper. Browser tests for the stem mixer must manually mock fetch.

**Status:** fixed. `mockApiStems` now exists in the Playwright helpers and is
referenced by the browser specs. This covers the *frontend* Playwright suite; the
backend gaps are handled by finding 3.5.

**Recommendation:** Add `mockApiStems` / `mockApiStemAnalysis` helpers.

---

### 5.4 Hardcoded paths in `tools/scripts/stems_to_mp3.py` — **OPEN**

The script has a hardcoded `STEM_DIR` pointing to a single project path, making it
unreusable. Confirmed still present 2026-10-02: `STEM_DIR` is a module-level constant
(L6) with no `argparse` and no `--dir` flag.

**Recommendation:** Accept `--dir` / `--track` CLI args, or fold the script into
`batch_process.py` as a `stems-to-mp3` subcommand.

---

## 6. Remaining Work (revised 2026-10-02)

The original sequence assumed all 16 findings were open. With 2.1, 2.2, 3.1, 3.3,
3.4, 3.5 and 5.3 resolved, this is what is actually left, ordered by
value-per-effort:

| # | Item | Effort | Why it matters |
|---|------|--------|----------------|
| 1 | **4.1** — `get_stems_status` synchronous full-library walk | ~30 min | Event-loop blocking on a 500-file library; cheapest real perf win |
| 2 | **4.3** — `ensureStems` auto-separates without confirmation | ~45 min | An unattended 2–10 min job started on a track click |
| 3 | **3.2 residue** — frontend `STEM_NAMES` still its own array | ~15 min | A 5th stem still needs a manual frontend edit |
| 4 | **4.2** — no cancel for long separation | ~2 h | Highest effort; needs `process.kill()` plumbing, not just an await cancel |
| 5 | **4.5** — unify the two stem-sampling implementations | ~30 min | Currently equivalent, so this is insurance against future drift, not a live bug |
| 6 | **5.1** — partial stem failure UX | ~1 h | UX only |
| 7 | **5.4** — `stems_to_mp3.py` hardcoded path | ~15 min | Tooling hygiene |

**Recommended next: 4.1 then 4.3.** Both are user-visible and neither needs new
architecture. 4.2 is the most valuable in principle but is the only one that should be
scheduled rather than squeezed in.

Deliberately *not* recommended: re-opening 5.2 (see the withdrawn recommendation), or
"fixing" 4.4 (see why the original claim does not hold).

---

## 6b. Original fix sequence (superseded, kept for provenance)

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
