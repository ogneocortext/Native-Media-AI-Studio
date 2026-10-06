---
tags:
  - research
  - features
  - utilization
  - data-flow
  - dead-code
aliases:
  - Feature Utilization & Gap Analysis 2026
  - Feature Audit
  - Underutilized Features
cssclasses:
  - research
date: 2026-09-24
---

# 🎯 Feature Utilization & Gap Analysis 2026

> [!info] Purpose
> This document maps every significant feature in Native Media AI Studio to its
> actual utilization state. Unlike a conventional "wiring checklist," it focuses
> on **data flow**, **false confidence**, and **orphaned capabilities** — places
> where the app either loses information between stages, presents features that
> are not actually active, or leaves high-value modules disconnected from the
> main user journeys.
>
> **How to read this:** Each section identifies a concrete anomaly in the
> current codebase, the exact evidence (file paths, import chains, runtime
> behavior), and the leverage of fixing it.

---

## 1. Implemented Fallback & Validation

These modules were previously listed as dead code but are now wired into the
runtime codebase.

### 1.1 `visual_fallback.py` — Implemented

**Status:** ✅ Wired into `music_video_handler.py` with AI→FFmpeg fallback path.

**Evidence:**

- `packages/backend/app/services/visual_fallback.py` — 179 lines, deterministic preset selector
- Imported and called from `packages/backend/app/services/music_video_handler.py`
- When ComfyUI/adapter fails, jobs degrade to FFmpeg shader presets with `degraded`, `visual_source_used`, `fallback_reason` fields on SSE
- Frontend `selectVisualPreset()` exists in `visualPresets.ts` as the UI mirror

**Flow:** `integrations_music_video.py` catches adapter unavailability → queues degraded job → `music_video_handler.py` calls `select_fallback_preset()` → renders via FFmpeg → broadcasts SSE with fallback metadata.

---

### 1.2 `mcp_validator.py` — Implemented

**Status:** ✅ Wired into 4 MCP bridges + FastAPI endpoint.

**Evidence:**

- `packages/backend/app/services/mcp_validator.py` — full JSON Schema validator for 38 in-repo MCP tools
- Imported and called from `tools/mcp/ollama-tools-mcp.mjs`
- Imported and called from `tools/mcp/hyperframes-mcp.mjs`
- Imported and called from `tools/mcp/vision-mcp.mjs`
- Imported and called from `tools/mcp/unity-mcp-bridge.mjs`
- Exposed via FastAPI endpoint `POST /api/mcp/validate-tool` (`packages/backend/app/api/mcp_validate.py`)
- Registered in `packages/backend/app/main.py`

**Flow:** Each bridge's `tools/call` (or equivalent) handler calls `validateMcpToolCall()` before dispatching → rejects invalid payloads with structured errors → prevents agents from inventing commands outside the schema.

---

## 2. Orphaned Capabilities

These features are fully functional end-to-end but are **disconnected from the
main user flows**. Users must manually navigate to isolated pages to access them.

### 2.1 Music Prompt Generator — Island in the Wizard

**Anomaly:** A full multi-platform prompt generator (Suno v6, MiniMax 3.0,
HappyShrimp 1.0, Lyria 3.5) exists as a standalone page at `/music-prompts`
with its own API, knowledge base JSON files, and frontend component. The
music video wizard (`/music-video-wizard`) does **not** invoke it at any step.

**Evidence:**

- `packages/backend/app/services/music_prompt_generator.py` — 833 lines, 4 platforms
- `packages/backend/app/api/music_prompts.py` — templates + generate endpoints
- `packages/frontend/src/features/music-prompts/MusicPromptGenerator.tsx` — full page
- `MusicVideoWizard.tsx` — 5 steps (Upload → Analyze → Style → Generate → Review)
  with no prompt-generation step
- `STEPS` in `music-video/types.ts` does not include `"prompts"`

**Impact:** High. Users who want AI-generated prompts must context-switch
manually. The wizard's "Style" step has a textarea for manual prompts but no
"Generate with AI" button.

**Data flow break:** The wizard's `config.prompt` field is populated by manual
typing, not by the `music_prompt_generator` service that already knows the
user's genre, mood, and track analysis.

---

### 2.2 Storyboard → HyperFrames — Compiler Implemented

**Status:** ✅ Wired backend path. The compiler accepts generated `scenes` or the
legacy HyperFrames `beats` shape, validates timing, and emits a portable HTML
composition plus JSON manifest. Use `POST /api/hyperframes/compile-storyboard`,
then render through `POST /api/hyperframes/render`.

**Evidence:**

