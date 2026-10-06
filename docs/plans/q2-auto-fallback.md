# Q2 — Automatic AI → deterministic fallback in the music video pipeline

- **Status:** Approved
- **Decides:** Q2 (`docs/architecture/decision-log.md`)
- **Owner:** repo owner
- **Approved:** 2026-09-22 — agents may implement.

## Goal

A music-video job whose AI visual source fails must degrade to a deterministic,
beat-synced render — not die. This is the studio's core design goal
("deterministic fallback for flaky AI assets"); today the fallback paths exist
but are only reachable manually.

## Current behavior (grounded)

- `POST /music-video/generate`
  (`packages/backend/app/api/integrations_music_video.py:130`) raises **503**
  when `adapter_registry.get("comfyui")` is missing (line 141) or VRAM is
  insufficient (line 173). The job is never queued.
- `MusicVideoHandler._process_job_inner`
  (`packages/backend/app/services/music_video_handler.py:77`) routes on
  `params["method"]`: `"visualization"` (default FFmpeg-filter path),
  `"comfyui"` → `_render_with_comfyui` (line 528),
  `"comfyui_wan_gguf"` → `_render_with_comfyui_wan_gguf` (line 614, auto-picked
  via `is_wan_8gb_model`). An exception in `_render_with_ffmpeg` becomes
  `RuntimeError` → the job fails (retries, then DLQ).
- Jobs already carry `params["section"]`, which drives
  `_enhance_prompt_for_section` (line 35) and palette selection (~line 357).
- Deterministic sources exist: the FFmpeg `visualization` filter path
  (beat-synced from the analysis envelope), shader presets
  (`packages/frontend/src/features/visualizer/shaderPresets.ts`), visual presets
  with `selectVisualPreset(trackName?, genre?, energy?, bpm?)`
  (`packages/frontend/src/features/visualizer/visualPresets.ts:535`), the
  Canvas2D visualizer, and the Three.js Studio (`/three-js-studio`, 6 templates).
- The D1 renderer chain (`services/video/`: coreflux → movielite → FFmpeg) is
  compositing-level fallback, **not** visual-source fallback — out of scope.

## Proposed design

1. **Fallback policy on the job.** Add `params["visual_fallback"]`:
   `{"enabled": true, "on_source_failure": "auto" | "fail"}`. Default `"auto"`.
   `"fail"` preserves today's hard-fail behavior for callers that explicitly
   want AI-or-nothing.
2. **Backend preset selector** (new module,
   `packages/backend/app/services/visual_fallback.py`):
   `select_fallback_preset(genre, energy, bpm, section) -> str` — a Python
   mirror of the frontend `selectVisualPreset` genre/energy matching
   (`visualPresets.ts:535`). Deterministic: same inputs → same preset.
   Run it in the **studio env** (`nma-studio-cuda`); it must not import anything
   from the ComfyUI env (D2).
3. **Worker wiring** (`music_video_handler.py`): wrap the AI render dispatch
   (`_render_with_comfyui`, `_render_with_comfyui_wan_gguf`) so that on
   exception — or when the adapter is unavailable — the worker resolves the
   fallback preset and renders via the existing `visualization` FFmpeg path
   with the preset's params. Emit a progress message
   (`_update_progress`: "ComfyUI unavailable — using <preset> fallback") so it
   shows on SSE. Record `degraded`, `visual_source_used`, `fallback_reason`
   in the job result.
4. **API wiring** (`integrations_music_video.py`): when the ComfyUI adapter is
   missing or VRAM is short **but** a deterministic fallback can satisfy the
   request, queue the job with the degraded method instead of raising 503, and
   return `"degraded": true, "degraded_reason": ...` in the response. Keep the
   503 only when the caller passed `on_source_failure: "fail"` or no
   deterministic path exists (FFmpeg itself missing).
5. **Result contract.** Job result JSON gains:
   `degraded: bool`, `visual_source_used: str`,
   `fallback_reason: str | null`. The frontend can badge degraded outputs later;
   no frontend changes required in this work item.

## Acceptance criteria

1. With the ComfyUI adapter unregistered (or ComfyUI stopped),
   `POST /music-video/generate` returns a queued job (not 503) and the job
   **completes** with a valid beat-synced mp4 via the fallback path.
2. The completed job's result contains `degraded: true`,
   `visual_source_used: "<preset>"`, and a non-empty `fallback_reason`.
