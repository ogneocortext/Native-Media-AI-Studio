# Native Media AI Studio — Dependency & Wiring Analysis

> **Scope:** Read-only evidence sweep of `packages/backend`, `packages/frontend`, `packages/video-editor`, `tools`, `scripts`, and `shared`.
> **Methodology:** 
> - Python: ripgrep `^import X` / `^from X import Y` across active code; conditional imports inside `try/except` treated as **functional (optional)**.
> - TS/JS: ripgrep `import ...` / `from "pkg"` across `src/` and `tools/`.
> - Dead files: confirmed by absence of import references in active backend/app, frontend/src, video-editor/src, and tools/ (docs/scripts/MCP configs count as “in use”).
> - System binaries: confirmed by `subprocess.run`, `shutil.which`, `os.system` greps vs `docs/SYSTEM_REQUIREMENTS.md`.

---

## Section A: Python Dependency Health Matrix

### A.1 `packages/backend/requirements.txt`

| Dependency | Version Pin | Status | Evidence |
|------------|-------------|--------|----------|
| `fastapi` | `>=0.141.0` | **USED** | `app/main.py`, `app/api/*.py` |
| `uvicorn[standard]` | `>=0.52.0` | **USED** | `app/main.py` |
| `pydantic` | `>=2.13.3` | **USED** | `app/models/*.py`, `app/core/config.py`, `app/api/*.py` |
| `pydantic-settings` | `>=2.0.0` | **USED** | `app/core/config.py` |
| `python-multipart` | `>=0.0.20` | **USED** | Not directly imported, but required by FastAPI `UploadFile` / `Form()` parsing. |
| `aiohttp` | `>=3.13.5` | **USED** | `app/adapters/ollama.py`, `app/adapters/comfyui.py`, `app/api/integrations_misc.py`, `app/api/audio.py` |
| `psutil` | `>=7.2.2` | **USED** | `app/diagnostics/health.py`, `app/queue/manager.py`, `app/api/health.py`, `app/api/integrations_config.py`, `app/services/vram_manager.py`, `app/adapters/ollama.py` |
| `python-socketio` | `>=5.16.1` | **VESTIGIAL** | **Zero import hits** in `packages/backend/app/`, `tools/`, or `scripts/`. Not referenced in code. |
| `Pillow` | `>=12.2.0` | **USED** | `app/services/cuda/processor.py`, `tools/design-feedback/design_feedback.py`, `tools/tests/vision_analyze.py` |
| `librosa` | `>=0.11.0` | **USED** | `app/services/audio_analyzer.py` (conditional), `app/services/source_separation.py` (conditional) |
| `soundfile` | `>=0.13.1` | **USED** | Not directly imported, but required by `librosa.load()`. |
| `websockets` | `>=17.0` | **USED** | Not directly imported in `app/`, but `uvicorn(ws="websockets")` and FastAPI WebSocket support require it. |
| `numpy` | `>=1.24.0` | **USED** | `app/services/cuda/processor.py` (direct), `app/services/audio_analyzer.py` (conditional), `app/services/structure_analysis.py` (conditional), `app/services/source_separation.py` (conditional), `app/api/integrations_misc.py` (inline) |
| `gpustat` | `>=1.1.1` | **USED** | `app/diagnostics/resources.py` (conditional), `app/services/vram_manager.py` (conditional) |
| `nvidia-ml-py` | `>=13.0` | **USED** | `app/diagnostics/resources.py` (NVML fallback when gpustat fails) |
| `httpx` | `>=0.25.0` | **USED** | `app/core/http_client.py` |
| `python-dotenv` | `>=1.0.0` | **VESTIGIAL** | **Zero import hits** for `dotenv` / `load_dotenv` / `find_dotenv` anywhere in repo. |
| `requests` | `>=2.32.0` | **USED** | `app/services/audio_analysis_agent.py`, `tools/design-feedback/design_feedback.py`, `tools/blender_mcp_addon.py` |
| `sse-starlette` | `>=2.0.0` | **USED** | `app/main.py`, `app/api/integrations_generation.py` |
| `pytest-asyncio` | `>=0.24.0` | **TEST ONLY** | Not runtime. |
| `pytest-cov` | `>=5.0.0` | **TEST ONLY** | Not runtime. |
| `pytest-xdist` | `>=3.6.0` | **TEST ONLY** | Not runtime. |
| `mido` | `>=1.3.0` | **VESTIGIAL (backend)** | **Zero import hits** in `packages/backend/app/`. Only used in `tools/batch_process.py` and `tools/audio_export.py`. |
| `python-osc` | `>=1.9.2` | **VESTIGIAL (backend)** | **Zero import hits** in `packages/backend/app/`. Only used in `tools/audio_export.py`. |

