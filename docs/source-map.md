# Source Map — Quick Reference for Local Agents

Condensed "where is what" reference. Local agents with smaller context windows
should start here instead of reading AGENTS.md end-to-end or exploring blindly.

**This map is curated, not exhaustive** — directories grow faster than docs.
Counts and key files below were verified 2026-11-06; for the full surface use
`rg --files <dir>` or `Get-ChildItem`. If a row here disagrees with the tree,
the tree wins — fix the row.

## Backend — `packages/backend/app/`

| Concern | Location | Purpose |
|---------|----------|---------|
| App entry | `main.py` | FastAPI app factory, router registration, startup/shutdown wiring |
| API routes | `api/` | ~44 route modules by domain: `audio*.py` (upload/analysis/stems/edit/mastering/remix), `media*.py`, `jobs.py`, `health.py`, `retrieval.py`, `integrations_*.py`, `docs.py` (docs search), `data.py` (CSV import), `sub_agent.py`, `vision.py`, `unity_control.py`, … |
| Business logic | `services/` | ~70 modules: remix pipeline (`remix_*.py`, `stem_*.py`), `audio_analyzer.py`, `job_queue.py`, `vram_*.py`, `retrieval_service.py`, `transcription.py`, `mastering.py`, `storyboard_*.py`, `llm_loop.py`, `agent_memory.py`, … |
| Agent harness | `agents/` | `nma_agent.py`, `agent_state.py`, `api_client.py`, `resilience.py` |
| Data models | `models/` | `job.py`, `generation.py`, `errors.py` (Pydantic) |
| External adapters | `adapters/` | ComfyUI, Ollama (+tools/models), Blender, Unity, music-gen, atomic_chat; `bridge_*`/`registry` for third-party isolation |
| SSE events | `sse/handler.py` | Canonical real-time events path |
| WebSocket | `websocket/handler.py` | `ConnectionManager` — legacy path; prefer SSE |
| Job queue | `queue/` | `manager.py`, `processor.py`, `db_manager.py` (DLQ + retries) |
| Core setup | `core/` | Split modules: `connection.py`/`migrations.py`/per-domain CRUD (`database.py` is a re-export shim), ports, health, CORS, tracing |
| Diagnostics | `diagnostics/` | Resource monitor + GPU telemetry loop |
| Utils | `utils/` | Shared helpers |

**Dependency rule:** `api -> services -> adapters`, only downward. Services/adapters must never import `api`.

## Frontend — `packages/frontend/src/`

| Concern | Location | Purpose |
|---------|----------|---------|
| App entry | `main.tsx` | React entry: mounts `App`, registers providers |
| App root | `App.tsx` | Router, routes, lazy page boundaries, error boundaries |
| Components | `components/` | `common/`, `layout/`, `debug/`, `audio/`, `ai/`, `notifications/`, `tracks/` |
| Feature domains | `features/` | 36 subdirectories — `visualizer/`, `remix/`, `agent-chat/`, `three-js-studio/`, `music-video/`, `ollama-chat/`, `music-gen/`, `music-prompts/`, `kinetic-typography/`, `storyboards/`, `media-library/`, `image-generation/`, `image-processing/`, `video-generation/`, `audio-analysis/`, `queue/`, `settings/`, `dashboard/`, `preview/`, `health/`, `gpu/`, `log-analytics/`, `mastering/`, `notifications/`, `docs/`, `database/`, `data-management/`, `generate3d/`, `art-direction/`, `animation-studio/`, `ai-tools/`, `sub-agent/`, `unity-control/`, `hyperframes/`, `onboarding/`, `not-found/` |
| Shared hooks | `hooks/` | `index.ts` barrel + `useAudioLibrary.ts`, `useBeatTimeline.ts`, `useJobs.ts`, `usePolling.ts`, `useWebSocket.ts`, `useFileUpload.ts`, `useAudioAnalysis.ts`, `useAudioLatencyMetrics.ts`, `useFrameRateMonitor.ts`, `useGenerationTiming.ts`, `useMemoryMetrics.ts`, `useNetworkMetrics.ts`, `useNavigationMetrics.tsx` |
| Global state | `state/` | `audioLibraryStore.ts`, `jobStore.ts`, `gpuStore.ts`, `healthStore.ts`, `uiStore.ts`, `notificationStore.ts`, `outputStore.ts`, `audioNaming.ts` (+ colocated tests) |
| API client | `services/api/` | ~29 generated modules by domain (`audio.ts`, `jobs.ts`, `health.ts`, `remix.ts`, `docs.ts`, `gpu-3d.ts`, …) |
| Service clients | `services/` | `comfyui.ts`, `sseService.ts`, `fetchWithTimeout.ts`, `portConfig.ts`, `logger.ts`, `generationEstimator.ts`, `trackLyrics.ts`, `debugApi.ts` |
| Shared types | `shared/`, `types/` | Cross-feature TypeScript types |
| Utils | `utils/` | `format.ts`, `url.ts`, `audioProbe.ts`, `promptLint.ts`, `errorCopy.ts`, `eta.ts`, `metrics.ts`, `pendingAudio.ts`, `pendingTrack.ts`, `routePreloader.ts`, `theme.ts`, `toast.ts` (+ colocated tests) |
| Styles | `styles/` | Global CSS and Tailwind layers |
| Assets | `assets/` | Static assets, brand |