3. SSE progress includes the fallback message from step 3.
4. With ComfyUI healthy, behavior is unchanged: `degraded: false`, no fallback
   triggered, same output as before this change.
5. `select_fallback_preset` is deterministic: identical
   (genre, energy, bpm, section) inputs always return the same preset.
6. The fallback path loads **no AI models** and needs no VRAM beyond FFmpeg
   (D7: 8 GB VRAM stays a hard constraint; the fallback must work on a cold GPU).

## Non-goals

- Do not change the D1 renderer chain (coreflux → movielite → FFmpeg).
- Do not touch `unity-visualizer/` (protected standalone project).
- Do not re-tune or replace the frontend shader/visualizer engines — reuse them.
- Do not change queue retry/DLQ semantics (D8); fallback happens *inside* the
  job, before retries are consumed by a doomed AI attempt.
- No new Python environment (D2); no new ports (D6).

## Suggested build order

1. `visual_fallback.py` + unit test for determinism (criterion 5).
2. Thread `visual_fallback` policy through `MusicVideoRequest` → job params.
3. Worker try/except → fallback render + result contract + progress message.
4. API 503 → degraded queue + response fields.
5. Smoke test per Verification below, both paths.

## Verification

- **Fallback path:** stop ComfyUI (or unregister the adapter), submit a
  `music-video/generate` request, assert: HTTP 200 with `degraded: true`,
  job completes, output mp4 exists and duration matches request, result has
  the three contract fields.
- **Healthy path:** with ComfyUI running, same request → `degraded: false`,
  AI render used.
- Backend tests: `pytest` in `packages/backend/`; lint `ruff check`.

## Build notes

_(append when implemented: what was built, what diverged from this plan and why)_

### 2026-10-06 review fixes (uncommitted work)

- `visual_fallback._token_in` had its operands swapped (`haystack in token`),
  so no genre ever matched and every fallback returned `balanced`. Measured:
  `select_fallback_preset(genre="trap metal song")` → `balanced` before,
  `trapMetal` after. Also added the missing `track_name` param so the backend
  haystack (`genre + track_name`) mirrors the frontend
  `selectVisualPreset(trackName, genre, …)`.
- `MusicVideoRequest` gained `genre`, `track_name`, `on_source_failure`
  (`auto`|`fail`); VRAM shortfall now degrades like a missing adapter instead
  of 503, and `fail` preserves the old hard-fail. The worker reads the new
  params and falls back to the envelope mean when `energy_mean` is absent.
- `mcp_validate` route was `/mcp/validate-tool` while all four bridges call
  `/api/mcp/validate-tool` — every validation silently 404'd and passed
  through. Moved to `/api/mcp/validate-tool`.
- Bridges updated `request.params` but dispatched the stale `args` (dead
  validation); hyperframes/vision/unity now dispatch `effectiveArgs`, ollama
  all ten handlers. Note the ollama handler destructures `const args`, so a
  new binding is required — reassigning throws `TypeError`.
- Push subscribe/unsubscribe returned 200 with an `error` body on missing
  endpoint; now 422 via `HTTPException`. Frontend `Enable` previously only
  read an existing subscription (always "No subscription"); it now guards
  serviceWorker/PushManager/VAPID, creates via `pushManager.subscribe`, and
  unsubscribe notifies the server best-effort before dropping local state.
- Regression tests: `packages/backend/tests/test_visual_fallback_push.py`
  (10 tests). Audio route baseline refreshed for the three committed remix
  routes (`by-track`, `tempo/status`, `tempo/refresh`) that 28d2f25/e21af68
  added without updating it.

### 2026-10-06 follow-up review (same tree, pre-commit)

- `select_fallback_preset` took a `section` param it never read — and the
  frontend function it mirrors has no `section` either, while
  `MusicVideoRequest` never sets one, so it was always `None`. Removed from
  the signature, the docstring, and the handler call site rather than
  inventing section-based tuning to justify it.
- `music_video_handler._render_with_ffmpeg` carried a function-local
  `import logging` and rebuilt the 13-entry preset→style map on every
  degraded render; both hoisted to module scope (`_FALLBACK_STYLE_MAP`).
  No behaviour change — verified by the full backend suite (594 passed,
  1 skipped) plus the now 11-test regression file.
- Out of scope but fixed in the same tree because the `type` gate was red:
  `Settings.tsx` push code (see commit message).
