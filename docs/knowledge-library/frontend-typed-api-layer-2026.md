---
tags:
  - technical
aliases:
  - Frontend Typed API Layer
  - Typed Fetch Wrapper
  - API Type Safety
cssclasses:
  - technical-guide
date: 2026-11-07
type: concept
---

# Frontend Typed API Layer

> **Implemented:** 2026-11-07  
> **Scope:** `packages/frontend/src/services/api/` — 25 API modules rewritten with full TypeScript type safety  
> **Impact:** Reduced `@typescript-eslint/no-unsafe-*` warnings from ~2,853 to 85 (97% reduction)  
> **Files touched:** `typed-fetch.ts`, `types.ts`, and 23 domain-specific API modules

---

## Problem Statement

The original frontend API layer used `fetchWithTimeout` + `res.json()` returning `any` throughout. This caused:

1. **2,853 ESLint `@typescript-eslint/no-unsafe-*` warnings** across the codebase
2. **Runtime type errors** when backend contracts changed (field renames, new required fields)
3. **No autocomplete** in IDEs for API response shapes
4. **Silent failures** — missing fields returned `undefined` instead of type errors

---

## Solution Architecture

### 1. Typed Fetch Wrapper (`typed-fetch.ts`)

```typescript
// Core utilities — all return properly typed Promise<T>
export async function fetchJson<T>(url: string, options?, endpointName?): Promise<T>
export async function postJson<T, B>(url: string, body: B, options?, endpointName?): Promise<T>
export async function postForm<T>(url: string, formData: FormData, options?, endpointName?): Promise<T>
export async function getJson<T>(url: string, options?, endpointName?): Promise<T>
export async function deleteJson<T>(url: string, options?, endpointName?): Promise<T>
export async function putJson<T, B>(url: string, body: B, options?, endpointName?): Promise<T>

// Error handling — throws on non-OK responses with parsed detail
export async function parseJson<T>(response: Response, endpointName): Promise<T>
```

**Key behaviors:**
- Throws on non-2xx with parsed error detail (`detail`, `error`, `message`)
- Returns `undefined` for 204 No Content
- Includes endpoint name in error messages for debugging
- Uses `fetchWithTimeout` under the hood (preserves timeout behavior)

### 2. Central Type Definitions (`types.ts`)

**~1,600 lines** mirroring backend Pydantic models exactly. Categories:

| Category | Types | Examples |
|----------|-------|----------|
| Core/Health | 8 | `AggregateHealth`, `SystemHealth`, `AppConfig` |
| Audio | 27 | `AudioAnalysisResult`, `StemSeparationResponse`, `EnhanceStemsParams` |
| Remix | 18 | `RemixRecipeSpec`, `RemixPreview`, `RemixBuildResult` |
| Jobs/Queue | 4 | `Job`, `QueueStats`, `QueueMetrics` |
| Logs | 10 | `LogAnalyticsSummary`, `LogAnalyticsErrors` |
| Database | 10 | `DatabaseOverview`, `DatabaseTableDetail` |
| Ollama | 15 | `OllamaModel`, `UnifiedModel`, `CodingBenchmarkResult` |
| 3D/GPU | 5 | `GPUSnapshot`, `Generate3DResponse` |
| Media | 5 | `MediaProbeResponse`, `LoudnessResponse` |
| Media Library | 13 | `Collection`, `Tag`, `TrashItem` |
| Integrations | 9 | `ComfyUIStatus`, `AtomicChatStatus`, `VRAMStatus` |
| MCP/HyperFrames | 6 | `MCPContext`, `HyperFramesStatus` |
| Sub-agent | 4 | `SubAgentTask`, `AgentLoopOptions` |
| Video Render | 8 | `RenderResponse`, `ExportMatrixResponse` |

**Re-exports shared types** from `@shared/types`:
```typescript
export type { Job, JobType, JobStatus, QueueStats, QueueMetrics, PortConfig } from "@shared/types";
```

### 3. Domain-Specific API Modules

Each module imports from `./types` and `./typed-fetch`:

```typescript
// audio.ts example
import { getJson, postJson, postForm, fetchJson } from "./typed-fetch";
import type { AudioAnalysisResult, StemSeparationResponse, ... } from "./types";

export async function getAnalysis(filename: string): Promise<AudioAnalysisResult> {
  return getJson<AudioAnalysisResult>(`${BASE}/analysis/by-filename/${encoded}`, { timeout: 30000 });
}

export async function separateAudioStems(file: File, model = "mdx_extra_q", quality = {}): Promise<StemSeparationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  // ...
  return postForm<StemSeparationResponse>(`${BASE}/separate`, formData, { timeout: 600000 });
}
```

---

## Module Inventory

