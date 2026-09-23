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
