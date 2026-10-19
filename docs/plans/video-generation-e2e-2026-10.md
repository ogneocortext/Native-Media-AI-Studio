# Video Generation & E2E Testing Plan — Oct 2026

**Status:** Proposed 2026-10-19 — awaiting owner review
**Decides:** none (addresses research gaps §1, §6 from `app-research-gaps-2026.md`)
**Owner:** repo owner (implementation: local coding agent)
**Source research:** [[app-research-gaps-2026]] §1, §6, [[video-generation-vram-2026]]

> Read `docs/architecture/decision-log.md` before implementing. Video generation
> work respects D7 (8GB VRAM constraint) and D1 (render engine chain).

---

## Problem

Two high-priority gaps block reliable video generation and quality assurance:

1. **LTX Video 2.3 backend path missing** — LTX-2B-distilled was validated as viable on 8GB VRAM (2026-10-06: 25f 768×512 in 210s, no OOM, coherent output), but no backend render path exists. The current primary is Wan 2.2 Q4 (slower, 853.7s for 25f).
2. **No full-pipeline E2E test** — Each piece (upload, analysis, generation, render, export) is tested in isolation, but no test covers the end-to-end music video workflow. A regression in the pipeline chain could ship undetected.
3. **No VRAM leak test** — `vram_manager.py` offloads/loads models, but no test verifies VRAM returns to baseline after a job. Long sessions risk OOM.

Research gaps §1 and §6 flag these as **Research Now** (highest priority). This plan implements the LTX path and adds the missing test infrastructure.

---

## Feature specs

### V1 — LTX Video 2.3 backend render path

Add LTX as a secondary video model option (not replacing Wan, but providing a faster alternative for certain use cases):

**Backend implementation:**

1. **Model tier entry** — Add LTX to `services/model_tiers.py`:
   - Model name: `ltxv-2b-0.9.8-distilled-fp8`
   - VRAM cost: ~5GB (measured: 4.46 GB on GTX 1070 Ti)
   - Resolution limit: 768×512 max for 8GB
   - Recommended steps: 25
   - Speed: ~4× faster than Wan 2.2 Q4

2. **ComfyUI workflow builder** — Add `_build_ltx_workflow()` in `services/comfyui_workflow_handler.py` mirroring `_build_wan_gguf_workflow()`:
   - UNETLoader → CLIPLoader(ltxv) → LTXVConditioning → KSampler → VAEDecode
   - Use stock `t5-xxl-fp8` and `LTX23_video_vae` (already staged on disk per decision-log)
   - Default: 25 steps, cfg 6.0, unipc scheduler, shift 5.0

3. **Adapter integration** — Extend `ComfyUIAdapter._generate_video()` to detect LTX model and dispatch to the LTX workflow builder.

4. **Cost estimation** — Update `services/generation_estimator.py` to estimate LTX render time based on frame count (measured: 210s for 25f at 768×512).

**Frontend changes:**

