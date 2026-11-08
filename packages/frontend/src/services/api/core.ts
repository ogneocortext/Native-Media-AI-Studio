/**
 * Core API utilities with type-safe fetch and shared types.
 * Re-exports typed-fetch utilities and defines core type interfaces.
 */

export {
  fetchJson,
  postJson,
  postForm,
  getJson,
  deleteJson,
  putJson,
  parseJson,
  type ApiError,
  type ApiResponse,
  type ApiSuccess,
  type ApiFailure,
} from "./typed-fetch";

export {
  type AdapterHealth,
  type AggregateHealth,
  type HealthStatus,
  type AdapterDetail,
  type ServiceStatus,
  type SystemHealth,
  type AppConfig,
  type AudioUploadResponse,
  type StemSeparationResponse,
  type SeparationQualityOptions,
  type AudioStemsResponse,
  type AudioAnalysisResult,
  type EnsureAnalysisResponse,
  type TimingMetadata,
  type StemsAnalysisResponse,
  type StemsStatusResponse,
  type AudioFileListItem,
  type AudioBackendsResponse,
  type AudioAnalysisSummary,
  type AnalyzeAllPendingResponse,
  type LyricLine,
  type TranscriptionResult,
  type TracksWithLyricsResponse,
  type RenameAudioResponse,
  type TrimRange,
  type TrimAudioResponse,
  type ExtractAudioResponse,
  type VideoGenerateRequest,
  type VideoGenerateResponse,
  type KineticVideoRequest,
  type KineticVideoResponse,
  type EnhanceStemsResponse,
  type EnhanceStemsParams,
  type MasterMeasureResponse,
  type MasterTarget,
  type MasterRequest,
  type MasterFinishPreset,
  type MasterApplied,
  type MasterResponse,
  type RemixSource,
  type RemixProbe,
  type RemixLayerSpec,
  type RemixSlotSpec,
  type RemixRecipeSpec,
  type RemixRecipeRoundTrip,
  type RemixPreview,
  type RemixPreviewAudio,
  type RemixDraft,
  type RemixBuildResult,
  type RemixSummary,
  type RemixLineageEntry,
  type RemixTrackLineage,
  type RemixEnhanceResult,
  type RemixJobAccepted,
  type RemixJobStatus,
  type RemixVersion,
  type StemName,
  type LogInfo,
  type LogContent,
  type LogAnalyticsSummary,
  type LogAnalyticsTrendPoint,
  type LogAnalyticsPatterns,
  type LogAnalyticsErrorPattern,
  type LogAnalyticsErrors,
  type LogAnalyticsEvent,
  type StoredPrompt,
  type AIVisualRecord,
  type GenerationSession,
  type APITrack,
  type PromptHistoryEntry,
  type DatabaseOverview,
  type DatabaseTableSummary,
  type DatabaseTableDetail,
  type DatabaseColumnInfo,
  type DatabaseIndexInfo,
  type DatabaseSchema,
  type DatabaseMigrationInfo,
  type DatabaseIntegrityResult,
  type DatabaseMaintenanceResult,
  type DatabaseMaintenanceAction,
  type GPUSnapshot,
  type GPUProcessInfo,
  type GPUHistoryPoint,
  type GPUStats,
  type Generate3DRequest,
  type Generate3DResponse,
  type VisionOCRResponse,
  type AnalyzeVisualizerResponse,
  type FFmpegProcessInfo,
  type NativeOpenStatus,
  type MediaProbeResponse,
  type LoudnessResponse,
  type WaveformResponse,
  type ThumbnailAtTimeRequest,
  type ThumbnailAtTimeResponse,
  type RegenerateCoverResponse,
  type Collection,
  type CollectionDetail,
  type CollectionItem,
  type Tag,
  type TrashItem,
  type FavoriteToggleResponse,
  type CreateCollectionRequest,
  type CreateTagRequest,
  type SetItemTagsRequest,
  type MoveToTrashRequest,
  type ItemOrganization,
  type DiagnosticsResponse,
  type MemoryDiagnostics,
  type DiagnosticsModelsResponse,
  type OllamaModel,
  type UnifiedModel,
  type TaskModelRoute,
  type ChatMessage,
  type ToolDefinition,
  type OllamaBenchmarkResult,
  type HardwareBenchmarkMetrics,
  type HardwareBenchmarkRun,
  type HardwareBenchmarkSummary,
  type CodingBenchmarkTaskResult,
  type CodingBenchmarkResult,
  type OllamaChatResponse,
  type AIGeneratedPreset,
  type SubAgentTask,
  type SubAgentRunRequest,
  type SubAgentRunResponse,
  type SubAgentEvent,
  type ComfyUIStatus,
  type ComfyUIStartResponse,
  type ComfyUIStopResponse,
  type ComfyUIUpdateResponse,
  type IntegrationStatus,
  type AtomicChatStatus,
  type VRAMStatus,
  type MusicVideoStyle,
  type WorkflowTemplate,
  type UpscaleResponse,
  type MCPContext,
  type CompileStoryboardRequest,
  type CompileStoryboardResponse,
  type HyperFramesAudioPayload,
  type HyperFramesStatus,
  type HyperFramesExample,
  type RenderHyperFramesResponse,
  type SkillInfo,
  type SkillContent,
  type ToolInfo,
  type ExecuteToolRequest,
  type ExecuteToolResponse,
  type AgentTurn,
  type AgentLoopOptions,
  type AgentLoopResult,
  type RenderEngineInfo,
  type RenderResponse,
  type MatrixArtifact,
  type ExportMatrixResponse,
  type DocSearchResult,
  type DocsBootstrap,
  type ProjectStructure,
  type UnityStatus,
  type UnityCommandResult,
  type UnityCommandInfo,
} from "./types";

// Re-export shared types
export type { Job, JobType, JobStatus, QueueStats, QueueMetrics, PortConfig } from "@shared/types";
export { fetchWithTimeout } from "../fetchWithTimeout";

/**
 * Get the API base URL (empty string for same-origin proxy).
 * The actual backend URL resolution happens in the fetch layer.
 */
export const getApiBase = (): string => "";

/**
 * Call a proxy endpoint with direct backend fallback.
 * If the proxy call fails, retry directly against the backend.
 */
export async function withDirectBackendFallback<T>(
  proxyCall: () => Promise<T>,
  directPath: string,
  options?: { method?: string; body?: unknown; timeout?: number }
): Promise<T> {
  try {
    return await proxyCall();
  } catch {
    // Import portConfig dynamically to avoid circular dependency
    const { getCachedConfig, getBackendUrl } = await import("../portConfig");
    const cached = getCachedConfig();
    const backendUrl = cached?.backend_url ?? getBackendUrl();
    const directUrl = `${backendUrl.replace(/\/$/, "")}${directPath}`;

    const init: RequestInit = {
      method: options?.method ?? "GET",
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    };
    if (options?.method === "POST") {
      init.headers = { "Content-Type": "application/json", ...(init.headers ?? {}) };
    }

    const { fetchWithTimeout } = await import("../fetchWithTimeout");
    const response = await fetchWithTimeout(directUrl, { timeout: options?.timeout ?? 30000, ...init });

    if (!response.ok) {
      throw new Error(`Direct backend request failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }
}