# Changelog

All notable changes to the Native Media AI Studio project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed - Final Sweep & Documentation (2026-09-02)
- **Backend**: Fixed missing `import asyncio` in `api/outputs.py` — caused runtime crash in FFmpeg operations
- **Backend**: Removed dead code duplicate in `_scan_with_cache` (unreachable after return)
- **Backend**: Fixed `check_and_prevent_oom` indentation in `vram_manager.py` — was unreachable as a nested function
- **Backend**: Refactored `main.py` to use single `asyncio.run()` with async `main()` function
- **Backend**: Made checkpoint name configurable in `comfyui_manager.py` `generate_video`
- **Frontend**: Enhanced AI code sanitization in ThreeJSStudio — strips setInterval, setTimeout, eval, Function, fetch, localStorage, event listeners
- **Frontend**: Removed global `(window).THREE` exposure — AI code uses parameter instead
- **MCP**: Made checkpoint name configurable in `ollama-tools-mcp.mjs` `generateImage`

### Fixed - Security & Reliability Sweep (2026-09-01)
- **Backend**: Added `threading.Lock` to `_output_cache` in `api/outputs.py` to prevent race conditions
- **Backend**: Fixed TOCTOU race in `queue/manager.py` `cancel_job`/`retry_job` — moved status check inside lock
- **Backend**: Fixed `diagnostics/health.py` — errored adapters now reported as OFFLINE instead of silently disappearing
- **Backend**: Fixed `comfyui_manager.py` crash when detecting external ComfyUI (PID access on `None`)
- **Backend**: Added git dirty-check before `git pull` in `comfyui_manager.py`
- **Backend**: Added WebSocket origin validation in `main.py`
- **Backend**: Fixed `_scan_with_cache` from `async def` → `def` (no await calls)
- **Frontend**: Fixed ThreeJSStudio missing `encodeURIComponent` on audio URL
- **Frontend**: Fixed ThreeJSStudio duplicate IDs using monotonic counter
- **Frontend**: Fixed Visualizer object URL leak after download (revoke after 1s)
- **Frontend**: Added throttled UI updates (~10fps) in Visualizer audio analysis loop
- **Frontend**: Reused `Uint8Array` via `freqArrayRef` instead of per-frame allocation
- **Scripts**: Fixed `manage-servers.ps1` undefined `Write-Warn2` and broken `$svc.Name` references
- **Scripts**: Fixed `manage-servers.ps1` backend Args to use `uvicorn` module
- **Scripts**: Fixed `start-studio.ps1` `return` inside frontend block (exits entire script)
- **Scripts**: Fixed `start-studio.ps1` null reference after failed restart (`$s.Process` guard)
- **MCP**: Fixed `ollama-tools-mcp.mjs` typo "chiral" → "chill"
- **Config**: Fixed `pnpm-workspace.yaml` invalid `pmOnFail` and `allowBuilds` settings
- **Config**: Aligned TypeScript version in `pnpm-workspace.yaml` catalog with `package.json` (^5.9.3)