- `packages/backend/app/services/storyboard_hyperframes.py` — compiler and manifest writer
- `packages/backend/app/api/hyperframes.py` — `POST /api/hyperframes/compile-storyboard`
- `packages/backend/tests/test_storyboard_hyperframes.py` — valid, missing, and overlapping scene tests
- `tools/hyperframes-built-this-from-a-dream/inject_storyboard.py` — retained project-specific injector

**Remaining gap:** The generated composition is a portable scene-card baseline,
not a replacement for a bespoke art-directed composition. Add a preview action
and optional asset/caption mapping after validating real storyboard payloads.

---

## 3. Data That Dies at the Pipeline Boundary

These are data structures that are produced but never consumed by downstream
stages.

### 3.1 Demucs Stems → Visualizer: Implemented + Evaluated

**Status:** ✅ Implemented. The visualizer now consumes per-stem energy curves
and mixer state (`stemsMuted`, `stemsVolumes`) to modulate shader uniforms in
real time.

**Evidence:**

- `packages/backend/app/services/source_separation.py` — `STEM_NAMES = ("vocals", "drums", "bass", "other")`
- `get_stems` returns `stems_mp3` URL map
- `packages/frontend/src/features/visualizer/StemMixer.tsx` — per-stem volume/mute UI, propagates state upward
- `packages/frontend/src/features/visualizer/Visualizer.tsx` — fetches stem analysis, passes `stems`, `sampleAudio`, `stemsMuted`, `stemsVolumes` to `ShaderVisualizer`
- `packages/frontend/src/features/visualizer/ShaderVisualizer.tsx` — samples stem energy curves per frame and applies mute/volume scaling before blending into shader uniforms

**Evaluation findings (2026-09-30):**

1. **Resilience gap fixed:** `StemMixer.tsx` previously failed all stems if one
   `createMediaElementSource` or network fetch threw. Wired per-stem try/catch
   so partial loads succeed and missing stems are skipped with a visible warning.
2. **CORS ordering fixed:** `crossOrigin = "anonymous"` was set AFTER `new Audio(url)`,
   meaning the initial request could fire without CORS headers. Now the element
   is created blank, `crossOrigin` is assigned, then `src` is set.
3. **Unused metering loop gated:** The `onLevels` rAF loop now only runs when a
   consumer actually passes `onLevels`. `StemMixerPanel` does not, so the loop
   is skipped — saves ~1ms/frame of wasted analyser reads.
4. **Data flow verified:** Backend `stem_analysis.py` downsamples energy curves
   to 80 points (max-pooling preserves peaks). Frontend `sampleStemEnergy` maps
   `elapsed / duration` linearly into that array. Drift is bounded by the
   downsampling resolution (~3s per bin on a 4-min track).
5. **Web research confirms:** MDN and WebAudio spec recommend one `AudioContext`
   per page; the current code uses two (main analyser + stem mixer). Not a bug
   because each is independently cleaned up, but a future optimization is to
   share one context.

**Impact:** Resolved. Stems now drive visualizer reactivity: drums→beat pulse,
bass→camera shake, vocals→lyrical emphasis, other→palette shift.

---

### 3.2 Audio Analysis → Video Pipeline: No Section-Aware Scheduling

**Anomaly:** `audio_analyzer.py` produces section detection (intro, verse,
chorus, drop, bridge, outro) with energy curves and beat times. The video
pipeline's `_SECTION_PROMPT_SUFFIX` maps sections to prompt modifiers, but
the wizard's `GenerateStep` does not iterate sections — it generates a single
clip for the whole track.

**Evidence:**

- `packages/backend/app/services/audio_analyzer.py` — section detection output
- `packages/backend/app/services/music_video_handler.py` — `_SECTION_PROMPT_SUFFIX` exists
- `MusicVideoWizard.tsx` — `GenerateStep` calls `generateVideoSection` once
- No per-section job queue in the wizard

**Impact:** Medium. The section-aware prompt suffixes exist but are never
applied because the wizard doesn't break the track into sections before
generation.

---

## 4. Features That Are Fully Wired (Verified)

These were flagged in the previous audit as "underutilized" but are actually
functional. The working tree contains both the backend endpoints and the
frontend panels, wired together.

### 4.1 Export Matrix

- **Backend:** `POST /api/video/export-matrix` in `video.py` (line 229)
- **Service:** `packages/backend/app/services/export_matrix.py`
- **Frontend:** `buildExportMatrix()` in `video-render.ts` → `ExportMatrixPanel.tsx`
- **UI:** Rendered in `MediaDetailModal.tsx` for `file_type === "video"`
- **Status:** ✅ Active — produces vertical MP4, loop, 3 thumbnails

