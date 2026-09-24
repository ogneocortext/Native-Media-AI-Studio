---
tags:
  - features
  - utilization
  - data-flow
  - dead-code
  - orphaned-capabilities
  - 2026
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

## 1. False-Confidence Features

These are modules that exist, are documented, and appear in the knowledge library,
but are **never imported or executed** anywhere in the runtime codebase.

### 1.1 `visual_fallback.py` — Dead Code with Full Documentation

**Anomaly:** A 180-line Python module that implements deterministic shader preset
selection (genre/energy/BPM → preset id). It is referenced in `app-research-gaps-2026.md`,
`decision-log.md` (Q2), and `feature-utilization-audit-2026.md` (previous version)
as an active fallback mechanism. It is **not imported by any other module**.

**Evidence:**
- `packages/backend/app/services/visual_fallback.py` — 179 lines, full implementation
- Zero import references across the entire `packages/` tree
- Not called from `music_video_handler.py`, `comfyui_workflow_handler.py`, or any adapter
- Frontend `selectVisualPreset()` exists in `visualPresets.ts` but is also not called
  from the wizard or video pipeline

**Impact:** Medium. The fallback design goal from decision Q2 is documented but
unimplemented. When ComfyUI fails, jobs error out instead of degrading to shader
presets. Users perceive the app as "fragile" because the resilience mechanism
doesn't actually run.

**Root cause:** The module was written as a "pure logic" proof-of-concept but
never wired into the job handler's exception path.

**Fix:** One import + one `except` branch in `music_video_handler.py`.

---

### 1.2 `mcp_validator.py` — Dead Code with Schema Registry

**Anomaly:** A 435-line JSON Schema validator for 38 in-repo MCP tools. Created
2026-09-24, documented in `mcp-contracts-2026.md`, but **never imported** by
any MCP bridge or agent runtime.

**Evidence:**
- `packages/backend/app/services/mcp_validator.py` — full implementation
- Not imported from `tools/mcp/unity-mcp-bridge.mjs`
- Not imported from `tools/mcp/ollama-tools-mcp.mjs`
- Not imported from `tools/mcp/blender-mcp` or any other bridge
- No test file imports it (except the module itself)

**Impact:** Medium. Agents occasionally invent invalid commands because there
is no validation layer. The validator exists but is inert.

**Root cause:** Created as infrastructure before the bridges were ready to
consume it. No bridge has been updated to call it.

**Fix:** Import + call in each bridge's `tools/call` handler.

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

### 3.1 Demucs Stems → Visualizer: No Mapping

**Anomaly:** Audio source separation produces 4 stems (vocals, drums, bass,
other) with MP3 encoding. The visualizer has 3 render modes (bars, waveform,
radial) but **no per-stem reactivity**.

**Evidence:**
- `packages/backend/app/services/source_separation.py` — `STEM_NAMES = ("vocals", "drums", "bass", "other")`
- `get_stems` returns `stems_mp3` URL map
- `packages/frontend/src/features/visualizer/` — no stem-aware component
- `Canvas2DVisualizer.tsx` — 3 modes, all driven by full-track audio analysis
- `ShaderVisualizer.tsx` — genre presets, no stem routing

**Impact:** High for the music video use case. The user uploads a track, waits
for separation, then sees no difference in the visualizer. The stems are
generated, served, and ignored.

**Data flow break:**
```
audio.mp3 → Demucs → stems/{vocals,drums,bass,other}.mp3 → (no consumer)
```

**Expected flow:**
```
stems → visualizer routing: drums→kick flash, bass→pulse, vocals→center, other→particles
```

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

### 4.3 MCP Validator (Infrastructure Only)

- **Backend:** `mcp_validator.py` — 38 schemas, valid but **not called**
- **Status:** ⚠️ Infrastructure exists but no runtime enforcement

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

**Missing:** Decision Q2 specifies AI → shader → 2D fallback priority list.
Only the frontend `selectVisualPreset()` exists; the backend `visual_fallback.py`
is dead code. No fallback chain runs at job execution time.

**Evidence:**
- `visual_fallback.py` — not imported anywhere
- `MusicVideoHandler._process_job_inner` — no fallback branch
- `comfyui_workflow_handler.py` — raises on failure, no degrade path

**Impact:** High. ComfyUI downtime = failed jobs instead of degraded shader renders.

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

| Flow | Covered | Notes |
|------|---------|-------|
| Health page | ✅ | 6/6 health tests pass |
| Queue page | ✅ | Pipeline smoke covers navigation |
| Audio analysis | ✅ | Pipeline smoke covers load |
| 3D generation | ✅ | Pipeline smoke covers load |
| Video generation | ✅ | Pipeline smoke covers load |
| Music video wizard | ✅ | Pipeline smoke covers load |
| **Media Library actions** | ❌ | No test for detail modal, extract audio, upscale, export matrix |
| **Settings changes** | ❌ | No test for saving/loading settings |
| **Cross-page handoffs** | ❌ | No test for dashboard→queue→wizard flow |
| **Video generation end-to-end** | ❌ | No test for submit → poll → result → download |

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

## 8. Recommended Actions

### Immediate (P0)

| Action | Why | Effort |
|--------|-----|--------|
| Delete or wire `visual_fallback.py` | Dead code creates false confidence in Q2 fallback | 2h |
| Wire `mcp_validator.py` into bridges | Schema validation is documented but inert | 4h |
| Add prompt-generation step to wizard | Music prompt generator is an island | 2h |

### Short-term (P1)

| Action | Why | Effort |
|--------|-----|--------|
| Wire stems into visualizer | Demucs output is generated but ignored | 4-8h |
| Build storyboard → HyperFrames compiler | Storyboards are dead-end documents | 4-8h |
| Add per-section generation to wizard | Section-aware prompts exist but aren't iterated | 4-6h |
| Add media library E2E tests | High-traffic flow has zero automated coverage | 4-6h |

### Medium-term (P2)

| Action | Why | Effort |
|--------|-----|--------|
| Implement fallback chain (Q2) | ComfyUI downtime should degrade, not fail | 4-8h |
| Add video quality metrics | Needed to compare model variants objectively | 4-8h |
| Build benchmark dashboard | Benchmark data stored but never aggregated | 4-8h |
| Evaluate 3D convergence (Q1) | Unity + Blender + Three.js = 3 maintenance tracks | 2-4h |

---

## 9. What This Audit Does NOT Cover

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

## See Also

- [[app-research-gaps-2026]] — 15 research areas
- [[e2e-test-plan-2026]] — Test coverage plan
- [[decision-log]] — Q1 (3D convergence), Q2 (auto fallback), Q4 (visualizer modes)
- [[mcp-contracts-2026]] — 38-tool schema registry (not yet enforced)
- [[video-model-test-protocol-2026]] — GPU test matrix for LTX/Mochi
- `packages/backend/app/services/visual_fallback.py` — Dead-code fallback logic
- `packages/backend/app/services/mcp_validator.py` — Dead-code schema validator
- `packages/backend/app/services/music_prompt_generator.py` — Orphaned wizard step
- `packages/backend/app/services/export_matrix.py` — ✅ Wired (verified)
- `packages/backend/app/services/upscale_service.py` — ✅ Wired (verified)

---

*Last updated: 2026-09-24*
