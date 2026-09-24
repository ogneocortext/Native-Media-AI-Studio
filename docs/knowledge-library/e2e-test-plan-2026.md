---
tags:
  - testing
  - e2e
  - playwright
  - pipeline
  - roadmap
aliases:
  - E2E Test Plan
  - Full Pipeline Test Plan
  - Pipeline Smoke Test Plan
cssclasses:
  - testing
  - e2e
date: 2026-09-24
---

# 🧪 E2E Test Plan 2026 — Full Pipeline

> [!info] Scope
> This is the canonical test strategy and rollout plan for the full pipeline.
> It is intentionally separate from [[app-research-gaps-2026]], which records
> research priorities rather than executable test coverage.

> [!warning] Historical blocker (resolved for current browser suite)
> An earlier Windows Vite MIME-type issue prevented module loading. The current
> frontend Playwright suites run against a live Vite server; the full pipeline
> smoke/export matrix still depends on the services listed in P1c.

---

## 1. What "Full Pipeline" Means

The music-video pipeline spans multiple services and pages:

```
Upload Audio → Analyze Beats → Configure Generation → Generate 3D/Video → Composite → Export
```

| Stage | Frontend Page | Backend Endpoint | External Service |
|-------|--------------|------------------|-----------------|
| Upload | `/audio-analysis` | `POST /api/audio/upload` | — |
| Analyze | `/audio-analysis` | `POST /api/audio/analyze` | librosa / madmom |
| Configure | `/music-video-wizard` | `GET /api/integrations/config/settings` | — |
| Generate 3D | `/generate-3d` | `POST /api/gen3d/generate` | ComfyUI / Hunyuan3D |
| Generate Video | `/video-generation` | `POST /api/video/generate` | ComfyUI / Wan |
| Music | `/music-prompts` | `POST /api/music/generate` | ACE-Step |
| Composite | `/video-generation` | `POST /api/video/composite` | FFmpeg / MovieLite |
| Export | `/queue` | `GET /api/jobs/{id}` | — |

---

## 2. Test Strategy

### 2.1 Phased Approach

| Phase | Scope | Effort | Status |
|-------|-------|--------|--------|
| **P1a** | Pipeline smoke — page navigation + API mocking | 2-4h | ✅ Drafted; run against a live Vite server |
| **P1b** | Backend integration tests — real FastAPI TestClient | 4-8h | ✅ Implemented |
| **P1c** | Full E2E with real services — requires running backend + Ollama + ComfyUI | 8-16h | 🟡 Environment-dependent |

### 2.2 P1a: Pipeline Smoke (Current)

**Goal**: Verify that every pipeline page renders without crashing and that
navigation preserves the app shell.

**Approach**: Mock backend endpoints via Playwright route handlers.

**Test file**: `packages/frontend/tests/pipeline-smoke.spec.ts`

**Pages covered**:
- `/health` — backend + adapter health cards
- `/queue` — job list, stats, SSE indicator
- `/audio-analysis` — upload zone, analysis charts
- `/generate-3d` — wizard stepper, model selector
- `/video-generation` — video model selector, job params
- `/music-video-wizard` — orchestrator page

**Current status**: The browser suite is runnable against a live Vite server;
full pipeline smoke/export execution still requires the services in P1c.

### 2.3 P1b: Backend Integration Tests

**Goal**: Verify backend API contracts independently of the frontend.

**Approach**: FastAPI `TestClient` + pytest-asyncio.

**New test file**: `packages/backend/tests/test_pipeline_integration.py`

**Test cases**:
1. `POST /api/audio/upload` accepts a valid audio file, returns `stored_path`
2. `POST /api/audio/analyze` queues analysis, returns `job_id`
3. `GET /api/audio/analysis/{filename}` returns `tempo_bpm`, `sections`, `energy_curve`
4. `POST /api/jobs/` with `job_type=image_generation` creates a queued job
5. `GET /api/jobs/{id}` returns the job with matching `job_type`
6. `GET /api/integrations/comfyui/status` returns `installed` + `running`
7. `GET /api/integrations/video-models` returns model list with tier tags