### A.2 `packages/backend/requirements-torch.txt`

| Dependency | Version Pin | Status | Evidence |
|------------|-------------|--------|----------|
| `torch` | `2.14.0+cu126` | **USED** | `app/services/comfyui_manager.py`, `app/services/transcription.py`, `app/diagnostics/resources.py`, `app/api/integrations_misc.py`, `app/services/vram_manager.py`, `app/services/cuda/processor.py` |
| `torchvision` | `0.29.0+cu126` | **LOW** | Not directly imported. Part of torch ecosystem; potentially used for image transforms if any code path loads it dynamically. |
| `torchaudio` | `2.11.0+cu126` | **LOW** | Not directly imported. `librosa` + `soundfile` handle audio I/O; torchaudio not referenced. |

### A.3 `packages/backend/requirements-experimental.txt`

| Dependency | Version Pin | Status | Evidence |
|------------|-------------|--------|----------|
| `madmom-infer` | `>=0.1.0` | **USED (optional)** | `app/services/audio_analyzer.py` (conditional import + `_analyze_madmom`); wired via `app/api/audio.py` backend selector. |
| `sonara` | `>=0.1.0` | **USED (optional)** | `app/services/audio_analyzer.py` (conditional import + `_analyze_sonara`); wired via `app/api/audio.py` backend selector. |
| `faster-whisper` | `>=1.1.0` | **USED (optional)** | `app/services/transcription.py` (lazy import in `get_model()`); wired via `app/api/transcription.py`. |
| `demucs` | `>=4.0.0` | **USED (optional)** | `app/services/source_separation.py` (subprocess `demucs` CLI); wired via `app/api/audio.py` `/separate` endpoint. |
| `spleeter` | *(implied)* | **USED (optional)** | `app/services/source_separation.py` (subprocess `spleeter` CLI fallback); wired via same endpoint. |
| `core-flux` | `>=0.1.0` | **VESTIGIAL** | Only referenced in `scripts/benchmark_video_tools.py`. Not in backend runtime. |
| `MovieLite` | `>=0.1.0` | **VESTIGIAL** | Only referenced in `scripts/benchmark_video_tools.py`. Not in backend runtime. |
| `kaolin` | `>=0.17.0` | **VESTIGIAL** | **Zero hits** anywhere in repo. |
| `gsplat` | `>=1.0` | **VESTIGIAL** | **Zero hits** anywhere in repo. |

### A.4 `tools/pyproject.toml` optional-dependencies

| Extra | Dep | Status | Evidence |
|-------|-----|--------|----------|
| `audio` | `mido` | **USED (tools only)** | `tools/batch_process.py`, `tools/audio_export.py` |
| `audio` | `python-osc` | **USED (tools only)** | `tools/audio_export.py` |
| `midi` | `mido` | **USED (tools only)** | Same as above |
| `osc` | `python-osc` | **USED (tools only)** | Same as above |
| `test` | `mcp` | **USED (tests only)** | `tools/tests/test_mcp.py`, `tools/tests/test_mcp_stdio.py` |

### A.5 Third-party modules imported but NOT declared

| Module | Where Imported | Risk |
|--------|----------------|------|
| `bpy` / `mathutils` | `tools/blender_mcp_addon.py`, `tools/blender_mv_client.py`, `tools/convert_blend_to_glb.py` | **None** — documented as “runs inside Blender’s embedded Python, not studio venv.” |
| `mss` | `tools/design-feedback/design_feedback.py` | **Low** — only in a standalone tool script; not in `requirements*.txt`. |
| `httpx` | `tools/design-feedback/design_feedback.py` | **Low** — declared in backend `requirements.txt`, so available if tool runs in same env. |

---

## Section B: JS/TS Dependency Health Matrix

### B.1 Root `package.json`

