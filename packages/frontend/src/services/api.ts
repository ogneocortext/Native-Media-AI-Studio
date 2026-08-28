/**
 * API service for communicating with the backend.
 * Per Guidelines section 6: "No hardcoded API URLs. Always read from ports.json or Vite env vars."
 */

import { getBackendUrl } from "./portConfig";
import type { Job, QueueStats } from "@shared/types";

export type { Job, QueueStats };

// Get backend URL from config (reads ports.json or env vars)
export const getApiBase = (): string => getBackendUrl();

export interface HealthStatus {
  status: string;
  services: Record<string, string>;
}

export interface AdapterHealth {
  name: string;
  status: "online" | "offline" | "unknown";
  url?: string;
  response_time_ms?: number;
  error?: string;
}

export interface AggregateHealth {
  backend: "online" | "offline";
  overall: "healthy" | "degraded" | "unhealthy";
  adapters: Record<string, AdapterHealth>;
  timestamp: string;
}

export interface AdapterDetail {
  status: string;
  error?: string;
  url?: string;
}

export interface ServiceStatus {
  adapters: Record<string, string>;
  adapter_details?: Record<string, AdapterDetail>;
  connections: number;
}

export interface SystemHealth {
  status: string;
  timestamp: string;
  platform: string;
  platform_version: string;
  cpu: {
    usage_percent: number;
    count: number;
    count_logical: number;
  };
  memory: {
    total_gb: number;
    available_gb: number;
    used_gb: number;
    percent: number;
  };
  disk: {
    total_gb?: number;
    free_gb?: number;
    percent?: number;
    error?: string;
  };
}

// Jobs API
export async function fetchJobs(status?: string): Promise<Job[]> {
  const base = getApiBase();
  const url = status ? `${base}/api/jobs?status=${status}` : `${base}/api/jobs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function fetchJob(id: string): Promise<Job> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/${id}`);
  if (!res.ok) throw new Error("Failed to fetch job");
  return res.json();
}

export async function fetchQueueStats(): Promise<QueueStats> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/stats`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function createJob(
  jobType: string,
  params: Record<string, unknown>,
  maxRetries: number = 3,
): Promise<Job> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_type: jobType,
      params,
      max_retries: maxRetries,
    }),
  });
  if (!res.ok) throw new Error("Failed to create job");
  return res.json();
}

export async function cancelJob(id: string): Promise<void> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/${id}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to cancel job");
}

export async function retryJob(id: string): Promise<Job> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/${id}/retry`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to retry job");
  return res.json();
}

export async function deleteJob(id: string): Promise<void> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete job");
}

export async function clearCompletedJobs(): Promise<void> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/clear-completed`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to clear completed jobs");
}

export async function clearFailedJobs(): Promise<void> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/clear-failed`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to clear failed jobs");
}

// Health API
/** Ping the backend (liveness probe). */
export async function ping(): Promise<{ status: string }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/ping`);
  if (!res.ok) throw new Error("Ping failed");
  return res.json();
}

export async function healthCheck(): Promise<AggregateHealth> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health`);
  if (!res.ok) throw new Error("Health check failed");
  return res.json();
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/render/health`);
  if (!res.ok) throw new Error("Failed to get system health");
  return res.json();
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/services/status`);
  if (!res.ok) throw new Error("Failed to get service status");
  return res.json();
}

// Image generation (uses ComfyUI)
export async function generateImage(
  prompt: string,
  options: {
    negativePrompt?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    seed?: number;
    sampler?: string;
    backend?: string;
    model?: string;
  } = {},
): Promise<{ success: boolean; output_path: string; seed: number }> {
  const base = getApiBase();
  // Default to comfyui instead of sd_webui
  const res = await fetch(
    `${base}/api/integrations/${options.backend || "comfyui"}/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: options.negativePrompt || "",
        steps: options.steps || 20,
        cfg_scale: options.cfgScale || 7.0,
        width: options.width || 512,
        height: options.height || 512,
        seed: options.seed || -1,
        sampler: options.sampler || "Euler a",
        ckpt_name: options.model || undefined,
      }),
    },
  );
  if (!res.ok) throw new Error("Failed to generate image");
  return res.json();
}

export async function queueImageJob(
  prompt: string,
  options: Record<string, unknown> = {},
): Promise<{ job_id: string; status: string }> {
  const base = getApiBase();
  // Default to comfyui instead of sd_webui
  const res = await fetch(
    `${base}/api/integrations/${options.backend || "comfyui"}/job`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        ...options,
      }),
    },
  );
  if (!res.ok) throw new Error("Failed to queue image job");
  return res.json();
}

// Audio upload API
export interface AudioUploadResponse {
  success: boolean;
  filename: string;
  stored_path: string;
  size_bytes: number;
  message: string;
}

export async function uploadAudioFile(file: File): Promise<AudioUploadResponse> {
  const base = getApiBase();
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${base}/api/audio/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Failed to upload audio file");
  }
  return res.json();
}

// ============================================================================
// ComfyUI Management API
// ============================================================================

export interface ComfyUIStatus {
  installed: boolean;
  running: boolean;
  port: number;
  url: string;
  pid?: number;
  uptime_seconds?: number;
  version: {
    installed: boolean;
    path?: string;
    version?: string;
    commit?: string;
    branch?: string;
    behind_remote?: number;
    up_to_date?: boolean;
    error?: string;
  };
}

export async function getComfyUIStatus(): Promise<ComfyUIStatus> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/services/comfyui/status`);
  if (!res.ok) throw new Error("Failed to get ComfyUI status");
  return res.json();
}

