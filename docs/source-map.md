# Source Map — Quick Reference for Local Agents

Condensed "where is what" reference. Local agents with smaller context windows
should start here instead of reading AGENTS.md end-to-end or exploring blindly.
Every path listed below was confirmed against the working tree.

## Backend — `packages/backend/app/`

| Concern | File | Purpose |
|---------|------|---------|
| App entry | `main.py` | FastAPI app factory and startup wiring |
| API routes | `api/` | Route definitions: `audio.py`, `audio_stems.py`, `audio_edit.py`, `audio_remix.py`, `transcription.py`, `health.py`, `jobs.py`, `outputs.py`, `unity.py`, `ollama.py`, `comfyui.py`, `remotion.py`, `blender.py`, `sse.py`, `websocket.py` |
| Business logic | `services/` | `audio_remix.py`, `stem_remixer.py`, `remix_recipe.py`, `remix_preview.py`, `remix_render.py`, `transcription.py`, `job_queue.py`, `vram_manager.py`, `audio_analysis.py` |
| Data models | `models/` | Pydantic schemas |
| External adapters | `adapters/` | ComfyUI, Ollama, Blender, Unity, music-gen |
| SSE events | `sse/` | Canonical real-time events path |
| Job queue | `queue/` | DLQ + metrics + exponential backoff retries |
| Core setup | `core/` | Port manager, health monitor, SQLite, CORS, tracing, RequestID |
| Diagnostics | `diagnostics/` | Resource and health diagnostics |
| Utils | `utils/` | Shared helpers |
| WebSocket | `websocket/` | Legacy shim (426 — use SSE instead) |

**Dependency rule:** `api -> services -> adapters`, only downward. Services/adapters must never import `api`.

## Frontend — `packages/frontend/src/`

| Concern | File | Purpose |
|---------|------|---------|
| App entry | `main.tsx` | React entry: mounts `App`, registers providers |
| App root | `App.tsx` | Router, routes, lazy page boundaries, error boundaries |
| Components | `components/` | `common/`, `layout/`, `debug/`, `audio/`, `ai/`, `notifications/`, `tracks/` |
| Feature domains | `features/` | 36 subdirectories: `visualizer/`, `remix/`, `three-js-studio/`, `music-video/`, `ollama-chat/`, `queue/`, `settings/`, `dashboard/`, `media-library/`, `audio-analysis/`, `image-generation/`, `video-generation/`, `music-gen/`, `kinetic-typography/`, `storyboards/`, `preview/`, `health/`, `gpu/`, `log-analytics/`, `mastering/`, `notifications/`, `docs/`, `database/`, `data-management/`, `generate3d/`, `art-direction/`, `animation-studio/`, `ai-tools/`, `sub-agent/`, `unity-control/`, `hyperframes/`, `not-found/` |
| Shared hooks | `hooks/` | `useAudioLibrary.ts`, `useBeatTimeline.ts`, `useJobs.ts`, `usePolling.ts`, `useWebSocket.ts`, `useFileUpload.ts`, `useAudioAnalysis.ts`, `useAudioLatencyMetrics.ts`, `useFrameRateMonitor.ts`, `useGenerationTiming.ts`, `useMemoryMetrics.ts`, `useNetworkMetrics.ts` |
| Global state | `state/` | `audioLibraryStore.ts`, `jobStore.ts`, `gpuStore.ts`, `healthStore.ts`, `uiStore.ts`, `notificationStore.ts`, `outputStore.ts`, `audioNaming.ts` |
| API client | `services/api/` | Generated API client |
| Service clients | `services/` | `comfyui.ts`, `sseService.ts`, `fetchWithTimeout.ts`, `portConfig.ts`, `logger.ts`, `generationEstimator.ts`, `trackLyrics.ts`, `debugApi.ts` |
| Shared types | `shared/`, `types/` | Cross-feature TypeScript types |
| Utils | `utils/` | `format.ts`, `url.ts`, `audioProbe.ts`, `promptLint.ts`, `errorCopy.ts` |
| Styles | `styles/` | Global CSS and Tailwind layers |
| Assets | `assets/` | Static assets, brand |

**Audio rule (D16):** `useAudioLibrary()` from `hooks/useAudioLibrary`, backed by `state/audioLibraryStore.ts`. Do not call `listAudioFiles()` from a component.

## Backend Tests — `packages/backend/tests/`

| Concern | File |
|---------|------|
| Remix service/cache | `test_stem_remixer.py` |
| Remix jobs | `test_remix_jobs.py` |
| Remix prompt | `test_remix_prompt.py` |
| Remix routes | `test_remix_routes.py` |
| Health | `test_health.py` |
| Database | `test_database_connections.py` |

## Frontend Tests

| Concern | Location |
|---------|----------|
| Unit tests (vitest) | `src/**/*.test.ts` (colocated next to modules) |
| E2E (Playwright) | `tests/`, `packages/frontend/tests/` |

## Configuration

| File | Purpose |
|------|---------|
| `config/ports.json` | Runtime port configuration (dynamic, written at startup) |
| `config/settings.json` | Studio settings |
| `config/tracks.json` | Track configuration |
| `packages/frontend/vite.config.ts` | Vite build/dev config (Vite 8.3.5, Rolldown bundler) |
| `packages/frontend/vitest.config.ts` | Vitest unit test config |
| `packages/frontend/tsconfig.json` | TypeScript config |
| `pnpm-workspace.yaml` | pnpm workspace catalog (dependency versions) |
| `kilo.jsonc` | Kilo agent configuration |

## Scripts — `scripts/`

| Script | Purpose |
|--------|---------|
| `manage-servers.ps1` | Unified server management: start/stop/restart/status/health |
| `start-services.ps1` | Thin wrapper: starts managed services |
| `check-ports.ps1` | List ports in use |
| `start-studio.ps1` | Interactive studio session |
| `start-unity-headless.ps1` | Unity headless mode |
| `install-git-hooks.sh` | Install git commit-msg/pre-push hooks |
| `check-env-health.ps1` | Environment health check |
| `check-tunnel.ps1` | Tunnel connectivity check |

## Tools — `tools/`

| Subdirectory | Purpose |
|--------------|---------|
| `mcp/` | MCP server bridges (Unity, Vision, Ollama Tools, Blender, HyperFrames) |
| `qwen_subagent/` | Local Qwen sub-agent harness |
| `model-reliability/` | Model scoring, tier roster, observed outcomes |
| `music-gen/` | ACE-Step music generation service |
| `blender/` | Blender integration |
| `ollama/` | Ollama integration |
| `vision/` | Vision analysis tools |
| `comfyui-queue-report.py` | ComfyUI queue duration report |
| `check-import-cycles.py` | Backend import cycle check |
| `check-path-references.py` | Moved/renamed file reference check |
| `run-gates.py` | Full project gate runner |
| `snapshot-audio-routes.py` | Audio route surface check |

## Key Conventions to Remember

1. **Shell:** PowerShell 7.6+ (`pwsh`), never `powershell` (5.1). Read `docs/powershell-command-sheet.md` before running commands.
2. **Python:** Use `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` for backend work. Never use `comfyui-cuda` or `C:\Python314` for backend.
3. **No CI:** Gates run locally via `python tools/run-gates.py` or `pnpm verify`.
4. **Commit trailer:** Every commit needs `Co-authored-by: Kilo <kilo@native-media-ai.studio>`.
5. **Task state:** `docs/plans/tasks/` — one file per focus area. Resume at first `doing` item.
6. **Do not delete/move** `unity-visualizer/` during cleanup.
7. **Docs search** (`/api/docs/search`) searches `docs/` only, not source code.