| Dependency | Status | Evidence |
|------------|--------|----------|
| `sharp` | **USED** | `scripts/vision.mjs`, `scripts/vision-quick.mjs`, `scripts/analyze-visualizer-frames.mjs`, `scripts/verify-shader-motion.mjs`, `scripts/vision/analyze.mjs` |
| `turbo` | **LOW** | `turbo.json` exists, but **zero** script in `package.json` invokes `turbo`. Build uses `pnpm -r build`. Likely vestigial. |
| `@modelcontextprotocol/server` | **USED** | `tools/mcp/ollama-tools-mcp.mjs`, `tools/mcp/vision-mcp.mjs`, `tools/mcp/unity-mcp-bridge.mjs` |
| `zod` | **USED** | `tools/mcp/unity-mcp-bridge.mjs` |

### B.2 `packages/frontend/package.json`

| Dependency | Status | Evidence |
|------------|--------|----------|
| `@react-three/drei` | **USED** | `features/generate3d/ModelPreview.tsx`, `features/visualizer/VisualizerScene.tsx` |
| `@react-three/fiber` | **USED** | Widespread: `Visualizer.tsx`, `ModelPreview.tsx`, `VisualizationFX.tsx`, `audioHooks.ts`, `LrcVizController.tsx`, `viz-styles/*` |
| `@tailwindcss/vite` | **USED** | `vite.config.ts` |
| `@theatre/core` | **USED** | `features/visualizer/services/theatreStudio.ts`, `components/AnimationDemo.tsx`, `components/TheatreStudioPanel.tsx`, `features/visualizer/visualPresets.ts` |
| `@theatre/studio` | **USED** | Same files as above (dynamic `import("@theatre/studio")`) |
| `animejs` | **USED** | `features/visualizer/components/AnimationDemo.tsx`, `components/KineticLyricOverlay.tsx`, `components/KineticPresets.ts` |
| `lucide-react` | **USED** | ~60 files across features |
| `react` | **USED** | `main.tsx`, `App.tsx` |
| `react-dom` | **USED** | `main.tsx` |
| `react-router-dom` | **USED** | `App.tsx`, `Sidebar.tsx`, `features/*/Page.tsx` |
| `recharts` | **USED** | `features/audio-analysis/AudioAnalysisPage.tsx`, `features/gpu/GpuMonitorPage.tsx`, `features/log-analytics/LogAnalytics.tsx`, `features/health/PerformanceHistoryCard.tsx` |
| `three` | **USED** | Widespread in visualizer, three-js-studio, generate3d |
| `zustand` | **USED** | `state/uiStore.ts`, `state/jobStore.ts`, `state/healthStore.ts`, `state/gpuStore.ts`, `state/outputStore.ts` |

| DevDependency | Status | Evidence |
|---------------|--------|----------|
| `@eslint/js` | **USED** | `eslint.config.js` |
| `@playwright/test` | **USED** | `package.json` scripts |
| `@types/node` | **USED** | Standard TS typings |
| `@types/react` | **USED** | Standard TS typings |
| `@types/react-dom` | **USED** | Standard TS typings |
| `@types/three` | **USED** | Standard TS typings |
| `@vitejs/plugin-react` | **USED** | `vite.config.ts` |
| `autoprefixer` | **USED (implicit)** | Required by PostCSS / Tailwind v4 build pipeline; not directly imported in TS but needed by `vite build`. |
| `eslint` | **USED** | `package.json` scripts, `eslint.config.js` |
| `playwright` | **USED** | `package.json` scripts |
| `postcss` | **USED (implicit)** | Required by Tailwind v4 / Vite CSS pipeline. |
| `rollup-plugin-visualizer` | **USED** | `vite.config.ts` + `build:analyze` script |
| `tailwindcss` | **USED** | `vite.config.ts`, `src/styles/globals.css` |
| `typescript` | **USED** | `tsc -b` build step |
| `typescript-eslint` | **USED** | `eslint.config.js` |
| `vite` | **USED** | `package.json` scripts, `vite.config.ts` |
| `vite-plugin-compression` | **USED** | `vite.config.ts` |

### B.3 `packages/video-editor/package.json`