### Fixed - Bug Sweep & Code Quality (2026-09-01)
- **Backend**: Removed duplicate `adapter_registry` import in `main.py` shutdown handler
- **Backend**: Replaced deprecated `asyncio.get_event_loop().time()` with `time.monotonic()` in `vram_manager.py` (removed in Python 3.10+)
- **Backend**: Fixed `save_config()` Path serialization — added `default=str` to `json.dump` so `Path` objects serialize correctly
- **Backend**: Removed debug `print`/`logger.info` statements from `music_video_handler.py`
- **Backend**: Removed dead code (unused `all()` expression) in `diagnostics/health.py`
- **Backend**: Removed dead `_save_jobs` method from `queue/manager.py`
- **Backend**: Fixed `dict[str, any]` type annotation to `dict[str, Any]` in `api/outputs.py`
- **Backend**: Fixed `request.name` reference in `api/jobs.py` (field doesn't exist in `JobCreateRequest`)
- **Frontend**: Removed debug `console.log` statements from `Visualizer.tsx`
- **Frontend**: Added cleanup effect for object URL, AudioContext, and MediaRecorder in `Visualizer.tsx` (memory leak fix)
- **Frontend**: Removed fragile module-level `console.warn`/`console.error` overrides from `Visualizer.tsx` and `main.tsx`
- **Frontend**: Fixed suspicious TypeScript package names in `package.json` (`@typescript/native`, `@typescript/typescript6` removed)
- **Config**: Updated `shared/types.ts` `PortConfig` interface to match actual `ports.json` structure
- **Config**: Standardized `localhost` → `127.0.0.1` in `config/ports.json`
- **Config**: Removed hardcoded Windows path from `config/settings.json` (uses default from `config.py`)
- **Tooling**: Added `@eslint/js` + `typescript-eslint` recommended rules to `eslint.config.js`
- **Tooling**: Fixed invalid `--ws websockets-sansio` → `--ws websockets` in `start-backend.ps1`

### Fixed - Server Startup & Monitoring (2026-08-31)
- **Startup Script** (`scripts/start-studio.ps1`): Fixed log overwrite on restart (now appends), added exponential backoff (1s/2s/4s) for crashed services, added process validation after start, added crash diagnostics showing last 10 lines of error log, added VideoEditor to auto-restart switch
- **Unity MCP Bridge** (`tools/mcp/unity-mcp-bridge.mjs`): Fixed wrong default project path — was resolving to `tools/unity-project-mcp` instead of repo-root `unity-project-mcp`
- **File Organization**: Moved 30+ loose files into structured directories (`tools/mcp/`, `tools/demos/`, `tools/tests/`, `tools/output/`, `scripts/utility/`, `docs/scratch/`), updated all 64 broken path references across 15+ files

### Fixed - Frontend Stability & Performance (2026-08-31)
- **Error Boundaries**: Added reusable `ErrorBoundary` component, wrapped all 20 routes to prevent single-component crashes from killing the page
- **Memory Leaks**: Fixed ThreeJSStudio resize listener never being removed (cleanup referenced wrong function), fixed healthStore SSE double-subscription leak
- **Performance**: Throttled ThreeJSStudio `animationTime` state updates from 60fps to ~10fps, added `React.memo` to Visualizer sub-components (StylePicker, SpectrumBar), added ref-counted polling to gpuStore
- **Audio**: Added guard against `createMediaElementSource` double-connection crash in ThreeJSStudio
- **Accessibility**: Added `aria-label` to all 8 icon buttons in Visualizer, added keyboard support (Enter/Space) and `role="button"` to Dashboard drop zone
- **Code Quality**: Extracted duplicated `formatElapsed` function to shared `utils/format.ts`, created reusable `usePolling` hook

### Fixed - Visualizer Page (2026-08-31)
- Fixed CSS class mismatch in loading indicator (`.viz-loading` → `.viz-loading-overlay`)
- Added AnimationDemo toggle button to topbar (was unreachable)
- Fixed SVG demo button active state
- Added `sceneFrozen` support to AuroraRibbon and OceanWaves visualizations
- Unified color scheme from blue (#007AFF) to indigo (#6366f1)
- Enhanced all 13 visualizations with better colors, materials, and effects (more particles, higher segment counts, glow shells)

### Fixed - Confidence Score (2026-08-25)
- **Backend**: `audio_analyzer.py:224` windowed onset (`p85`, `±1` frame) + beat regularity (`CV`) + dynamic range → `0.28` → `0.85` on `182s 143BPM` (was `mean(onset/max)`, now `0.55*onset + 0.30*regularity + 0.15*dynamic` + `sqrt` boost)
- **Verified**: `5` library files now `0.86-0.88` (was `0.27-0.35`), `POST /api/audio/analyze` `0.851`

### Fixed - Video Rendering & Queue Preview (2026-08-25)
- **Backend**: `music_video_handler.py:231` `showspectrum … scale=log:rate=30` → `Option not found` (was `772MB` bloat + `timeout`); fixed `scale=log[vid]`, `preset ultrafast` → `crf 23 preset fast maxrate 8M`
- **Frontend**: `QueueList.tsx:109` now renders `<video controls preload=metadata>` via `/output/video/{filename}` + `Download`/`Open` (was text only, `output_path` ignored `result.output_path`)
- **Verified**: `hasVideo true`, `GET /output/video/281baf85_music_video.mp4` `200 video/mp4`

### Fixed - Generate-3D Page UX (2026-08-25)
- **Backend**: `gen3d/service.py:24` `..core.config` → `...core.config` (`500` → `200` `{"available":true,"comfyui_running":true}`)
- **Frontend**: auto-load `status`/`history` on mount, `elapsed` timer, word-count validation (`75` words, `500` chars)
- **Model cards**: `VRAM`/`time` badges (`5GB 2-3min 8GB-safe` vs `9GB+ 6-8min`), selected `border-violet`, `steps` slider `5-50` with `fast/balanced/quality` + `~min` estimate
- **Generate**: `elapsed/~est` + progress bar + `VRAM offload` note, catches `timeout`/`VRAM` → friendly `Retry`/`Dismiss`
- **Result**: `model_path` filename + full path, `Download .glb` via `/output/generated_3d/{file}`, `Use in Music Video`, collapsible `Raw JSON`
- **Sidebar**: live `● Ready`/`Offline` badge, formatted status, `Recent Models` list (`.glb` from `/api/outputs`)

### Fixed - Queue Progress Bar (2026-08-25)
- **Backend**: `music_video_handler.py:316` stream `stderr` via `read(1024)` split on `[\r\n]` for `frame=`/`time=` → `update_job(0.5→1.0, "Rendering frame X/Y (Z%)")`
- **Was**: `communicate()` until FFmpeg exit → `50%` stuck until `100%`; now `50%` → `85% 125/180` → `97% 170/180` → `100%`

### Fixed - Video Rendering Efficient (2026-08-25)
- **Backend**: `crf 23 preset fast maxrate 8M` (was `ultrafast` → `772MB` for `4:24`), add `-t duration` (was full `4:24` for every `5s` → `timeout 60s`)
- **Abstract**: `PALETTES` by `section`/`energy` (`chorus #ff0055|#ffaa00`, `verse`, `bridge`) + `contrast/saturation` driven by `energy_curve`
- **Verified**: `5s 1080p` now `3.16MB 5.00s` (was `20MB` partial, `50MB` minimal, `772MB` bloated)

### Fixed - Audio Analysis & GPU Health (2026-08-25)

#### CUDA Toolkit 12.4 + Nsight Research
- **Research**: Evaluated `https://docs.nvidia.com/cuda/cuda-programming-guide/index.html` (v13.3) for `CUDA 12.4` / `GTX 1070 Ti sm_61` / `torch 2.6.0+cu124` — pinned archive `12.4.0`, documented useful sections (`2.5 Async`, `4.2 Graphs`, `4.3 Stream Alloc`) vs `sm_80+` skip-list
- **Added**: `docs/knowledge-library/technical-reference.md` — `CUDA Toolkit & Programming Guide — 2026-08-25 Research` with Nsight `2026.1.3` install paths, WDDM caveats, `torch.profiler` fallback (451 ms CUDA captured where `nsys` returned 0.05 MB empty)
- **Perf**: `app/services/cuda/processor.py` — cached `hann_window` + `rfftfreq` (saves 32 ms), fused `abs().square()` (127 ms → 89 ms), `CudaVisualizationFFT` same cache; `tools/analyze_and_sync.py` — `torch.cuda.Stream()` overlap CPU `beat_track` (24.0 s → 14.7 s, -39% on 182 s track)

#### GPU Health Fallback (WDDM GeForce fix)
- **Fixed**: `GET /api/health/gpu` returned `{"available":false}` on `System Python311` where `pynvml` hardcodes `NVSMI/nvml.dll` (missing, only `System32` exists) — patched `pynvml.py` + added `torch.cuda` fallback in `app/diagnostics/resources.py:541` and `app/services/vram_manager.py:109` (`mem_get_info`, `get_device_properties`, `fallback: torch.cuda` flag)
- **Fixed**: `GET /api/integrations/cuda/status` 404 from frontend — `api.ts:607` used `/api/health/integrations/cuda/status`; corrected to `/api/integrations/cuda/status` with legacy fallback, banner now shows `CUDA Available` + VRAM badge

#### Audio Analysis UX
- **Upload**: `validateFile` (MP3/WAV/FLAC/OGG/M4A, 500 MB), inline `fileError`, `audio` preview via `URL.createObjectURL`, `Clear` button, drag `border-dashed` states, `role=button` + `Enter`
- **CUDA banner**: always visible `role=status` — green `CUDA Available` / amber `CPU Mode`, VRAM `used/total %` badge, `fallback` badge, `GPU on/off` toggle with `aria-label`
- **Progress**: `aria-live`, `aria-busy`, dismissible error, `10–30 s` hint
- **Charts**: Energy beats sampled to ≤80 `ReferenceLine`s (was 400+ clutter), section bars with `title`/`aria-label`, helper text
- **Sections**: `Select all`, `role=list`, per-checkbox `aria-label`, helper `Tap single Play vs Generate Selected`
- **Library**: computed `filtered/sorted/paged`, `No files match + Clear filter`, `N files` count, fixed `filtered.length` pagination, updated Tips

#### Backend Integration Fix
- **Fixed**: `app/api/integrations_generation.py:74` `NameError: ImageGenerationRequest/VideoGenerationRequest not defined` — defined both `BaseModel`s locally, cleared `__pycache__`, backend now starts via `venv` `uvicorn` (`PID 23524` `available:true 3782/8192 MB`)

### Fixed - Health Page Layout
- **Fixed**: GPU card orphaned in 3-column grid — changed to 2-column layout (CPU+Memory, Disk+GPU)
- **Fixed**: ComfyUI card was heavy full-width before resource metrics — moved to sidebar column
- **Fixed**: Service Checks crammed into 1/3 width — merged into equal 2-column layout with Performance History
- **Fixed**: Action Log conditionally hidden — now always visible with empty state
- **Fixed**: Page title "Diagnostics" didn't match sidebar "Health" — renamed to "System Health"
- **Added**: Reusable `ResourceCard` component for CPU/Memory/Disk

### Added - Per-Process GPU Memory Monitoring
- **Added**: `/api/health/gpu/processes` endpoint using Windows Performance Counters (`win32pdh`) for per-process VRAM tracking
- Works on WDDM (GeForce) without admin privileges — replaces NVML-only approach that returned `N/A` on GTX 1070 Ti
- Human-readable format: process names resolved from PIDs, memory in MB/GB, sorted by usage
- Frontend GPU card now shows top 8 processes by VRAM usage

### Fixed - Vision Analysis Infrastructure
- **Fixed**: `vision-mcp_vision_mcp` tool fails with large images — created `tools/mcp/vision.mjs` standalone analyzer using sharp for resizing
- **Added**: `tools/mcp/vision.mjs` with `analyze`, `compare`, `diff` commands using sharp + Ollama gemma4:e2b-it-qat
- **Added**: `vision-page-analysis` skill in `.kilo/skills/` for screenshot-to-analysis workflow
- **Fixed**: npm arborist bug (`Cannot read properties of null`) blocking pnpm installs — updated npm to v12.0.3+

### Fixed - AI Tools Page Bug Fixes & Improvements

#### Critical: SSE Stream Parsing
- **Fixed**: `parseOllamaStream()` in `services/api.ts` — `event:` and `data:` lines are separate in SSE format but parser tried to extract event from the data line; stream was completely non-functional
- **Fixed**: Visualization tool calls never triggered during streaming — `td.result` was never populated; now extracts config directly from tool call arguments
- **Fixed**: `done` event overwrote accumulated `fullResponse` with only the last turn's text, losing prior turns

#### Generation Control
- **Added**: Cancel button with `AbortController` support — users can now stop ongoing generation
- **Added**: `ollamaChatStream()` accepts `AbortSignal` parameter for proper request cancellation
- **Fixed**: `vizConfig` not cleared on new generation — stale visualizations persisted

#### Tool Editor
- **Added**: JSON validation with visual feedback — red border + "Invalid JSON" message
- **Added**: Save button disabled when JSON is invalid or tool name is empty

#### Files Changed
| Action | File |
|--------|------|
| Modified | `packages/frontend/src/services/api.ts` |
| Modified | `packages/frontend/src/features/ai-tools/AIToolsPage.tsx` |

### Added - Comprehensive Backend Logging

- **Dedicated Ollama log**: `logs/ollama.log` for Ollama adapter requests/responses
- **SSE logging**: Connection/disconnect/broadcast events
- **Health monitor logging**: Health check results with adapter status
- **API endpoint logging**: Jobs, Video, Audio API request tracking
- **Structured format**: Timestamp, level, module, function, message
- **Log rotation**: 10MB per file, 5 backups

**Log Files:**
| File | Contents |
|------|----------|
| `app.log` | All application logs |
| `error.log` | Errors only with tracebacks |
| `ollama.log` | Ollama chat requests/streams/errors |
| `queue.log` | Queue processor events |
| `comfyui.log` | ComfyUI adapter events |

### Fixed - ComfyUI Update & Git Integration

- Fixed ComfyUI update endpoint not working with uvicorn --reload
- Added robust git detection with fallback paths for Windows
- Added detailed error logging with tracebacks for debugging
- Fixed subprocess PATH issues for git execution
- Update action now shows real-time progress in Action Log

### Added - VRAM Management System

- **VRAM Manager**: Coordinates GPU memory between Ollama and ComfyUI
- **Automatic Ollama Offload**: Unloads Ollama models when 3D generation starts
- **Automatic Ollama Reload**: Reloads Ollama models when 3D generation completes
- **OOM Prevention**: Emergency offload when VRAM exceeds critical threshold (92%)
- **API Endpoints**:
  - `GET /api/integrations/vram/status` - Current VRAM status
  - `POST /api/integrations/vram/offload-ollama` - Manual offload
  - `POST /api/integrations/vram/reload-ollama` - Manual reload
- **Thresholds** (for GTX 1070 Ti 8GB):
  - Warning: 85% VRAM usage
  - Critical: 92% VRAM usage
  - Minimum for 3D: 4GB free VRAM

### Added - Ollama Tool Calling & Agent Loop

#### Backend
- **New API endpoint**: `POST /api/integrations/ollama/chat` — Chat with tool calling and agent loop
- **Agent loop pattern**: Automatic tool execution up to `max_tool_calls` iterations
- **Built-in tools**: `get_project_structure`, `search_docs`, `get_system_health`, `list_jobs`, `get_job_status`
- **Streaming support**: SSE streaming with tool call handling
- **Tool details response**: Returns `tool_details` array with name, arguments, and result for each tool call

#### Frontend
- **Updated AI Tools Page**: Connection status, tool registry, tool call display
- **New API functions**: `ollamaChat()`, `ollamaChatStream()`, `parseOllamaStream()`
- **Tool definition types**: `ToolDefinition`, `ChatMessage` interfaces

#### Files Changed
| Action | File |
|--------|------|
| Modified | `packages/backend/app/adapters/ollama.py` |
| Modified | `packages/backend/app/api/integrations.py` |
| Modified | `packages/frontend/src/features/ai-tools/AIToolsPage.tsx` |
| Modified | `packages/frontend/src/services/api.ts` |

### Changed - WebSocket Replaced with SSE (Server-Sent Events)

#### Why SSE over WebSocket
- **Automatic reconnection** — Browser's EventSource API handles reconnection natively; no custom reconnect logic needed
- **Event resumption** — `Last-Event-ID` header automatically replays missed events after reconnection
- **Proxy/firewall friendly** — SSE uses plain HTTP, works through any proxy without special configuration
- **Simpler implementation** — No heartbeats, no sticky sessions, no pub/sub backplane required
- **Vite 8.x compatible** — Eliminates WebSocket proxy bugs present in Vite 8.2.2

#### Backend Changes
- **New SSE endpoint**: `GET /api/events` — streams health updates, job progress, and resource warnings
- **New module**: `packages/backend/app/sse/handler.py` — `SSEManager` class manages client queues
- **Dependency added**: `sse-starlette>=2.0.0` for SSE response handling
- **Removed**: WebSocket endpoint (`/ws`), `websocket/handler.py` `ConnectionManager`, WebSocket-specific imports
- **Updated**: `health_broadcast_loop()` and `resource_monitoring_loop()` now use `sse_manager`

#### Frontend Changes
- **New service**: `packages/frontend/src/services/sseService.ts` — `SSEService` class using native `EventSource` API
- **Removed**: `socketManager.ts`, `createWebSocket()`, `getWebSocketUrl()`
- **Updated stores**:
  - `healthStore.ts` — `wsConnected` → `sseConnected`, `connectWebSocket` → `connectSSE`, `disconnectWebSocket` → `disconnectSSE`
  - `jobStore.ts` — Same naming updates, SSE-based real-time updates
- **Updated components**:
  - `Sidebar.tsx` — Uses SSE for health monitoring
  - `Queue.tsx` — Uses SSE for job progress updates
- **Updated hooks**: `useWebSocket` → `useSSE` in `hooks/index.ts`
- **Removed**: All WebSocket-related code and dependencies

#### Files Changed
| Action | File |
|--------|------|
| Added | `packages/backend/app/sse/__init__.py` |
| Added | `packages/backend/app/sse/handler.py` |
| Added | `packages/frontend/src/services/sseService.ts` |
| Modified | `packages/backend/app/main.py` |
| Modified | `packages/backend/app/diagnostics/resources.py` |
| Modified | `packages/backend/app/queue/manager.py` |
| Modified | `packages/backend/app/queue/processor.py` |
| Modified | `packages/backend/app/api/jobs.py` |
| Modified | `packages/backend/requirements.txt` |
| Modified | `packages/frontend/src/state/healthStore.ts` |
| Modified | `packages/frontend/src/state/jobStore.ts` |
| Modified | `packages/frontend/src/components/layout/Sidebar.tsx` |
| Modified | `packages/frontend/src/features/queue/Queue.tsx` |
| Modified | `packages/frontend/src/services/api.ts` |
| Modified | `packages/frontend/src/services/portConfig.ts` |
| Modified | `packages/frontend/src/hooks/useWebSocket.ts` |
| Modified | `packages/frontend/src/hooks/index.ts` |
| Deleted | `packages/frontend/src/services/socketManager.ts` |

#### New Vault Files (docs/knowledge-library/)
- **`codebase.json`** — Machine-readable project structure: packages, tools, config, data flow pipelines. Maps every key file to its purpose so agents can navigate without reading source.
- **`api-registry.json`** — Complete API endpoint registry: 50+ endpoints across 10 routers with full request/response schemas, Pydantic model fields, query parameters, and content types.
- **`mcp-registry.json`** — MCP server tool inventories: 4 servers (Unity, Blender, ComfyUI, Remotion) with 80+ tools, parameter schemas, and usage patterns (full pipeline, quick video, 3D render).
- **`agent.manifest.json`** — Updated with references to all new registries and bootstrap endpoint.
- **`prompts.json`** — Genre prompt templates with weighted examples, negative prompts, and render tips.

#### New Backend Endpoints (packages/backend/app/api/docs.py)
- **`GET /api/docs/bootstrap`** — Single-call agent onboarding: returns manifest + codebase + API registry + MCP registry + prompts + vault doc index + quick start steps. One call gives agents everything needed to operate.
- **`GET /api/docs/search?q=<query>`** — Full-text search with relevance scoring: title matches (10pt), tag matches (8pt), path matches (5pt), content matches (3pt + multi-occurrence bonus). Returns ranked results with snippet context.
- **`GET /api/docs/structure?depth=N`** — Project directory tree scoped to key directories (packages, docs, tools, scripts, config). Skips hidden/node_modules/__pycache__/venv.
- **`GET /api/docs/codebase`** — Shortcut: returns codebase.json directly.
- **`GET /api/docs/api-registry`** — Shortcut: returns api-registry.json directly.
- **`GET /api/docs/mcp-registry`** — Shortcut: returns mcp-registry.json directly.

#### Frontend Documentation Page Improvements
- **Server-side search** — Debounced search using `/api/docs/search` with relevance scores displayed next to results.
- **JSON file badges** — Each JSON file type gets a colored badge: Agent Manifest (amber), Prompts (pink), Codebase Map (cyan), API Registry (emerald), MCP Registry (blue).
- **JSON viewer** — Shows top-level key count, file size, and copy-to-clipboard button.
- **Search snippets** — Search results show content snippets for context.

### Added - File Management & Media Library (Audio Covers, Duplicates, Rename)

- **Audio cover extraction** `packages/backend/app/api/outputs.py:93` — FFmpeg `attached pic` probe → `ffmpeg -y -i audio.mp3 -an -vcodec copy -frames:v 1` → `audio/{stem}.jpg` sidecar; `GET /api/outputs` returns `cover_image: "audio/...jpg"` for `audio` type (skip-list prevents `*.jpg` sidecars from appearing as standalone images); grid `MediaLibrary.tsx:375` and list `MediaLibrary.tsx:490` and modal `MediaLibrary.tsx:615` now show cover above `<audio controls autoplay>`
- **Duplicate detection** `GET /api/outputs/duplicates/groups?quick=true` — SHA256(size + first 1MB + tail) groups, `wasted_bytes`, `hash[:16]`; frontend `MediaLibrary.tsx:161` `Find Duplicates` panel with `Keep oldest, delete N` → `POST /api/outputs/bulk-delete`
- **Rename** `POST /api/outputs/{path}/rename {"new_name"}` — renames file + sidecars (`.json`, cover `.jpg`, `.mp3.json`); frontend pencil `MediaLibrary.tsx:125` inline modal + detail modal `Pencil` button; validates no `/` and `len<200`
- **Bulk delete + enhanced delete** — `POST /api/outputs/bulk-delete {"paths":[]}` and `DELETE /api/outputs/{path}` now also removes cover sidecars (`outputs.py:340`); frontend bulk bar `MediaLibrary.tsx:320` with `CheckSquare` selection on grid/list
- **Docs** — `README.md` Features + API Endpoints table updated, `docs/api/API_REFERENCE.md` new Outputs covers/rename/bulk/duplicate sections, new `docs/guides/FILE_MANAGEMENT.md` guide

### Added - Unity MCP Integration

- **Unity MCP Bridge**: `tools/mcp/unity-mcp-bridge.mjs` — local MCP server wrapping Unity REST API
- **Unity MCP Skill**: `.kilo/skills/unity-mcp/SKILL.md` — full documentation for AI-driven Unity workflows
- **Audio-to-Unity Sync**: `tools/analyze_and_sync.py` — analyze audio and generate beat-synced animation data
- **Available Unity tools**: `create_scene`, `create_gameobject`, `add_component`, `capture_scene_view`, `capture_game_view`, `editor_status`, `create_animation_clip`, `create_animator_controller`, `add_animator_state`, `add_animator_transition`, `bake_lighting`, `build`, and 100+ more via `unity_command`
- **Connection**: Unity Editor Pipeline server (port 7800) → MCP Bridge → Kilo Code

### Added - GPU Music Video Pipeline & 3D Generation

- **3D generation service**: `app.services.gen3d` — text-to-3D and image-to-3D via Hunyuan3D-2mini (optimized for 8GB VRAM)
- **Blender scene builder**: `app.services.blender.builder` — generates bpy scripts for stages (concert, abstract, nature, urban, space), characters, cameras, beat-synced animation
- **Lyrics sync mapper**: `app.services.blender.lyrics_sync` — maps timed lyrics to animation events, aligns to beats, supports WhisperX output
- **CUDA audio analysis**: `app.services.cuda.processor` — torch.stft() GPU FFT, spectral features, onset detection; image preprocessing (resize/normalize); visualization FFT
- **Hunyuan3D-2mini model**: Downloaded to `ComfyUI/models/diffusion_models/hunyuan3d-2mini` (~2.5GB)
- **ComfyUI-Hunyuan3DWrapper**: Custom node installed for ComfyUI integration
- **API endpoints**: `/api/health/gpu` (GPU snapshot), `/api/health/3d/status`, `/api/health/3d/generate`
- **Research docs**: `docs/notes/GPU_UTILIZATION_RESEARCH.md` and `docs/notes/3D_MODELS_8GB_VRAM.md`
- **GPU Pipeline Guide**: `docs/guides/GPU_PIPELINE.md` — full documentation for the 3D/GPU workflow

### Changed - Real-Time Communication (SSE replaces WebSocket)

- **Replaced WebSocket with SSE**: Server-Sent Events provide more reliable real-time updates with automatic reconnection and event resumption (see top of changelog for full details)
- **Removed WebSocket dependencies**: `websockets` package no longer required; using `sse-starlette` instead
- **GPU monitoring fix**: VRAM warning no longer falsely reports "critical" when GPU is idle. Now requires high VRAM **AND** high compute utilization (≥70%) **OR** high temperature (≥85°C) for critical level. Added `nvidia-ml-py` dependency for `pynvml`-based GPU stats (utilization + temperature)

### Added - Server Management & Data Persistence (Session 6)

#### Server Management
- **Unified server management**: `manage-servers.ps1` script for start/stop/restart/status of all services
- **ComfyUI integration**: `start-studio.ps1` now manages ComfyUI alongside backend/frontend/video editor
- **ComfyUI start script**: Fixed paths in `start_comfyui.ps1` for ComfyUI location and Python environment
- **NPM scripts**: Added `pnpm start`, `pnpm start:all`, `pnpm servers status` commands

#### Data Persistence
- **Database upgrade**: New tables for tracks, prompts, audio_files, ai_visuals, generation_sessions, user_preferences
- **Track Manager UI**: Table view for pairing prompts and lyrics to tracks with inline editing
- **CSV import**: Import tracks from HappyShrimp CSV with prompts and lyrics
- **Prompt storage**: Save and reuse generation prompts with tags and categories
- **Generation history**: Track AI visual generation parameters and results
- **User preferences**: Key-value store for UI defaults and settings

#### AI Visual Generation
- **ComfyUI service**: Full API client for image generation, model listing, system stats
- **AI Visuals Panel**: UI for generating AI visuals with prompt input and style presets
- **Style previews**: Low-res (256x256) thumbnails for all 8 styles before full generation
- **Music-to-Visual prompt transformer**: Converts music generation prompts (Suno/Udio) to visual prompts
- **Generation estimator**: Frame counts, time, VRAM, and output size estimates for GTX 1070 Ti

#### Audio Visualization
- **AudioReactiveVisualizer**: Real-time audio visualization using Remotion's APIs
- **Multiple styles**: Bars, waveform, circular, particles
- **Color schemes**: Neon, fire, ocean, monochrome
- **Composition upgrade**: Layered rendering with AI visual background + audio visualizer overlay

#### Repository Organization
- **Removed old directories**: Deleted `backend/`, `frontend/` (superseded by `packages/`)
- **Moved media files**: Large video files moved to `output/videos/`, test audio to `tests/audio/`
- **Updated .gitignore**: Added model directories, Happy Shrimp cache, and other clutter
- **Updated README**: Reflects current project structure and features
- **Scripts organization**: Only essential server management scripts tracked in git

### Changed - Codebase Cleanup & Type System Alignment

#### Type System
- **Shared types aligned with backend Pydantic models**:
  - Added missing `MUSIC_VIDEO_PREVIEW` to `JobType` enum in `shared/types.ts`
  - Added `queued` and `retrying` fields to `QueueStats` interface
  - Added `modified_at` and `cover_image` fields to `OutputFile` interface
- **Frontend services refactored to use shared types**:
  - `packages/frontend/src/services/api.ts` now imports `Job` and `QueueStats` from `@shared/types`
  - `packages/frontend/src/state/outputStore.ts` now imports `OutputFile` from `@shared/types`
  - Eliminates duplicate type definitions, ensuring single source of truth

#### Configuration
- **Workspace structure**: Python backend removed from pnpm workspace (it uses pip/conda, not npm)
  - `pnpm-workspace.yaml` now explicitly lists `packages/frontend`, `packages/video-editor`, and `shared`
  - Root `package.json` workspaces updated to match
  - Backend scripts changed from `pnpm --filter=backend` to direct `python` commands
- **Port configuration**: `video_editor_port` changed from `8080` to `3000` in `config/ports.json` to match Remotion default and README
- **Path aliases**: Added `@shared` alias to `tsconfig.json` and `vite.config.ts` for cleaner imports

#### Code Quality
- **Backend logging**: Replaced all `print()` calls with `logger.warning()`/`logger.info()` in:
  - `packages/backend/app/adapters/base.py`
  - `packages/backend/app/core/port_manager.py`
  - `packages/backend/app/services/image_generator.py`
- **Removed dead code**:
  - Removed duplicate `AudioAnalyzerError` class from `audio_analysis_handler.py` (already in `audio_analyzer.py`)
  - Removed redundant WebSocket endpoint from `packages/backend/app/api/jobs.py` (canonical one in `main.py`)
  - Removed unused imports across multiple backend files
  - Removed empty `apps/shared/` directory and `StillIRise.tsx.bak` backup file
- **Import organization**: Moved inline imports to module-level in `outputs.py`, `logs.py`, `integrations.py`, `processor.py`
- **Frontend**: Added missing `lint` and `test` scripts to `packages/frontend/package.json`
- **TypeScript**: Removed unused `useMemo` import from `ArtDirection.tsx`

### Added - Remotion Video Editor Improvements (Session 4)

#### Modular Components
- **Reusable component library** (`src/components/index.ts`):
  - `useAudioAnalysis()` — Hook for real-time audio spectrum/waveform data
  - `LyricDisplay` — Animated lyrics with verse/chorus/bridge styles
  - `AudioWaveform` — SVG waveform visualization
  - `SpectrumBars` — Frequency spectrum bar visualizer
  - `SceneTransition` — Flash/transition effects at specified times
  - `TrackInfo` — Track metadata display with progress bar

#### Template System
- **Template composition** (`src/compositions/Template.tsx`):
  - Configuration-driven approach (edit CONFIG object)
  - Easy lyric timing format
  - Copy-paste starting point for new videos
  - All reusable components wired up

#### Documentation
- **Comprehensive README** (`packages/video-editor/README.md`):
  - Quick start guide
  - Project structure overview
  - Step-by-step video creation workflow
  - All reusable components documented with examples
  - Configuration options reference
  - Rendering and troubleshooting guides

---

### Added - Design System & UX Overhaul (Session 4)

#### CSS & Visual Design
- **Enhanced color palette** — Added accent (pink), cyan, and emerald colors for more vibrant UI
- **Depth & layering** — Cards now have multi-layered shadows, gradient backgrounds, and top highlight lines
- **Micro-animations** — Added 12+ new animations (pulse-glow, shimmer, float, slide-in-up, ripple, etc.)
- **Button enhancements** — Radial gradient hover effects, active scale transforms, disabled state styling
- **Progress bars** — Triple-color gradient with animated stripe overlay and glow effects
- **Focus states** — Double shadow ring on focus, active glow effects
- **Neumorphic effects** — New `.neumorphic` and `.neumorphic-inset` utility classes
- **Status badges** — Color-coded badges with backgrounds for each status type

#### Responsive Design
- **5 breakpoints** — Large desktop (1920+), medium (1400), small (1100), portrait (900), narrow (600)
- **Vertical display support** — Sidebar collapses to horizontal top bar on portrait orientations
- **Adaptive grids** — 4→2→1 column degradation based on screen width
- **Mobile-friendly** — Compact padding, smaller fonts, touch-friendly targets

#### Component Improvements
- **StatusBadge** — Now includes background colors and borders per status type
- **Card** — New `glow` prop for gradient border effect on hover
- **ProgressBar** — New `showPercentage` and `size` props
- **EmptyState** — Animated icon with float effect

#### Beat Detection
- **Real audio analysis** — Replaced placeholder BPM assumption with actual audio energy analysis
- **Multi-band detection** — Analyzes low, mid, and high frequency bands
- **Adaptive thresholding** — Uses local median for dynamic onset detection
- **Tempo estimation** — Histogram-based BPM detection from inter-onset intervals
- **Beat classification** — Downbeats, backbeats, and energy-based intensity classification

#### ComfyUI Integration
- **Process manager** — Start/stop ComfyUI headlessly from the app
- **CUDA detection** — Checks for NVIDIA GPU compatibility before starting
- **Auto-restart** — Stops, updates, and restarts ComfyUI seamlessly
- **API endpoints** — Full REST API for ComfyUI management
- **Health monitoring** — Real-time status with uptime tracking

#### Logging System
- **Centralized logging** — Structured logging to 4 rotating log files
- **Per-module logs** — Separate files for app, errors, queue, and ComfyUI
- **Frontend log viewer** — Tabbed interface with search, filter, and auto-refresh
- **stdout capture** — print() calls are now logged via app.stdout

#### Security
- **Fixed vulnerabilities** — Updated brace-expansion, nanoid, postcss (0 remaining)

---

### Added - Art Direction Page Redesign (Session 3)
- **Live Style Tile** — Top panel shows combined effect of all active modules:
  - Gradient background using selected palette colors
  - Typography preview with selected font style and size
  - Color swatch strip with labeled roles (Primary, Secondary, Accent, Highlight)
  - Motion intensity bar showing animation budget
  - Texture overlay preview (scanlines, grain)
- **Module tooltips** — Info icons with hover explanations for each module:
  - Audio: "Tempo, key, and loudness data that drives visual reactivity"
  - Palette: "Color scheme applied to backgrounds, accents, and overlays"
  - Typography: "Font style, size animation, and text placement rules"
  - Motion: "Animation speed, easing, and transition intensity"
  - etc.
- **Variant previews** — Each expanded module now shows a visual preview:
  - Palette: Color swatches with labeled roles + description
  - Typography: Live text preview with selected font size
  - Texture: Visual texture pattern preview
  - Motion: Animated intensity bar + preview box
  - Layout: Grid structure mockup
  - Storyboard: Sequence list with shot descriptions
- **Progressive disclosure** — Modules collapsed by default, expand for details
- **Collapsible docs** — Documentation viewer hidden behind Docs button
- **Clearer labels** — Variant labels show human-readable names (e.g., "2-Card Layout" instead of "2-card")

---

#### Art Direction Page — Complete Redesign (v1 with Progressive Disclosure)

---

### Added - Page-by-Page UX Audit & Improvements (Session 3)

#### CSS & Component Improvements
- **Card styling** — Added `.card` with shadow, `.metric-card` with hover effects, `.section-header` for consistent section labeling
- **Button hierarchy** — `.btn-primary` now uses gradient + shadow + hover lift; `.btn-ghost` for secondary actions; `.btn-lg` for prominent CTAs
- **EmptyState component** — Enhanced with optional `icon` and `action` (CTA button) props for actionable empty states
- **Grid layouts** — Added `.grid-4` for 4-column layouts with responsive breakpoints

#### Page Improvements

**Dashboard**
- Added Quick Actions grid (Create Music Video, Generate Image, Visualizer, View Queue) with hover animations
- Converted Status Overview cards to centered metric cards with icons and hover effects
- Improved empty states with icons and actionable CTAs ("Generate Your First Image" button)
- Enhanced System Resources with bolder labels and improved progress bars

**Music Video Studio**
- Fixed waveform visualization (normalized amplitude data, added glow effects)
- Fixed AudioContext suspended state (resume on user gesture before play)
- Added ghost-style "Change Audio" button (replaces prominent "Change Audio File")
- Added gradient + shadow to primary "Generate Music Video" button
- Improved Quick Settings with 2x2 grid, uppercase tracking labels, consistent spacing
- Added "Recent Music Video Jobs" panel showing live job status
- Added Session Stats with improved empty state ("No activity yet")
- Fixed FFmpeg rendering (simplified command using testsrc for reliability)

**Image Generation**
- Enhanced empty state with icon and contextual CTA (shows "Generate" button when prompt exists)

**Global**
- Reduced information density across all pages with better spacing
- Standardized button styles (primary = gradient, secondary = outline, ghost = transparent)
- Improved typography with uppercase tracking labels for settings

#### Bug Fixes
- CORS: Added port 3000 to backend allowed origins
- Dashboard: Fixed missing `</div>` tag causing syntax error
- Dashboard: Fixed `stats.total` → `stats.pending` type error
- MusicVideo: Fixed `disabled` attribute on `<label>` element (invalid HTML)

---

### Added - Backend Audio Upload & Music Video Rendering (Session 2)

#### New Files
- **`packages/backend/app/api/audio.py`** — Audio upload and analysis API router
  - `POST /api/audio/upload` — Multipart file upload (max 500 MB, chunked)
  - `GET /api/audio/files` — List uploaded audio files
  - `GET /api/audio/analysis/{job_id}` — Retrieve analysis results
- **`packages/backend/app/services/music_video_handler.py`** — Music video generation handler
  - FFmpeg-based video rendering with 4 visualization styles
  - 5 color schemes (auto, warm, cool, neon, monochrome)
  - Audio analysis integration (librosa beat/tempo/waveform)
  - Progress tracking during rendering
  - Preview mode (5s 720p draft)
- **`config/ports.json`** — Shared port configuration for monorepo
- **`docs/api/API_REFERENCE.md`** — Complete API documentation
- **`docs/guides/MUSIC_VIDEO_GUIDE.md`** — Music video workflow guide
- **`docs/architecture/ARCHITECTURE.md`** — System architecture documentation

#### Modified Files
- **`packages/backend/app/main.py`** — Added audio router registration
- **`packages/backend/app/queue/processor.py`** — Registered music video handlers
- **`packages/frontend/src/services/api.ts`** — Added `uploadAudioFile()` function
- **`packages/frontend/src/features/music-video/MusicVideo.tsx`** — Complete rewrite:
  - Real audio upload to backend with progress indicator
  - Server-side beat detection via audio analysis job
  - Real job submission with stored audio path
  - Error handling with dismissible error messages
  - Success confirmation on job submission
  - Session stats panel (beat markers, batch jobs, total, completed)
  - Recent Music Video Jobs panel with live status
  - Disabled submit until upload completes
  - Batch processing with proper audio file references
- **`README.md`** — Updated features list, API endpoints, job types
- **`Guidelines.md`** — Added music video workflow section, updated status
- **`CHANGELOG.md`** — This update

### Fixed
- Missing `config/ports.json` — Created with correct monorepo port settings
- MusicVideo.tsx duplicate closing `</div>` tag
- Job submission now requires successful upload before enabling

---

## [Previous Sessions]

### Added - Music Video Studio (Complete Rewrite)

#### Frontend Components
- **AudioVisualizer** (`frontend/src/components/audio/AudioVisualizer.tsx`)
  - Real-time waveform visualization using Web Audio API
  - Beat detection with bass frequency analysis
  - Canvas-based rendering with gradient effects
  - Interactive playhead and beat markers
  - Play/pause controls with time display

- **BeatTimeline** (`frontend/src/components/audio/BeatTimeline.tsx`)
  - Interactive timeline editor for beat markers
  - 4 marker types: Beat, Drop, Break, Transition
  - 3 intensity levels: Low, Medium, High
  - Auto-detect beats feature
  - Drag-and-drop marker editing
  - Color-coded markers with legend

- **StyleTemplateGallery** (`frontend/src/components/audio/StyleTemplateGallery.tsx`)
  - 7 pre-built visual style templates:
    - Cyberpunk Neon (synthwave aesthetics)
    - Organic Flow (nature-inspired movements)
    - Geometric Pulse (shapes pulsing to beat)
    - Particle Dance (swirling particles)
    - Vinyl Retro (vintage record style)
    - Waveform Classic (oscilloscope look)
    - Fire Energy (dynamic flames)
  - Category filtering (Abstract, Organic, Geometric, Energetic, Atmospheric)
  - Visual previews with gradient backgrounds
  - Motion strength, complexity, and reactivity indicators

- **VideoPreview** (`frontend/src/components/audio/VideoPreview.tsx`)
  - Frame scrubbing with thumbnail strip
  - Time slider for precise navigation
  - Playback controls (play/pause/skip)
  - Generate/Regenerate preview buttons

- **Audio Components Index** (`frontend/src/components/audio/index.ts`)
  - Centralized exports for all audio-related components

#### Enhanced MusicVideo Page
- Complete rewrite of `frontend/src/features/music-video/MusicVideo.tsx`
- **Tabbed Interface** with 4 sections:
  - **Audio Tab**: File upload + waveform visualizer + quick settings
  - **Visual Style Tab**: Full style template gallery
  - **Beat Timeline Tab**: Beat marker editor (when audio loaded)
  - **Batch Queue Tab**: Queue management for multiple tracks
- **Right Panel Features**:
  - Video preview area
  - Selected style summary with motion/reactivity indicators
  - Submit buttons (single job + batch queue)
  - Recent jobs list
- **Batch Processing**: Add multiple files to queue, process all at once
- **Quality Settings**: Draft/Standard/High quality options

#### Backend API Endpoints
- **Music Video Models** (`backend/app/api/integrations.py`)
  - `BeatMarker` - Beat marker for music video synchronization
  - `MusicVideoStyle` - Visual style configuration
  - `MusicVideoRequest` - Full generation request
  - `PreviewGenerationRequest` - 5-second draft preview

- **New Endpoints** (`backend/app/api/integrations.py`):
  - `GET /api/integrations/music-video/styles`
    - Returns 7 pre-built visual style templates
  - `POST /api/integrations/music-video/generate`
    - Queues full music video generation job
    - Supports beat markers, style templates, quality settings
  - `POST /api/integrations/music-video/preview`
    - Queues 5-second 240p draft preview
    - Fast generation with reduced steps
  - `GET /api/integrations/music-video/templates`
    - Returns available ComfyUI workflow templates

#### Job Types
- Added `MUSIC_VIDEO_PREVIEW` to `JobType` enum (`backend/app/models/job.py`)

### Fixed

#### Backend API Routes
- Added `/api/services/status` route to `backend/app/main.py`
  - Returns adapter status and WebSocket connection count
- Added `/api/render/health` route to `backend/app/main.py`
  - Returns system health for rendering services
- Fixed 404 errors on health check endpoints

#### Frontend Configuration
- Updated `frontend/src/services/portConfig.ts`
  - Changed default URLs from `localhost` to `127.0.0.1`
  - Fixed WebSocket port to use same port as backend HTTP API (8000)
  - Updated `VITE_WS_PORT` default from 8001 to 8000
  - Added `ws_url` to PortConfig interface

### Changed

#### Port Configuration
- Backend now serves WebSocket on same port as HTTP API (port 8000)
- WebSocket path changed to `/ws` instead of separate port
- Frontend dynamically reads WebSocket URL from `config/ports.json`

---

## [Previous Sessions]

### Infrastructure Improvements (Session 2)

#### Backend
- Implemented backend health API routes
  - `/api/health` - Basic health check
  - `/api/diagnostics/system` - System diagnostics
  - `/api/services/{service}/check` - Service-specific checks
- Fixed WebSocket connection to use same port as HTTP API (port 8000)
- Unified port configuration in `port_manager.py`
- Added health broadcast background task
- Added resource monitoring task

#### Frontend
- Fixed Media Library route integration
- Added Media Library to sidebar navigation
- Implemented ComfyUI adapter configuration in Settings page
- Replaced Stable Diffusion references with ComfyUI
- Added light theme toggle with CSS variable support
- Updated API calls to default to ComfyUI backend

---

## Git Commit Timeline

### Commit [PENDING] - feat(music-video): Complete music video studio implementation
**Date:** 2026-04-24  
**Changes:**
- All Music Video Studio components and backend endpoints
- AudioVisualizer, BeatTimeline, StyleTemplateGallery, VideoPreview
- Enhanced MusicVideo.tsx with tabbed interface
- 4 new backend API endpoints for music video generation
- MUSIC_VIDEO_PREVIEW job type

### Commit [PENDING] - fix(api): Add missing health and service routes
**Date:** 2026-04-24  
**Changes:**
- Added `/api/services/status` endpoint
- Added `/api/render/health` endpoint
- Fixed WebSocket port configuration

### Commit [PENDING] - refactor(frontend): ComfyUI integration and theme support
**Date:** 2026-04-24  
**Changes:**
- Updated Settings page for ComfyUI configuration
- Added light theme toggle
- Fixed port configuration (localhost → 127.0.0.1)

---

## Migration Notes

### For Users Upgrading

#### Music Video Studio
1. Upload audio file in the **Audio** tab
2. Select visual style in the **Visual Style** tab
3. Edit beat markers in the **Beat Timeline** tab
4. Generate preview (5s draft) before full render
5. Submit job or add to batch queue

#### Configuration Changes
- WebSocket now connects on same port as backend (8000)
- No separate WebSocket port configuration needed

---

## Future Roadmap

### Planned Features
- [ ] Real-time preview during audio playback
- [ ] Export to multiple platforms (YouTube, Vimeo)
- [ ] Lyrics synchronization for karaoke-style videos
- [ ] Advanced beat detection algorithms
- [ ] Custom style template creation UI
- [ ] Video stitching for long tracks

### Known Issues
- Git index.lock blocking commits (requires manual removal)
- Some lint warnings in new components (non-blocking)

---

## Contributors
- Development assisted by Cascade AI (Windsurf)

---

*Last updated: 2026-08-31*