**Audio rule (D16):** `useAudioLibrary()` from `hooks/useAudioLibrary`, backed by `state/audioLibraryStore.ts`. Do not call `listAudioFiles()` from a component.

## Tests

| Concern | Location |
|---------|----------|
| Backend (pytest) | `packages/backend/tests/` — ~75 files; key suites: `test_stem_remixer.py`, `test_remix_*.py`, `test_database_connections.py`, `test_db_pool.py`, `test_gpu_telemetry_retention.py`, `test_health.py`, `test_queue*.py`, `test_vram_*.py` |
| Frontend unit (vitest) | `src/**/*.test.ts(x)` colocated (~46 files) |
| E2E (Playwright) | `packages/frontend/tests/` |

## Configuration

| File | Purpose |
|------|---------|
| `config/ports.json` | Runtime port configuration (dynamic, written at startup) |
| `config/settings.json` | Studio settings |
| `config/tracks.json` | Track configuration |
| `config/track-prompts-lyrics.csv` | Suno track prompts/lyrics — runtime data (import + lyrics features) |
| `config/` other JSON | `cloud_pricing`, `comfyui-optimization`, `hardware-profile`, `lipsync`, `model_routing` |
| `packages/frontend/vite.config.ts` | Vite build/dev config (Vite 8.3.5 via pnpm catalog, Rolldown) |
| `packages/frontend/vitest.config.ts` | Vitest unit test config |
| `packages/frontend/tsconfig.json` | TypeScript config |
| `pnpm-workspace.yaml` | pnpm workspace catalog (dependency versions) |
| `kilo.jsonc` | Kilo agent configuration (gitignored, machine-local) |

## Scripts — `scripts/`

Lifecycle (PowerShell, run via `pwsh -File`): `manage-servers.ps1`
(start/stop/restart/status/health — the unified tool), `start-services.ps1`,
`start-studio.ps1`, `start-dev.ps1`, `start-unity-headless.ps1`,
`check-ports.ps1`, `check-env-health.ps1`, `check-tunnel.ps1`,
`start-tunnel.ps1`, `stop-tunnel.ps1`, `comfyui-patch-status.ps1`,
`comfyui-safe-update.ps1`. Subdirs: `utility/`, `dev/`, `git-hooks/`,
`comfyui-patches/`. Also present: `.py`/`.mjs` one-off probes and benchmarks.

## Tools — `tools/`

Gate/CI (`run via D:\conda-envs\nma-studio-cuda\Scripts\python.exe`):
`run-gates.py` (all gates), `check-all.py` (docs/repo hygiene),
`check-path-references.py`, `check-repo-layout.py`, `check-docs-map.py`,
`check-import-cycles.py`, `check-subprocess-encoding.py`,
`check-text-encoding.py`, `check-glsl-compile.py`, `snapshot-audio-routes.py`,
`validate-knowledge-tags.py`, `report-nesting.py`, `report-path-orphans.py`,
`docs-tracker.py`, `docs-triage.py`, `agent-contribution-report.py`,
`clean-caches.py`, `commit-and-push.py`.

Domain subdirs: `mcp/` (MCP bridges), `go*/` (Go sidecars), `music-gen/`,
`blender/`, `ollama/`, `vision/`, `audio-analysis/`, `model-reliability/`,
`qwen_subagent/`, `probes/` (browser probes), `kb-*.py` (knowledge-base CLI),
`gates/`, `lib/`, `utils/`, `tests/`. Full inventory: `tools/README.md`.

## Key Conventions to Remember

1. **Shell:** PowerShell 7.6+ (`pwsh`), never `powershell` (5.1). Read `docs/powershell-command-sheet.md` before running commands.
2. **Python:** Use `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` for backend work. Never use `comfyui-cuda` or `C:\Python314` for backend.
3. **No CI:** Gates run locally via `python tools/run-gates.py` or `pnpm verify`.
4. **Commit trailer:** every commit needs a `Co-authored-by:` trailer naming the agent — use the table in `AGENTS.md` §Commit attribution (name-only or project-domain email; never a vendor/bot noreply).
5. **Task state:** `docs/plans/tasks/` — one file per focus area. Resume at first `doing` item.
6. **Do not delete/move** `unity-visualizer/` during cleanup.
7. **Docs search** (`/api/docs/search`) searches `docs/` only, not source code.