- Add LTX to the video model selector in the music video wizard (if it exists) or as a model preference in settings
- Show estimated render time in the cost estimator (D9's card)

**Acceptance:**

- `POST /api/integrations/music-video/generate` with `model: "ltx"` returns HTTP 200
- Generated video is coherent (interframe diff < 10, edge density > 0.15)
- Render completes in < 250s for 25f at 768×512 on GTX 1070 Ti
- No OOM error
- Unit tests for the workflow builder (mock ComfyUI API, assert correct node graph)
- Live test: generate a 25f clip with LTX, verify output file exists and is valid MP4

**Files:**

- Backend: `services/model_tiers.py`, `services/comfyui_workflow_handler.py`, `adapters/comfyui.py`, `services/generation_estimator.py`
- Frontend: model selector component (existing or new)
- Tests: `tests/test_comfyui_workflow.py` (LTX workflow test), `tests/test_generation_estimator.py`

---

### V2 — Full-pipeline E2E test

Add a Playwright test that drives the complete music video generation workflow:

**Test scope:**

1. Upload a 10s test audio file (or use an existing short track from the library)
2. Run audio analysis (wait for completion)
3. Configure generation (select a simple template, e.g., shader preset)
4. Trigger generation (wait for job completion)
5. Verify output MP4 exists in `output/video/`
6. Verify output duration matches input (within 0.5s tolerance)
7. Verify output is valid MP4 (ffprobe check via backend endpoint or file existence)

**Test file:** `packages/frontend/tests/e2e/music-video-generation.spec.ts`

**Test fixture requirements:**

- Short test audio file (≤10s) in the library or generated on-the-fly
- Mock ComfyUI if unavailable (use a fixture video instead of real generation)
- Cleanup: delete test output after test

**Acceptance:**

- Test passes with real services (backend + ComfyUI if available)
- Test passes with mocked ComfyUI (graceful degradation)
- Test completes in < 5 minutes (real services) or < 2 minutes (mocked)
- Test asserts each step (upload → analysis → generation → export)
- Test output is cleaned up (no test artifacts left in `output/video/`)

**Files:**

- Frontend: `packages/frontend/tests/e2e/music-video-generation.spec.ts` (new)
- Fixture: test audio file (short WAV/MP3)
- Helper: backend route for ffprobe check if needed

---

### V3 — VRAM baseline leak test

Add a test that verifies VRAM returns to baseline after each job type:

**Test methodology:**

1. Capture baseline VRAM usage before job (via `nvidia-smi --query-gpu=memory.used --format=csv,noheader`)
2. Run a job of each type:
   - 3D generation (Unity/Three.js studio render)
   - Video generation (Wan or LTX)
   - Music generation (ACE-Step)
3. Capture VRAM after job
4. Assert VRAM is within 512MB of baseline (allow some overhead but detect leaks)
5. Repeat 3 times to catch cumulative leaks

**Test file:** `tests/test_vram_leak.py` (backend integration test)

**Implementation notes:**

- Use `subprocess.run(['nvidia-smi', ...])` to query VRAM
- Test is marked as "integration" and skipped if `nvidia-smi` is unavailable
- Each job type uses a minimal workload (short duration, small resolution)
- Test logs before/after VRAM for triage

**Acceptance:**

- Test passes on GTX 1070 Ti (or is skipped gracefully on non-NVIDIA systems)
- Each job type returns VRAM to within 512MB of baseline
- No cumulative leak across 3 iterations
- Test is flake-free (no intermittent failures due to background processes)

**Files:**

- Backend: `tests/test_vram_leak.py` (new)
- Helper: `services/vram_test_utils.py` (VRAM query functions)

---

## Suggested order

V1 (LTX path) → V2 (E2E test) → V3 (VRAM leak test)

Rationale:

- V1 adds a new capability (faster video generation)
- V2 validates the pipeline end-to-end (catches integration bugs)
- V3 validates resource management (prevents long-session OOM)

V2 and V3 can run in parallel after V1 lands.

---

## Non-goals

- Mochi/CogVideoX integration (deferred per gaps register §1)
- Video quality metrics (FVD/SSIM) — out of scope for this plan
- Docker/CI setup (deployment research, separate track)
- Changing decided architecture (D1–D44, Q1–Q6 are settled)

---

## Verification gates

| Gate                 | Command                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Backend type check   | `ruff check packages/backend/app/services/comfyui_workflow_handler.py`                             |
| Backend tests        | `pytest tests/test_comfyui_workflow.py tests/test_generation_estimator.py tests/test_vram_leak.py` |
| LTX integration test | Manual: generate a 25f clip with LTX, verify output                                                |
| Frontend build       | `pnpm build` in `packages/frontend`                                                                |
| E2E test             | `pnpm exec playwright test music-video-generation.spec.ts`                                         |
| Knowledge docs       | `python tools/validate-knowledge-tags.py`                                                          |

---

## Out of scope

- Unity-visualizer (protected per AGENTS.md)
- ComfyUI workflow changes beyond LTX (Wan stays as primary)
- Decision-log reversals
- Q1–Q6 (all resolved)