export async function startComfyUI(port: number = 8188): Promise<any> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/services/comfyui/start?port=${port}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to start ComfyUI");
  return res.json();
}

export async function stopComfyUI(): Promise<any> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/services/comfyui/stop`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to stop ComfyUI");
  return res.json();
}

export async function restartComfyUI(port: number = 8188): Promise<any> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/services/comfyui/restart?port=${port}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to restart ComfyUI");
  return res.json();
}

export async function updateComfyUI(): Promise<any> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/services/comfyui/update`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to update ComfyUI");
  return res.json();
}

// ============================================================================
// Logs API
// ============================================================================

export interface LogInfo {
  log_directory: string;
  files: Record<string, {
    path: string;
    size_bytes: number;
    size_human: string;
    modified?: number;
  }>;
}

export interface LogContent {
  log: string;
  lines: number;
  content: string[];
}

export async function getLogInfo(): Promise<LogInfo> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/logs/`);
  if (!res.ok) throw new Error("Failed to get log info");
  return res.json();
}

export async function getLogContent(logName: string, lines: number = 100): Promise<LogContent> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/logs/${logName}?lines=${lines}`);
  if (!res.ok) throw new Error("Failed to get log content");
  return res.json();
}

export async function clearLogs(): Promise<any> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/logs/clear`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to clear logs");
  return res.json();
}

// =============================================================================
// Data Persistence API — Prompts, Audio, Visuals, Sessions, Preferences
// =============================================================================

export interface StoredPrompt {
  id: string;
  name: string;
  prompt_type: string;
  text: string;
  tags: string[];
  category: string;
  description: string;
  is_favorite: boolean;
  use_count: number;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AudioFileRecord {
  id: string;
  filename: string;
  original_name: string;
  stored_path: string;
  file_size: number;
  duration: number;
  format: string;
  bpm?: number;
  key?: string;
  genre?: string;
  created_at: string;
}

export interface AIVisualRecord {
  id: string;
  prompt_id?: string;
  style_id: string;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  filename: string;
  stored_path: string;
  comfyui_prompt_id: string;
  is_selected: boolean;
  is_favorite: boolean;
  rating: number;
  tags: string[];
  generation_time_seconds: number;
  created_at: string;
}

export interface GenerationSession {
  id: string;
  audio_id?: string;
  music_prompt_id?: string;
  status: string;
  config: Record<string, unknown>;
  selected_visuals: string[];
  output_path?: string;
  total_frames: number;
  generated_frames: number;
  estimated_time_seconds: number;
  actual_time_seconds: number;
  created_at: string;
  completed_at?: string;
}

// Prompts
export async function getPrompts(params?: {
  prompt_type?: string;
  category?: string;
  favorite?: boolean;
  search?: string;
  limit?: number;
}): Promise<StoredPrompt[]> {
  const base = getApiBase();
  const searchParams = new URLSearchParams();
  if (params?.prompt_type) searchParams.set("prompt_type", params.prompt_type);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.favorite) searchParams.set("favorite", "true");
  if (params?.search) searchParams.set("search", params.search);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const res = await fetch(`${base}/api/data/?${searchParams}`);
  if (!res.ok) throw new Error("Failed to get prompts");
  return res.json();
}

export async function savePrompt(prompt: {
  name: string;
  prompt_type: string;
  text: string;
  tags?: string[];
  category?: string;
  description?: string;
}): Promise<{ id: string; success: boolean }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prompt),
  });
  if (!res.ok) throw new Error("Failed to save prompt");
  return res.json();
}

export async function recordPromptUse(promptId: string): Promise<void> {
  const base = getApiBase();
  await fetch(`${base}/api/data/${promptId}/use`, { method: "POST" });
}

export async function togglePromptFavorite(promptId: string): Promise<boolean> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/${promptId}/favorite`, { method: "POST" });
  if (!res.ok) return false;
  const data = await res.json();
  return data.is_favorite;
}