| Dependency | Status | Evidence |
|------------|--------|----------|
| `@react-three/drei` | **VESTIGIAL** | **Zero import hits** in `packages/video-editor/src/`. Only `three` and `@remotion/three` are used. |
| `@react-three/fiber` | **VESTIGIAL** | **Zero import hits** in `packages/video-editor/src/`. |
| `@remotion/captions` | **USED** | `src/components/index.tsx` |
| `@remotion/cli` | **USED** | `package.json` scripts (`remotion studio`, `remotion bundle`) |
| `@remotion/effects` | **USED** | `src/Composition.tsx` |
| `@remotion/media` | **USED** | `src/Composition.tsx` |
| `@remotion/media-utils` | **USED** | `src/StillIRise.tsx`, `src/TakeTheCrown.tsx`, `src/SiliconDreamsPreview.tsx`, `src/components/index.tsx`, `src/components/AudioReactiveVisualizer.tsx` |
| `@remotion/noise` | **USED** | `src/Composition.tsx` |
| `@remotion/shapes` | **USED** | `src/Composition.tsx` |
| `@remotion/tailwind-v4` | **USED** | `src/Composition.tsx` (Tailwind in Remotion) |
| `@remotion/three` | **USED** | `src/StillIRise.tsx`, `src/TakeTheCrown.tsx`, `src/Composition.tsx` |
| `@remotion/transitions` | **USED** | `src/Composition.tsx` |
| `react` | **USED** | `src/Root.tsx`, `src/index.ts` |
| `react-dom` | **USED** | `src/Root.tsx`, `src/index.ts` |
| `remotion` | **USED** | `src/Root.tsx`, `src/index.ts`, all compositions |
| `tailwindcss` | **USED** | `src/Composition.tsx` |
| `three` | **USED** | `src/StillIRise.tsx`, `src/TakeTheCrown.tsx`, `src/Composition.tsx` |

| DevDependency | Status | Evidence |
|---------------|--------|----------|
| `@remotion/eslint-config-flat` | **USED** | `package.json` `lint` script |
| `@types/react` | **USED** | Standard typings |
| `@types/three` | **USED** | Standard typings |
| `@types/web` | **USED** | Standard typings |
| `eslint` | **USED** | `package.json` `lint` script |
| `prettier` | **USED** | `package.json` (implicit via team workflow) |
| `typescript` | **USED** | `tsc` in `lint` script |

### B.4 `tools/package.json`

| Dependency | Status | Evidence |
|------------|--------|----------|
| `@modelcontextprotocol/server` | **USED** | `tools/mcp/*.mjs` |
| `zod` | **USED** | `tools/mcp/unity-mcp-bridge.mjs` |

---

## Section C: Dead / Underutilized Files

### C.1 Python — Backend Runtime (`packages/backend/app/`)

| File | Confidence | Rationale |
|------|------------|-----------|
| `services/audio_analysis_agent.py` | **HIGH** | Never imported by any module in `packages/backend/app/`. Only referenced in docstrings/comments. |
| `services/structure_analysis.py` | **HIGH** | In `services/__init__.py` but **never imported** by `queue/processor.py` or any API router. No route calls it. |
| `services/audio_fingerprinting.py` | **HIGH** | In `services/__init__.py` but **never imported** by `queue/processor.py` or any API router. |
| `services/blender/builder.py` | **MEDIUM** | Not imported by any backend API or processor. Only used in `tools/demos/demo_all_features.py` (demo script). |
| `services/blender/lyrics_sync.py` | **MEDIUM** | Same as above. Only used in `tools/demos/demo_all_features.py`. |
| `services/coding_benchmark.py` | **MEDIUM** | Only lazily imported in `api/integrations_generation.py` for benchmark endpoints. |
| `services/ollama_benchmark.py` | **MEDIUM** | Only lazily imported in `api/integrations_generation.py` for benchmark endpoints. |

### C.2 Python — Tools / Scripts

| File | Confidence | Rationale |
|------|------------|-----------|
| `tools/demos/demo_all_features.py` | **LOW** | Imports backend services directly; may be a manual-run integration test. Not dead, but not part of CI. |
| `tools/demos/demo_audio_analysis.py` | **LOW** | Same — manual demo. |
| `tools/demos/compose_mv.py` | **LOW** | Manual FFmpeg composition script. |
| `tools/tests/vision_analyze.py` | **LOW** | Test helper; referenced in docs/AGENTS.md vision workflow. |

### C.3 TypeScript / JavaScript

| File | Confidence | Rationale |
|------|------------|-----------|
| `packages/video-editor/src/three-types.d.ts` | **LOW** | Actually used (`/// <reference types="@react-three/fiber" />`). Not dead. |
| Frontend `features/visualizer/components/*` | **LOW** | All imported by `Visualizer.tsx` or sibling components. Not dead. |
| `packages/frontend/src/features/docs/DocsPage.tsx` | **LOW** | Imported by `App.tsx` router. |
| `packages/frontend/src/features/art-direction/ArtDirection.tsx` | **LOW** | Imported by `App.tsx` router. |