| File | Lines | Domain | Key Functions |
|------|-------|--------|---------------|
| `typed-fetch.ts` | 160 | Core | `fetchJson`, `postJson`, `postForm`, `getJson`, `deleteJson`, `putJson`, `parseJson` |
| `types.ts` | 1,633 | Types | All API response types |
| `core.ts` | 230 | Core | `getApiBase`, `withDirectBackendFallback`, re-exports |
| `audio.ts` | 558 | Audio | `uploadAudioFile`, `separateAudioStems`, `getAnalysis`, `enhanceStems`, `masterAudio` |
| `remix.ts` | 253 | Remix | `getRemixSources`, `previewRemix`, `startBuildRemix`, `enhanceRemix`, `remixFileUrl` |
| `jobs.ts` | 90 | Queue | `fetchJobs`, `fetchQueueStats`, `createJob`, `cancelJob` |
| `health.ts` | 100 | Health | `healthCheck`, `getSystemHealth`, `useHealthQuery` |
| `generation.ts` | 155 | AI Gen | `generateVideo`, `generateImage`, `queueImageJob` |
| `ollama.ts` | 360 | Ollama | `getOllamaModels`, `ollamaChat`, `runBenchmark`, `generateVisualizerPreset` |
| `integrations.ts` | 112 | Services | `getComfyUIStatus`, `startComfyUI`, `getVRAMStatus`, `upscaleImage` |
| `logs.ts` | 127 | Logs | `getLogContent`, `getLogAnalyticsSummary`, `ingestLogsForAnalytics` |
| `data.ts` | 242 | Data | `getPrompts`, `savePrompt`, `getSessions`, `getPreferences` |
| `database.ts` | 89 | DB Admin | `getDatabaseOverview`, `checkDatabaseIntegrity`, `runDatabaseMaintenance` |
| `gpu-3d.ts` | 90 | GPU/3D | `getGPUSnapshot`, `getGPUStats`, `generate3D`, `generate3DFromImage` |
| `vision.ts` | 41 | Vision | `visionOCR`, `analyzeVisualizer` |
| `native.ts` | 60 | Native | `openInBlender`, `openInUnity`, `getNativeOpenStatus` |
| `media.ts` | 63 | Media | `probeMedia`, `getMediaLoudness`, `getMediaWaveform` |
| `media_library.ts` | 188 | Library | `listMediaFavorites`, `listCollections`, `listTags`, `moveItemToTrash` |
| `diagnostics.ts` | 85 | Diagnostics | `getDiagnostics`, `getMemoryDiagnostics`, `getLoadedModels` |
| `mcp-hyperframes.ts` | 100 | MCP/HF | `fetchMCPContext`, `compileStoryboard`, `renderHyperFramesComposition` |
| `mcp-skills.ts` | 90 | Skills | `skillsList`, `executeTool`, `skillToToolDefinition` |
| `agent-loop.ts` | 563 | Agent | `runAgentLoop`, `selectModel`, `clearModelSelectionCache` |
| `video-render.ts` | 119 | Video | `getRenderEngines`, `renderClip`, `buildExportMatrix`, `assembleBeatQuantized` |
| `docs.ts` | 39 | Docs | `searchDocs`, `getDocsBootstrap`, `getProjectStructure` |
| `unity.ts` | 228 | Unity | `getUnityStatus`, `sendUnityCommand`, `syncUnityAudioFrame`, `captureUnityScene` |
| `sub-agent.ts` | 184 | Sub-agent | `runSubAgentTask`, `subscribeToSubAgentSSE` |
| `settings.ts` | 25 | Settings | `getSettings`, `updateSettings` |

---

## Migration Guide

### For New API Calls

```typescript
// ❌ OLD — returns any, no type safety
const data = await fetchWithTimeout(url).then(r => r.json());

// ✅ NEW — fully typed, throws on error
const data = await getJson<MyResponseType>(url, { timeout: 30000 });

// ✅ NEW — POST with typed body
const result = await postJson<ResultType, RequestType>(url, requestBody, { timeout: 60000 });

// ✅ NEW — FormData upload
const upload = await postForm<ResponseType>(url, formData, { timeout: 120000 });
```

### Adding New Types

1. Add interface to `types.ts` in the appropriate category section
2. Export from `types.ts` (already re-exports everything)
3. Import in your API module: `import type { MyNewType } from "./types";`
4. Use in function signature: `export async function myCall(): Promise<MyNewType>`

### Backend Contract Changes

When the backend changes a response shape:
1. Update the corresponding interface in `types.ts`
2. Run `pnpm type-check` — all call sites with mismatches will error
3. Fix call sites (usually just property access changes)

---

## ESLint Status

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| `@typescript-eslint/no-unsafe-assignment` | ~1,200 | 12 | -99% |
| `@typescript-eslint/no-unsafe-member-access` | ~900 | 18 | -98% |
| `@typescript-eslint/no-unsafe-call` | ~400 | 8 | -98% |
| `@typescript-eslint/no-unsafe-return` | ~200 | 5 | -97.5% |
| `@typescript-eslint/no-unsafe-argument` | ~150 | 3 | -98% |
| **Total unsafe warnings** | **~2,853** | **85** | **-97%** |

**Remaining 85 warnings** are in architectural patterns requiring deeper refactoring:
- `typed-fetch.ts` (14) — dynamic error parsing uses `any`
- `core.ts` (9) — `withDirectBackendFallback` dynamic imports
- `agent-loop.ts` (21) — skill tool calling with untyped responses
- `sub-agent.ts` (22) — SSE event parsing
- `ollama.ts` (2) — dynamic model selection
- `mcp-skills.ts` (2) — skill tool definitions
- Minor in `audio.ts`, `generation.ts`, `unity.ts`

---

## Related

- [[frontend-build-pipeline]]:see-also — Vite/TypeScript build configuration
- [[typescript-eslint-research]]:see-also — TypeScript/ESLint problem research methodology
- [[visualizer-architecture]]:see-also — Visualizer module structure (uses typed API)
- [[unity-audio-visualization-2026]]:see-also — Unity integration (uses `unity.ts`)