export async function deletePrompt(promptId: string): Promise<void> {
  const base = getApiBase();
  await fetch(`${base}/api/data/${promptId}`, { method: "DELETE" });
}

// AI Visuals
export async function getAIVisuals(params?: {
  style_id?: string;
  favorite?: boolean;
  selected?: boolean;
  limit?: number;
}): Promise<AIVisualRecord[]> {
  const base = getApiBase();
  const searchParams = new URLSearchParams();
  if (params?.style_id) searchParams.set("style_id", params.style_id);
  if (params?.favorite) searchParams.set("favorite", "true");
  if (params?.selected) searchParams.set("selected", "true");
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const res = await fetch(`${base}/api/data/visuals/?${searchParams}`);
  if (!res.ok) throw new Error("Failed to get visuals");
  return res.json();
}

export async function saveAIVisual(visual: Partial<AIVisualRecord>): Promise<{ id: string }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/visuals/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(visual),
  });
  if (!res.ok) throw new Error("Failed to save visual");
  return res.json();
}

// Generation Sessions
export async function getSessions(params?: {
  status?: string;
  audio_id?: string;
  limit?: number;
}): Promise<GenerationSession[]> {
  const base = getApiBase();
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.audio_id) searchParams.set("audio_id", params.audio_id);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const res = await fetch(`${base}/api/data/sessions/?${searchParams}`);
  if (!res.ok) throw new Error("Failed to get sessions");
  return res.json();
}

export async function createSession(session: {
  audio_id?: string;
  music_prompt_id?: string;
  config?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/sessions/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
  if (!res.ok) throw new Error("Failed to create session");
  return res.json();
}

// User Preferences
export async function getPreferences(category?: string): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const url = category
    ? `${base}/api/data/preferences/?category=${category}`
    : `${base}/api/data/preferences/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to get preferences");
  return res.json();
}

export async function setPreference(
  key: string,
  value: unknown,
  category = "general"
): Promise<void> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/preferences/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, category }),
  });
  if (!res.ok) throw new Error("Failed to set preference");
}

// =============================================================================
// Audio Analysis API
// =============================================================================

export interface AudioAnalysisResult {
  tempo_bpm: number;
  duration_seconds: number;
  beat_count: number;
  sections: Array<{ type: string; start: number; end: number; energy: number }>;
  beat_times: number[];
  onset_times: number[];
  energy_curve: number[];
  confidence: number;
  amplitude_envelope: number[];
  stored_path: string | null;
  job_id: string | null;
}

export async function getAnalysis(filename: string): Promise<any> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/audio/analysis/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error("No cached analysis found");
  return res.json();
}

export async function getCudaStatus(): Promise<{ available: boolean; gpu_name?: string; error?: string }> {
  const base = getApiBase();
  // Try correct path first, fallback to legacy health path
  let res = await fetch(`${base}/api/integrations/cuda/status`);
  if (!res.ok) res = await fetch(`${base}/api/health/integrations/cuda/status`);
  if (!res.ok) throw new Error("Failed to get CUDA status");
  return res.json();
}

export async function analyzeAudio(file: File): Promise<AudioAnalysisResult> {
  const base = getApiBase();
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${base}/api/audio/analyze`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Analysis failed");
  return res.json();
}

export async function analyzeAudioCuda(file: File): Promise<AudioAnalysisResult> {
  const base = getApiBase();
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${base}/api/audio/analyze-cuda`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("CUDA analysis failed");
  return res.json();
}

export async function getAnalysisResult(jobId: string): Promise<AudioAnalysisResult> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/audio/analysis/${jobId}`);
  if (!res.ok) throw new Error("Failed to get analysis result");
  return res.json();
}

export async function listAudioFiles(): Promise<Array<{
  filename: string; path: string; size_bytes: number;
}>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/audio/files`);
  if (!res.ok) throw new Error("Failed to list audio files");
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.files || []);
}

export async function renameAudioFile(oldFilename: string, newFilename: string): Promise<{ success: boolean; new_filename: string }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/audio/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_filename: oldFilename, new_filename: newFilename }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to rename file");
  }
  return res.json();
}

// =============================================================================
// Video Generation API
// =============================================================================

export interface VideoGenerateRequest {
  prompt: string;
  negative_prompt?: string;
  steps?: number;
  cfg_scale?: number;
  seed?: number;
  section?: string;
  duration?: number;
  vertical_first?: boolean;
  audio_path?: string;
  audio_filename?: string;
  method?: "comfyui" | "visualization";
  model?: string;
}

export interface VideoGenerateResponse {
  success: boolean;
  job_id: string | null;
  output_path: string | null;
  section: string;
  error: string | null;
  message: string | null;
}

export async function generateVideoSection(request: VideoGenerateRequest): Promise<VideoGenerateResponse> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/video/generate-section`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error("Failed to generate video section");
  return res.json();
}