**Fixture**: Use `tmp_path` for uploads; mock `queue_manager` to avoid
external service calls.

### 2.4 P1c: Full E2E with Real Services

**Goal**: One test drives the entire pipeline against real services.

**Prerequisites**:
- Backend running on port 8000
- Ollama running on port 11434
- ComfyUI running on port 8188
- Test audio file in `packages/frontend/tests/fixtures/audio/`
- GTX 1070 Ti with CUDA available

**Test flow**:
1. Upload `tests/fixtures/audio/10s-test-tone.mp3` via UI
2. Wait for analysis to complete (`/api/audio/analysis/{filename}`)
3. Navigate to `/music-video-wizard`, select 3D model
4. Trigger generation, wait for job to complete
5. Assert output MP4 exists in `output/video/`
6. Assert duration matches input audio (±0.5s)

**Estimated runtime**: 15-30 minutes per run (dominated by model inference).

---

## 3. Environment Requirements

### 3.1 For P1a (Playwright smoke)

```bash
# In packages/frontend/
npm run dev   # Vite on port 5173
npx playwright test --project=chromium
```

**Known issue**: The Vite dev server returns `application/json` for module
script requests in this Windows environment. Fix options:
- Ensure Vite is serving with correct MIME types (`vite config` SSR off)
- Use `page.route('**/*.js', ...)` to override MIME type in tests
- Build first (`npm run build`) and serve static dist

### 3.2 For P1b (Backend integration)

```bash
# In packages/backend/
python -m pytest tests/test_pipeline_integration.py -v
```

No external services required if `queue_manager` is mocked.

### 3.3 For P1c (Full E2E)

```bash
# All services
scripts\start-services.ps1
# Or manually:
ollama serve
python -m app.main
node tools/mcp/comfyui-mcp.mjs
```

---

## 4. Test Fixtures

| Fixture | Purpose | Format |
|---------|---------|--------|
| `tests/fixtures/audio/10s-test-tone.mp3` | Minimal audio for upload/analysis | MP3, 10s, 44.1kHz |
| `tests/fixtures/audio/30s-lyrical.mp3` | Lyrics + sections test | MP3, 30s |
| `tests/fixtures/images/character-ref.png` | 3D reference image test | PNG, 512×512 |
| `tests/fixtures/video/expected-output.mp4` | Golden output for duration check | MP4, 10s |

---

## 5. Success Criteria

| Metric | Target |
|--------|--------|
| Pipeline smoke pass rate | 100% on all pages |
| Backend integration coverage | 7 endpoints covered |
| Full E2E pass rate | 1/1 on happy path |
| E2E runtime | <30 minutes |
| Flake rate | <5% over 10 runs |

---

## 6. Implementation Status

| Item | Status |
|------|--------|
| `pipeline-smoke.spec.ts` | ✅ Written; browser suite runnable |
| `test_pipeline_integration.py` | ✅ Implemented |
| Test fixtures | 📋 Add/confirm before full real-service run |
| Full E2E golden output | ⏸ Deferred until P1c environment is available |

---

## See Also

- [[app-research-gaps-2026#6-testing--quality|App Research Gaps 2026 — Testing & Quality]]
- [[pascal-gpu-optimization-2026|Pascal GPU Optimization 2026]] — GTX 1070 Ti constraints
- [[technical-reference|Technical Reference]] — API endpoint reference

---


- **Live browser verification:** `/queue`, `/library`, and `/ollama-chat` were checked with Playwright at desktop and mobile widths. Queue uses modified-time ordering and responsive rows; stale job output paths are filtered by the backend; Ollama Chat normalizes the live model catalog and prefers local models.

*Last updated: 2026-09-24*