### 4.2 Upscaling Service

- **Backend:** `POST /api/integrations/upscale` in `integrations_generation.py` (line 1376)
- **Service:** `packages/backend/app/services/upscale_service.py`
- **Frontend:** `upscaleImage()` in `integrations.ts` → `UpscalePanel.tsx`
- **UI:** Rendered in `MediaDetailModal.tsx` for `file_type === "image"`
- **Status:** ✅ Active — ComfyUI 4x-ClearRealityV1 or FFmpeg lanczos fallback

### 4.3 MCP Validator

- **Backend:** `mcp_validator.py` — 38 schemas, called from 4 MCP bridges
- **Endpoint:** `POST /api/mcp/validate-tool` (`mcp_validate.py`)
- **Bridges:** `ollama-tools-mcp.mjs`, `hyperframes-mcp.mjs`, `vision-mcp.mjs`, `unity-mcp-bridge.mjs`
- **Status:** ✅ Active — validates tool calls before dispatch

---

## 5. True Missing Capabilities

These are genuinely absent from the codebase, not merely unwired.

### 5.1 Video Quality Metrics

**Missing:** FVD, SSIM, PIRS metrics on generated video. Jobs return success/failure
but not perceptual quality scores.

**Evidence:** No metrics module in `packages/backend/app/services/`. No
`quality` field in `Job` model or `VideoGenerateResponse`.

**Impact:** Low-medium. Hard to compare Wan vs Kandinsky vs AnimateDiff outputs
objectively.

---

### 5.2 Automatic Fallback Chain

**Status:** ✅ Implemented. Decision Q2 AI → shader fallback is wired.

**Evidence:**

- `visual_fallback.py` — imported by `music_video_handler.py`
- `MusicVideoHandler` calls `select_fallback_preset()` when ComfyUI/adapter unavailable
- `integrations_music_video.py` queues degraded jobs instead of raising 503
- SSE includes `degraded`, `visual_source_used`, `fallback_reason` fields

**Flow:** ComfyUI failure → `integrations_music_video.py` catches exception → queues job with `visual_fallback` param → `music_video_handler.py` selects deterministic preset → renders via FFmpeg → broadcasts SSE with fallback metadata.

---

### 5.3 Storyboard → HyperFrames Compiler

**Status:** ✅ Implemented and exposed in the Storyboard page. The backend
compiler accepts the current Ollama `scenes` contract (`duration_seconds`) and
legacy `beats`/`start`/`end` shapes, then emits HTML plus a manifest. The UI
includes a **Compile HyperFrames** action and reports the generated scene count
and duration.

---

## 6. Test Coverage Gaps (Verified)

The E2E test plan and pipeline smoke tests cover 6 pages but miss the
high-traffic user flows:

| Flow                            | Covered | Notes                                                                            |
| ------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Health page                     | ✅      | 6/6 health tests pass                                                            |
| Queue page                      | ✅      | Pipeline smoke covers navigation                                                 |
| Audio analysis                  | ✅      | Pipeline smoke covers load                                                       |
| 3D generation                   | ✅      | Pipeline smoke covers load                                                       |
| Video generation                | ✅      | Pipeline smoke covers load                                                       |
| Music video wizard              | ✅      | Pipeline smoke covers load                                                       |
| **Media Library actions**       | ✅      | `media-library.spec.ts` covers header, category tabs, search, and send-to-wizard |
| **Settings changes**            | ❌      | No test for saving/loading settings                                              |
| **Cross-page handoffs**         | ❌      | No test for dashboard→queue→wizard flow                                          |
| **Video generation end-to-end** | ❌      | No test for submit → poll → result → download                                    |

**Evidence:**

- `packages/frontend/tests/pipeline-smoke.spec.ts` — 6 pages, no interactions
- `packages/frontend/tests/` — no spec for media library actions
- Pre-existing failures in `api-network.spec.ts`, `go-services.spec.ts`, `queue.spec.ts`

---

## 7. Root Cause Patterns

The anomalies above share three root causes:

### Pattern A: "Proof-of-Concept Drift"

Modules like `visual_fallback.py` and `mcp_validator.py` are written as
isolated proofs-of-concept, documented in the knowledge library, but never
integrated into the runtime path. They create the false impression that
resilience/validation is active.

**Signal:** A service file with zero import references across the codebase.

### Pattern B: "Page-Island Architecture"