// =============================================================================
// GPU & 3D Health API
// =============================================================================

export interface GPUSnapshot {
  available: boolean;
  name?: string;
  memory_used_mb: number;
  memory_free_mb: number;
  memory_total_mb: number;
  memory_percent: number;
  gpu_utilization: number;
  memory_controller_utilization?: number;
  temperature_c: number;
  processes?: Array<{
    pid: number;
    name: string;
    used_mb: number | null;
    kind: string;
  }>;
  memory_available?: boolean;
  vram_total_mb?: number;
  vram_used_mb?: number;
  vram_free_mb?: number;
  temperature?: number;
  gpu_utilization_pct?: number;
}

export async function getGPUSnapshot(): Promise<GPUSnapshot> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/gpu`);
  if (!res.ok) throw new Error("Failed to get GPU snapshot");
  return res.json();
}

export async function getGPUProcesses(): Promise<{ processes: GPUProcessInfo[]; count: number }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/gpu/processes`);
  if (!res.ok) throw new Error("Failed to get GPU processes");
  return res.json();
}

export async function getFFmpegStatus(): Promise<{ running: boolean; count: number; processes: any[] }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/ffmpeg`);
  if (!res.ok) throw new Error("Failed to get ffmpeg status");
  return res.json();
}

export interface GPUProcessInfo {
  pid: number;
  name: string;
  mem_mb: number;
}

export async function get3DStatus(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/3d/status`);
  if (!res.ok) throw new Error("Failed to get 3D status");
  return res.json();
}

export async function generate3D(request: {
  prompt: string;
  model?: string;
  steps?: number;
  cfg?: number;
  seed?: number;
  params?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/3d/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error("Failed to trigger 3D generation");
  return res.json();
}

// =============================================================================
// Diagnostics API
// =============================================================================

export async function getDiagnostics(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/diagnostics`);
  if (!res.ok) throw new Error("Failed to get diagnostics");
  return res.json();
}

export async function getSystemDiagnostics(): Promise<SystemHealth> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/diagnostics/system`);
  if (!res.ok) throw new Error("Failed to get system diagnostics");
  return res.json();
}

export interface MemoryDiagnostics {
  memory: {
    total_mb: number;
    used_mb: number;
    available_mb: number;
    percent: number;
  };
  top_processes: { pid: number; name: string; mem_mb: number; mem_percent: number }[];
  process_count: number;
}

export async function getMemoryDiagnostics(): Promise<MemoryDiagnostics> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/diagnostics/memory`);
  if (!res.ok) throw new Error("Failed to get memory diagnostics");
  return res.json();
}

export async function cleanupSystemMemory(): Promise<{
  before_percent: number;
  after_percent: number;
  freed_percent: number;
  actions: string[];
  memory: { total_mb: number; used_mb: number; available_mb: number; percent: number };
}> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/diagnostics/memory/cleanup`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to cleanup memory");
  return res.json();
}

export interface DiagnosticsModel {
  name: string;
  size_mb: number;
  vram_mb: number;
  expires_at: string;
}

export interface DiagnosticsModelsResponse {
  loaded: boolean;
  models: DiagnosticsModel[];
  error?: string;
}

export async function getLoadedModels(): Promise<DiagnosticsModelsResponse> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/ollama/models`);
  if (!res.ok) throw new Error("Failed to get loaded models");
  return res.json();
}

export async function checkService(service: string): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/health/services/${service}/check`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to check service: ${service}`);
  return res.json();
}

// =============================================================================
// Job Types API
// =============================================================================

export async function getJobTypes(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/types`);
  if (!res.ok) throw new Error("Failed to get job types");
  return res.json();
}

// =============================================================================
// Ollama Chat API with Tool Calling
// =============================================================================