**No high-confidence dead TS/JS files were found.** All declared frontend routes and video-editor compositions are wired.

---

## Section D: Wiring Map — Optional Deps → API Routes / Features

| Optional Dep | Install Location | Wiring Point | Route / Feature | Confidence |
|--------------|------------------|--------------|-----------------|------------|
| `madmom-infer` | `requirements-experimental.txt` | `app/services/audio_analyzer.py` (try/except import) | `POST /api/audio/analyze` + `POST /api/audio/analyze-all` (backend query param `backend=madmom`) | **HIGH** |
| `sonara` | `requirements-experimental.txt` | `app/services/audio_analyzer.py` (try/except import) | Same audio routes; default backend if installed. | **HIGH** |
| `librosa` | `requirements.txt` | `app/services/audio_analyzer.py` (try/except import) | Fallback for all audio analysis routes. | **HIGH** |
| `faster-whisper` | `requirements-experimental.txt` | `app/services/transcription.py` (lazy import inside `get_model()`) | `POST /api/audio/transcribe`, `GET /api/audio/transcript/*` | **HIGH** |
| `demucs` | `requirements-experimental.txt` | `app/services/source_separation.py` (subprocess CLI) | `POST /api/audio/separate`, `GET /api/audio/stems/{filename}` | **HIGH** |
| `spleeter` | `requirements-experimental.txt` (implied) | `app/services/source_separation.py` (subprocess CLI fallback) | Same `/separate` endpoint (fallback if demucs missing) | **HIGH** |
| `cuda` (torch + cudarc) | `requirements-torch.txt` | `app/services/audio_analyzer.py::analyze_with_cuda()` (lazy import `.cuda` submodule) | `POST /api/audio/analyze-cuda` | **HIGH** (runtime check; fails gracefully if CUDA absent) |
| `mido` | `requirements.txt` (backend) + `tools/pyproject.toml` | **NOT wired to backend API**. Only in `tools/batch_process.py` and `tools/audio_export.py`. | CLI tools only. | **HIGH** |
| `python-osc` | `requirements.txt` (backend) + `tools/pyproject.toml` | **NOT wired to backend API**. Only in `tools/audio_export.py`. | CLI tools only. | **HIGH** |
| `mcp` (Python SDK) | `tools/pyproject.toml [test]` | **NOT wired to backend API**. Only in `tools/tests/test_mcp.py` and `test_mcp_stdio.py`. | Test scripts only. | **HIGH** |
| `gpustat` / `nvidia-ml-py` | `requirements.txt` | `app/diagnostics/resources.py`, `app/services/vram_manager.py` | VRAM monitoring in health/resource endpoints. | **HIGH** |
| `core-flux` / `MovieLite` | `requirements-experimental.txt` | **NOT wired to backend API**. Only in `scripts/benchmark_video_tools.py`. | Benchmark script only. | **HIGH** |
| `kaolin` / `gsplat` | `requirements-experimental.txt` | **Zero references** in code. | None. | **HIGH** |

### D.1 Feature Flags / Runtime Toggles

- **Audio backend selector**: `GET /api/audio/backends` returns available backends based on `SONARA_AVAILABLE`, `MADMOM_AVAILABLE`, `LIBROSA_AVAILABLE`. The default is `sonara` if installed, else `librosa`. This is wired at the **API layer** (`app/api/audio.py`), not a compile-time feature flag.
- **Whisper transcription**: Entirely lazy — `faster-whisper` is imported inside `get_model()` only when `POST /transcribe` is called. No startup penalty.
- **Source separation**: `SourceSeparator.is_available()` probes `demucs` and `spleeter` executables via `subprocess.run([..., "--help"])`. The API endpoint returns an error string if neither is present.
- **CUDA audio**: `analyze_with_cuda()` tries `from .cuda import cuda_audio`; falls back to CPU `librosa` on any exception.

---

## Section E: System Binary Inventory vs `docs/SYSTEM_REQUIREMENTS.md`

### E.1 Binaries Referenced in Code