The frontend has 20+ feature pages, but the wizard does not compose them.
`music_prompt_generator` is a full page, not a component the wizard can call.
This forces users to manually context-switch instead of flowing through a
guided pipeline.

**Signal:** A feature with a full API + page but no callers from other pages.

### Pattern C: "Data-Rich, Consumer-Poor"

The audio pipeline produces increasingly rich data (stems, sections, beat times,
word timestamps, energy curves), but the visualizer and video pipeline consume
only a fraction of it. Each new analysis backend (madmom, sonara) adds more
data that dies at the pipeline boundary.

**Signal:** API endpoints return 5+ fields; downstream code reads 1-2.

---

## 8. Implemented Knowledge-Library Features

These features were specified in the Gemini tutorial guidance docs and are now
implemented in the codebase.

### 7.1 In The Mix DSP (`suno_enhancer.py`)

- **Source:** `docs/knowledge/gemini-tutorial-guidance-2026-09-30/03-in-the-mix-mix-upgrades.md`
- **Service:** `packages/backend/app/services/suno_enhancer.py`
- **Status:** ✅ Implemented — two-stage EQ, parallel weight bus, sidechain pocket EQ

### 7.2 Bileam AudioReactivityProcessor

- **Source:** `docs/knowledge/gemini-tutorial-guidance-2026-09-30/04-bileam-audio-reactivity-module.md`
- **Module:** `packages/frontend/src/features/visualizer/audioReactivityProcessor.ts`
- **Status:** ✅ Implemented — abstract signal principle, multi-channel split, lag/smoothing buffer

### 7.3 PPPANIK InstancedBlobField

- **Source:** `docs/knowledge/gemini-tutorial-guidance-2026-09-30/05-pppanik-instanced-blob-field.md`
- **Component:** `packages/frontend/src/features/visualizer/components/InstancedBlobField.tsx`
- **Status:** ✅ Implemented — Three.js instanced mesh, audio-reactive simplex noise, 30k–60k instance budget

---

## 9. Recommended Actions

### Immediate (P0)

| Action                               | Why                                 | Effort |
| ------------------------------------ | ----------------------------------- | ------ |
| Add prompt-generation step to wizard | Music prompt generator is an island | 2h     |

### Short-term (P1)

| Action                                  | Why                                             | Effort |
| --------------------------------------- | ----------------------------------------------- | ------ |
| Wire stems into visualizer              | Demucs output is generated but ignored          | 4-8h   |
| Build storyboard → HyperFrames compiler | Storyboards are dead-end documents              | 4-8h   |
| Add per-section generation to wizard    | Section-aware prompts exist but aren't iterated | 4-6h   |

### Medium-term (P2)

| Action                       | Why                                               | Effort |
| ---------------------------- | ------------------------------------------------- | ------ |
| Add video quality metrics    | Needed to compare model variants objectively      | 4-8h   |
| Build benchmark dashboard    | Benchmark data stored but never aggregated        | 4-8h   |
| Evaluate 3D convergence (Q1) | Unity + Blender + Three.js = 3 maintenance tracks | 2-4h   |

---

## 11. What This Audit Does NOT Cover

This document intentionally does not duplicate:

- **Research gaps** — see `app-research-gaps-2026.md` for video model validation,
  audio backend comparisons, deployment targets
- **Upgrade paths** — see `javascript-upgrade-research-2026.md` for frontend
  modernization
- **Go sidecar rationale** — see `go-benefits-deep-dive-2026.md` for memory/startup
  trade-offs
- **Test plan** — see `e2e-test-plan-2026.md` for coverage matrix

This document is scoped to: **What does the app actually do end-to-end, and
where does it lose information, create false confidence, or strand working
code?**

---

## 12. See Also

- [[app-research-gaps-2026]] — 15 research areas
- [[e2e-test-plan-2026]] — Test coverage plan
- [[../architecture/decision-log.md|Architecture Decision Log]] — Q1 (3D convergence), Q2 (auto fallback), Q4 (visualizer modes)
- [[mcp-contracts-2026]] — 38-tool schema registry (now enforced)
- [[video-model-test-protocol-2026]] — GPU test matrix for LTX/Mochi
- `packages/backend/app/services/visual_fallback.py` — ✅ Wired into music_video_handler
- `packages/backend/app/services/mcp_validator.py` — ✅ Wired into 4 MCP bridges
- `packages/backend/app/services/music_prompt_generator.py` — Orphaned wizard step
- `packages/backend/app/services/export_matrix.py` — ✅ Wired (verified)
- `packages/backend/app/services/upscale_service.py` — ✅ Wired (verified)

---

_Last updated: 2026-10-05_