export interface OllamaModel {
  name: string;
  size: number;
  modified_at?: string;
  capabilities?: string[];
  supportsTools?: boolean;
  supportsVision?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
  tool_name?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

export async function getOllamaModels(): Promise<OllamaModel[]> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/models`);
  if (!res.ok) throw new Error("Failed to get Ollama models");
  const models: OllamaModel[] = await res.json();
  // Filter out embedding models (they can't generate text/code)
  return models.filter((m) => {
    const name = m.name.toLowerCase();
    return !name.includes("embed") && !name.includes("nomic") && !name.includes("minigpt") && !name.includes("clip");
  });
}

export async function ollamaChat(
  message: string,
  model: string = "qwen2.5:3b",
  options?: {
    history?: ChatMessage[];
    tools?: ToolDefinition[];
    think?: boolean | string;
    maxToolCalls?: number;
  },
): Promise<{ response: string; model: string; toolCalls: number; toolDetails?: Array<{ name: string; arguments: Record<string, unknown>; result: string }> }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model,
      history: options?.history || [],
      tools: options?.tools || [],
      think: options?.think,
      stream: false,
      max_tool_calls: options?.maxToolCalls || 5,
    }),
  });
  if (!res.ok) throw new Error("Failed to chat with Ollama");
  return res.json();
}

export async function ollamaChatStream(
  message: string,
  model: string = "qwen2.5:3b",
  options?: {
    history?: ChatMessage[];
    tools?: ToolDefinition[] | boolean;
    think?: boolean | string;
    maxToolCalls?: number;
    system?: string;
  },
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model,
      history: options?.history || [],
      tools: options?.tools || [],
      think: options?.think,
      stream: true,
      max_tool_calls: options?.maxToolCalls || 5,
      system: options?.system,
    }),
    signal,
  });
  if (!res.ok) throw new Error("Failed to chat with Ollama");
  return res.body!;
}

/**
 * Parse SSE stream from Ollama chat endpoint.
 * Returns an async generator that yields chat events.
 */
export async function* parseOllamaStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ type: "content" | "tool_calls" | "done" | "connected"; data: unknown }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          lastEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));

            if (lastEvent === "content") {
              yield { type: "content", data };
            } else if (lastEvent === "tool_calls") {
              yield { type: "tool_calls", data };
            } else if (lastEvent === "done") {
              yield { type: "done", data };
            } else if (lastEvent === "connected") {
              yield { type: "connected", data };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Generate text using Ollama (legacy endpoint).
 * Use ollamaChat for new code.
 */
export async function ollamaGenerate(
  prompt: string,
  model: string = "llama2",
): Promise<{ response: string; model: string; done: boolean }> {
  const base = getApiBase();
  const res = await fetch(
    `${base}/api/integrations/ollama/generate?prompt=${encodeURIComponent(prompt)}&model=${model}`,
  );
  if (!res.ok) throw new Error("Failed to generate via Ollama");
  return res.json();
}

// =============================================================================
// Music Video Styles API
// =============================================================================

export async function getMusicVideoStyles(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/music-video/styles`);
  if (!res.ok) throw new Error("Failed to get music video styles");
  return res.json();
}

export async function getWorkflowTemplates(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/music-video/templates`);
  if (!res.ok) throw new Error("Failed to get workflow templates");
  return res.json();
}

// =============================================================================
// Docs API (for programmatic access)
// =============================================================================

export async function searchDocs(q: string, limit: number = 20): Promise<Array<{
  path: string; title: string; score: number; snippet: string | null;
}>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/docs/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res.ok) throw new Error("Failed to search docs");
  return res.json();
}

export async function getDocsBootstrap(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/docs/bootstrap`);
  if (!res.ok) throw new Error("Failed to get docs bootstrap");
  return res.json();
}

export async function getProjectStructure(depth: number = 3): Promise<{
  root: string; structure: Record<string, unknown>;
}> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/docs/structure?depth=${depth}`);
  if (!res.ok) throw new Error("Failed to get project structure");
  return res.json();
}

// =============================================================================
// Tracks API
// =============================================================================

export interface APITrack {
  id: string;
  filename: string;
  artist: string;
  title: string;
  duration_seconds: number | null;
  size_mb: number | null;
  source_path: string;
  music_prompt: string;
  lyrics: string;
  visual_style: string;
  visual_prompt: string;
  status: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export async function fetchTracks(): Promise<APITrack[]> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/tracks/`);
  if (!res.ok) throw new Error("Failed to fetch tracks");
  return res.json();
}

// =============================================================================
// Integrations API
// =============================================================================

export async function getIntegrationStatus(serviceName: string): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/${serviceName}`);
  if (!res.ok) throw new Error(`Failed to get integration status: ${serviceName}`);
  return res.json();
}

export async function getModelsStatus(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/models/status`);
  if (!res.ok) throw new Error("Failed to get models status");
  return res.json();
}