| Binary | How Found | Purpose | In Docs? |
|--------|-----------|---------|----------|
| `ffmpeg` / `ffprobe` | `shutil.which("ffmpeg")` in `app/api/outputs.py` | Cover art extraction, video rendering, format probing | ✅ Yes |
| `git` | `subprocess.run(["git", ...])` in `app/services/comfyui_manager.py` | ComfyUI self-update (`git pull`) | ✅ Yes |
| `blender` | `shutil.which("blender")` in `app/api/native_open.py`, `subprocess.run([blender, ...])` in `app/services/gen3d/gen3d_service.py` | 3D scene generation, GLB conversion, thumbnail rendering | ✅ Yes |
| `fpcalc` (Chromaprint) | `subprocess.run(["fpcalc", ...])` in `app/services/audio_fingerprinting.py` | Audio fingerprinting / AcoustID lookup | ✅ Yes |
| `demucs` | `subprocess.run(["demucs", ...])` in `app/services/source_separation.py` | Audio source separation | ✅ Yes |
| `spleeter` | `subprocess.run(["spleeter", ...])` in `app/services/source_separation.py` | Audio source separation (fallback) | ✅ Yes |
| `python.exe` | `subprocess.run([python_exe, ...])` in `app/services/comfyui_manager.py`, `app/core/port_manager.py` | Spawning ComfyUI, port pre-checks | ❌ **Missing** — only documented implicitly via venv paths. |
| `node.exe` | Referenced in PowerShell scripts (`scripts/*.ps1`) | Frontend / Vite dev server | ❌ **Missing** — not listed as a system binary. |
| `ollama` | HTTP calls to `127.0.0.1:11434` (no subprocess spawn) | Vision / text generation | ✅ Yes (as external service) |
| `ComfyUI` | HTTP calls to `127.0.0.1:8188` (no subprocess spawn in normal operation) | Image/video generation | ✅ Yes (as external service) |
| `Unity Editor` | HTTP to `127.0.0.1:7800` + file copy to `unity-project-mcp/` | 3D scene import | ✅ Yes (as external service) |

### E.2 Gaps / Stale Docs

- `docs/SYSTEM_REQUIREMENTS.md` does **not** mention `python.exe` or `node.exe` as required system binaries, even though the backend explicitly spawns `python.exe` (ComfyUI manager) and the frontend requires Node 22+.
- The doc lists `spleeter` as optional, which is accurate, but does not note that `spleeter` is only invoked as a **fallback** when `demucs` is missing.

---

## Section F: Conservative Recommendations (Prioritized by Risk / Cost)

### F.1 High-Confidence Vestigial Removals (Low Risk)

These are declared but have **zero runtime import hits** in active backend/app code. Removing them will not break any wired feature.

| Dep / File | Action | Rationale |
|------------|--------|-----------|
| `python-socketio` in `requirements.txt` | **Remove** | Zero imports anywhere in backend or tools. FastAPI + SSE replaced the old Socket.IO path. |
| `python-dotenv` in `requirements.txt` | **Remove** | Zero `dotenv` / `load_dotenv` calls anywhere. Environment is managed by `pydantic-settings` + `config/ports.json`. |
| `mido` in `packages/backend/requirements.txt` | **Remove** | Backend never imports it. Keep only in `tools/pyproject.toml [audio,midi]`. |
| `python-osc` in `packages/backend/requirements.txt` | **Remove** | Backend never imports it. Keep only in `tools/pyproject.toml [audio,osc]`. |
| `core-flux` in `requirements-experimental.txt` | **Remove** | Only referenced in a benchmark script. |
| `MovieLite` in `requirements-experimental.txt` | **Remove** | Only referenced in a benchmark script. |
| `kaolin` in `requirements-experimental.txt` | **Remove** | Zero references anywhere. |
| `gsplat` in `requirements-experimental.txt` | **Remove** | Zero references anywhere. |
| `@react-three/drei` in `packages/video-editor/package.json` | **Remove** | Zero imports in `packages/video-editor/src/`. |
| `@react-three/fiber` in `packages/video-editor/package.json` | **Remove** | Zero imports in `packages/video-editor/src/`. |
| `turbo` in root `devDependencies` | **Remove** | `turbo.json` exists, but no script invokes `turbo`. Build is driven by `pnpm -r build`. |
| `packages/backend/app/services/audio_analysis_agent.py` | **Delete** | Never imported by backend runtime. Dead module. |
| `packages/backend/app/services/structure_analysis.py` | **Delete** (or move to `tools/`) | Never wired to queue or API. Dead in backend. |
| `packages/backend/app/services/audio_fingerprinting.py` | **Delete** (or move to `tools/`) | Never wired to queue or API. Dead in backend. |

