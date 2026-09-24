// Core
export { getApiBase, withDirectBackendFallback } from "./core";
export type { HealthStatus, AdapterHealth, AggregateHealth, AdapterDetail, ServiceStatus, SystemHealth } from "./core";

// Jobs
export { fetchJobs, fetchJob, fetchQueueStats, createJob, cancelJob, retryJob, deleteJob, clearCompletedJobs, clearFailedJobs } from "./jobs";
export type { Job, QueueStats } from "./jobs";

// Health
export { ping, healthCheck, getSystemHealth, getServiceStatus } from "./health";

// Settings
export { getSettings } from "./settings";
export type { AppSettings } from "./settings";

// Generation
export { generateVideo, getGenerationResult, getGenerationProgress, getGenerationPreview, generateImage, queueImageJob } from "./generation";
export type { VideoGenerationResponse, GenerationResultResponse, GenerationProgressResponse, GenerationPreviewResponse } from "./generation";

// Audio
export {
  uploadAudioFile, separateAudioStems, getAudioStems, separateAudioFile,
  getAnalysis, ensureAnalysis, getCudaStatus, analyzeAudio, analyzeAudioCuda, getAnalysisResult,
  getTimingMetadata, listAudioFiles, getAvailableAudioBackends, getAnalysisSummary, analyzeAllPending,
  transcribeAudio, getTranscription, getLyricsForTrack, saveLyricsForTrack, deleteLyricsForTrack,
  importLRC, exportLRC, getTracksWithLyrics, getLyricsByFilename, renameAudioFile,
  trimAudioFile, extractVideoAudio, generateVideoSection, generateKineticVideo,
} from "./audio";
export type {
  AudioUploadResponse, StemSeparationResponse, AudioStemsResponse, AudioAnalysisResult, EnsureAnalysisResponse,
  TimingMetadata, AudioBackendsResponse, LyricLine, TranscriptionResult, TrimRange, TrimAudioResponse,
  ExtractAudioResponse, VideoGenerateRequest, VideoGenerateResponse, KineticVideoRequest, KineticVideoResponse,
} from "./audio";

// Logs
export { getLogInfo, getLogContent, clearLogs, getLogAnalyticsErrors, getLogAnalyticsEvents, getLogAnalyticsSummary, getLogAnalyticsTrends, getLogAnalyticsPatterns, ingestLogsForAnalytics, cleanupLogAnalytics } from "./logs";
export type { LogInfo, LogContent, LogAnalyticsSummary, LogAnalyticsTrendPoint, LogAnalyticsPatterns, LogAnalyticsErrorPattern, LogAnalyticsErrors, LogAnalyticsEvent } from "./logs";

// Data persistence
export {
  getPrompts, savePrompt, recordPromptUse, togglePromptFavorite, deletePrompt,
  getAIVisuals, saveAIVisual, getSessions, createSession,
  getPreferences, setPreference, fetchTracks,
  saveGeneratedScene, cleanupIncompleteScenes, listSavedScenes,
  getPromptHistory, savePromptVersion, getPromptChain, deletePromptVersion,
} from "./data";
export type {
  StoredPrompt, AIVisualRecord, GenerationSession, APITrack, PromptHistoryEntry,
} from "./data";

// GPU / 3D
export { getGPUSnapshot, getGPUProcesses, getGPUHistory, getGPUStats, clearGPUHistory, get3DStatus, generate3D, generate3DFromImage } from "./gpu-3d";
export type { GPUSnapshot, GPUProcessInfo, GPUHistoryPoint } from "./gpu-3d";

// Vision
export { visionOCR, analyzeVisualizer } from "./vision";

// Native open (Blender / Unity)
export { openInBlender, openInUnity, getNativeOpenStatus, getFFmpegStatus } from "./native";
export type { FFmpegProcessInfo } from "./native";

// Media inspection
export { probeMedia, getMediaLoudness, getMediaWaveform, extractThumbnailAtTime, regenerateAudioCover } from "./media";
export type { MediaProbeResponse, LoudnessResponse, WaveformResponse, ThumbnailAtTimeRequest, ThumbnailAtTimeResponse, RegenerateCoverResponse } from "./media";

// Diagnostics
export { getDiagnostics, getSystemDiagnostics, getMemoryDiagnostics, cleanupSystemMemory, getLoadedModels, checkService, getJobTypes } from "./diagnostics";
export type { MemoryDiagnostics, DiagnosticsModelsResponse } from "./diagnostics";

// Ollama
export {
  getOllamaModels, getBenchmarkResults, runBenchmark, getBestBenchmarkModel,
  getCodingBenchmarkResults, runCodingBenchmark, getBestCodingModel,
  ollamaChat, ollamaChatStream, parseOllamaStream, ollamaGenerate, generateVisualizerPreset,
} from "./ollama";
export type { OllamaModel, ChatMessage, ToolDefinition, OllamaBenchmarkResult, CodingBenchmarkTaskResult, CodingBenchmarkResult, AIGeneratedPreset } from "./ollama";

// Integrations
export { getComfyUIStatus, startComfyUI, stopComfyUI, restartComfyUI, updateComfyUI, getIntegrationStatus, getVRAMStatus, getModelsStatus, getMusicVideoStyles, getWorkflowTemplates, upscaleImage } from "./integrations";
export type { ComfyUIStatus, ComfyUIStartResponse, ComfyUIStopResponse, ComfyUIUpdateResponse, IntegrationStatus, VRAMStatus, UpscaleResponse } from "./integrations";

// MCP + HyperFrames
export { fetchMCPContext, updateMCPContext, getHyperFramesStatus, getHyperFramesExamples, launchHyperFramesPreview, renderHyperFramesComposition } from "./mcp-hyperframes";
export type { MCPContext, HyperFramesStatus } from "./mcp-hyperframes";

// Video render + export matrix
export { getRenderEngines, renderClip, buildExportMatrix } from "./video-render";
export type { RenderEngineInfo, RenderResponse, MatrixArtifact, ExportMatrixResponse } from "./video-render";

// Docs
export { searchDocs, getDocsBootstrap, getProjectStructure } from "./docs";

// Unity control
export {
  getUnityStatus,
  listUnityCommands,
  sendUnityCommand,
  captureUnityScene,
} from "./unity";
export type {
  UnityStatus,
  UnityCommandResult,
  UnityCommandInfo,
} from "./unity";