### F.2 Medium-Confidence Vestigial Removals (Low Risk, Some Context Needed)

| Dep / File | Action | Rationale |
|------------|--------|-----------|
| `packages/backend/app/services/blender/builder.py` | **Move to `tools/` or mark internal** | Only used by `tools/demos/demo_all_features.py`. Not imported by any backend API or queue handler. |
| `packages/backend/app/services/blender/lyrics_sync.py` | **Move to `tools/` or mark internal** | Same as above. |
| `packages/backend/app/services/coding_benchmark.py` | **Move to `tools/scripts/`** | Only used by `api/integrations_generation.py` benchmark endpoints. Not part of core queue. |
| `packages/backend/app/services/ollama_benchmark.py` | **Move to `tools/scripts/`** | Same as above. |
| `torchvision` / `torchaudio` in `requirements-torch.txt` | **Downgrade to “optional” comment** | Not directly imported in backend code. `torch` is the only torch-family package actively used. Keeping them is harmless but adds ~1 GB install weight. |

### F.3 Documentation Fixes (Low Cost, High Value)

| Item | Action |
|------|--------|
| `docs/SYSTEM_REQUIREMENTS.md` | Add `python.exe` (backend venv) and `node.exe` (frontend) to “Required system binaries” or “Runtime environment” section. |
| `docs/SYSTEM_REQUIREMENTS.md` | Clarify that `spleeter` is a **fallback** only (demucs is preferred). |
| `requirements-experimental.txt` | Add a header comment mapping each dep to its API route (e.g., `# → POST /api/audio/separate`). |

### F.4 What NOT to Remove (Even If It Looks Unused)

| Dep / File | Reason |
|------------|--------|
| `librosa` | Core fallback for audio analysis. Even if `sonara` is installed, the code falls back to `librosa` on any failure. |
| `soundfile` | Required by `librosa.load()`. Removing it breaks the fallback path. |
| `numpy` | Used in `cuda/processor.py` and multiple conditional audio paths. |
| `requests` | Used by `audio_analysis_agent.py` (thin REST client to self) and `tools/`. |
| `Pillow` | Used by `cuda/processor.py` for image operations. |
| `websockets` | Required by `uvicorn(ws="websockets")` and FastAPI WS support. |
| `fastapi[standard]` extras | Pull in `python-multipart` and `websockets` transitively; explicit pins are fine. |
| `@theatre/core` / `@theatre/studio` | Used in `theatreStudio.ts`, `AnimationDemo.tsx`, `TheatreStudioPanel.tsx`, `visualPresets.ts`. |
| `animejs` | Used in `AnimationDemo.tsx`, `KineticLyricOverlay.tsx`, `KineticPresets.ts`. |
| `recharts` | Used in 4 frontend feature pages. |
| `turbo` (if monorepo grows) | Only remove if you are certain the team will never adopt Turborepo caching. For now, keep it. |

---

## Appendix: Import Coverage Heatmap (Backend Services)

```
services/__init__.py exports:
  AudioFingerprinter  → imported by: NONE (dead)
  ImageGenerationHandler → imported by: queue/processor.py ✅
  SourceSeparator     → imported by: api/audio.py ✅
  StructureAnalyzer   → imported by: NONE (dead)

queue/processor.py handlers:
  ImageGenerationHandler → JobType.IMAGE_GENERATION ✅
  StoryboardGeneratorHandler → JobType.STORYBOARD_GENERATION ✅
  ComfyUIWorkflowHandler → JobType.COMFYUI_WORKFLOW ✅
  AudioAnalysisHandler → JobType.AUDIO_FEATURE_EXTRACTION ✅
  MusicVideoHandler → JobType.MUSIC_VIDEO ✅
  MusicVideoPreviewHandler → JobType.MUSIC_VIDEO_PREVIEW ✅

Missing from processor (but wired lazily to API):
  audio_analyzer → api/audio.py ✅
  transcription → api/transcription.py ✅
  source_separation → api/audio.py ✅
  comfyui_manager → api/comfyui.py ✅
  vram_manager → main.py, diagnostics, integrations_config ✅
  gen3d_service → health.py, integrations_config, api/outputs ✅
  cuda/processor → audio_analyzer (lazy) ✅
```

---

*Report generated via read-only evidence sweep. No files were modified.*
