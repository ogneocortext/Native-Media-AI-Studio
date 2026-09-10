/**
 * API service for communicating with the backend.
 * Per Guidelines section 6: "No hardcoded API URLs. Always read from ports.json or Vite env vars."
 */

import type { Job, QueueStats } from "@shared/types";

export type { Job, QueueStats };
import { fetchWithTimeout } from "./fetchWithTimeout";
import { getBackendUrl, getCachedConfig } from "./portConfig";

// Get backend URL from config (reads ports.json or env vars)
export const getApiBase = (): string => {
  // Use relative URLs so requests go through Vite proxy (avoids CORS)
  return "";
};

async function withDirectBackendFallback<T>(
  proxyCall: () => Promise<T>,
  directPath: string,
  options?: { method?: string; body?: unknown; timeout?: number },
): Promise<T> {
  try {
    return await proxyCall();
  } catch (error) {
    const cached = getCachedConfig();
    const backendUrl = cached?.backend_url || getBackendUrl();
    const directUrl = `${backendUrl.replace(/\/$/, "")}${directPath}`;
    console.warn(`[api] proxy call failed, falling back to direct backend URL: ${directUrl}`, error);
    const init: RequestInit = {
      method: options?.method || "GET",
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    };
    if (options?.method === "POST") {
      init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    }
    return fetchWithTimeout(directUrl, { timeout: options?.timeout || 30000, ...init }).then((res) => {
      if (!res.ok) throw new Error(`Direct backend request failed: ${res.status}`);
      return res.json();
    });
  }
}

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
  return withDirectBackendFallback(
    () => fetchWithTimeout(`${base}/api/health`, { timeout: 30000 }).then((res) => {
      if (!res.ok) throw new Error("Health check failed");
      return res.json();
    }),
    "/api/health",
  );
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const base = getApiBase();
  return withDirectBackendFallback(
    () => fetchWithTimeout(`${base}/api/render/health`, { timeout: 30000 }).then((res) => {
      if (!res.ok) throw new Error("Failed to get system health");
      return res.json();
    }),
    "/api/render/health",
  );
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  const base = getApiBase();
  return withDirectBackendFallback(
    () => fetchWithTimeout(`${base}/api/services/status`, { timeout: 30000 }).then((res) => {
      if (!res.ok) throw new Error("Failed to get service status");
      return res.json();
    }),
    "/api/services/status",
  );
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
// Stem separation API (Demucs)
// ============================================================================

export interface StemSeparationResponse {
  success: boolean;
  audio_file: string;
  model: string;
  stems: Record<string, string>;
  duration: number;
  computed_at: string;
  error?: string | null;
}

export async function separateAudioStems(
  file: File,
  model: string = "htdemucs",
): Promise<StemSeparationResponse> {
  const base = getApiBase();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", model);

  const res = await fetchWithTimeout(`${base}/api/audio/separate`, {
    method: "POST",
    body: formData,
    timeout: 300000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Separation failed" }));
    throw new Error(err.detail || "Failed to separate audio stems");
  }
  return res.json();
}

export async function getAudioStems(filename: string): Promise<{ audio_file: string; stems: Record<string, string>; found: boolean }> {
  const base = getApiBase();
  return withDirectBackendFallback(
    () =>
      fetchWithTimeout(`${base}/api/audio/stems/${encodeURIComponent(filename)}`, { timeout: 30000 }).then((res) => {
        if (!res.ok) throw new Error("Failed to load stems");
        return res.json();
      }),
    `/api/audio/stems/${encodeURIComponent(filename)}`,
    { timeout: 30000 },
  );
}

export async function separateAudioFile(
  filename: string,
  model: string = "htdemucs",
): Promise<StemSeparationResponse> {
  const base = getApiBase();
  const payload = { filename, model };
  return withDirectBackendFallback(
    () =>
      fetchWithTimeout(`${base}/api/audio/separate-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeout: 600000,
      }).then((res) => {
        if (!res.ok) throw new Error("Stem separation failed");
        return res.json();
      }),
    "/api/audio/separate-file",
    { method: "POST", body: payload, timeout: 600000 },
  );
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
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/status`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get ComfyUI status");
  return res.json();
}

export async function startComfyUI(port: number = 8188): Promise<any> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/start?port=${port}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to start ComfyUI");
  return res.json();
}

export async function stopComfyUI(): Promise<any> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/stop`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to stop ComfyUI");
  return res.json();
}

export async function restartComfyUI(port: number = 8188): Promise<any> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/restart?port=${port}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to restart ComfyUI");
  return res.json();
}

export async function updateComfyUI(): Promise<any> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/update`, {
    method: "POST",
    timeout: 30000,
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
  const res = await fetchWithTimeout(`${base}/api/logs/`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log info");
  return res.json();
}

export async function getLogContent(logName: string, lines: number = 100): Promise<LogContent> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/${logName}?lines=${lines}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log content");
  return res.json();
}

export async function clearLogs(): Promise<any> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/clear`, { method: "POST", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to clear logs");
  return res.json();
}

// =============================================================================
// Log Analytics API
// =============================================================================

export interface LogAnalyticsSummary {
  total_events: number;
  last_event_at: string | null;
  last_cleanup_at: string | null;
  levels: Array<{ level: string; count: number }>;
  top_loggers: Array<{ logger: string; count: number }>;
  top_messages: Array<{ message: string; count: number; level: string }>;
  sources: Array<{ source: string; count: number }>;
}

export interface LogAnalyticsTrendPoint {
  ts_iso: string;
  ts_ms: number;
  level: string;
  logger: string;
  message: string;
}

export interface LogAnalyticsPatterns {
  levels: Array<{ level: string; count: number }>;
  loggers: Array<{ logger: string; count: number }>;
  messages: Array<{ message: string; count: number; level: string }>;
}

export interface LogAnalyticsErrorPattern {
  message: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export interface LogAnalyticsErrors {
  errors: LogAnalyticsErrorPattern[];
}

export async function getLogAnalyticsErrors(limit = 20): Promise<LogAnalyticsErrors> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/errors?limit=${limit}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics errors");
  return res.json();
}

export interface LogAnalyticsEvent {
  ts_iso: string;
  ts_ms: number;
  level: string;
  logger: string;
  message: string;
  source: string;
}

export async function getLogAnalyticsEvents(params: {
  level?: string;
  source?: string;
  limit?: number;
} = {}): Promise<{ count: number; events: LogAnalyticsEvent[] }> {
  const base = getApiBase();
  const qs = new URLSearchParams();
  if (params.level) qs.set("level", params.level);
  if (params.source) qs.set("source", params.source);
  qs.set("limit", String(params.limit ?? 200));
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/events?${qs.toString()}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics events");
  return res.json();
}

export async function getLogAnalyticsSummary(): Promise<LogAnalyticsSummary> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/summary`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics summary");
  return res.json();
}

export async function getLogAnalyticsTrends(sinceMs?: number, limit = 5000): Promise<{ count: number; points: LogAnalyticsTrendPoint[] }> {
  const base = getApiBase();
  const params = new URLSearchParams();
  if (sinceMs !== undefined) params.set("since_ms", String(sinceMs));
  params.set("limit", String(limit));
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/trends?${params.toString()}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics trends");
  return res.json();
}

export async function getLogAnalyticsPatterns(limit = 20): Promise<LogAnalyticsPatterns> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/patterns?limit=${limit}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics patterns");
  return res.json();
}

export async function ingestLogsForAnalytics(params: {
  source?: string;
  log_name?: string;
  limit?: number;
}): Promise<{ inserted: number; source: string; path: string }> {
  const base = getApiBase();
  const body = {
    source: params.source ?? "app",
    log_name: params.log_name ?? "app",
    limit: params.limit ?? 20000,
  };
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeout: 120000,
  });
  if (!res.ok) throw new Error("Failed to ingest logs for analytics");
  return res.json();
}

export async function cleanupLogAnalytics(keepDays = 30): Promise<{ deleted: number; keep_days: number }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/cleanup?keep_days=${keepDays}`, { method: "POST", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to cleanup log analytics");
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
  // Timing contract for frontend + Remotion + AI agents
  timing_contract?: {
    filename: string;
    duration: number;
    bpm: number;
    bpmConfidence: number;
    beats: Array<{
      time: number;
      drumType: string | null;
      energy: number;
      isDownbeat?: boolean;
      bpm?: number;
    }>;
    sections: Array<{ type: string; start: number; end: number; energy: number }>;
    energyCurve: Array<{ time: number; value: number }>;
    amplitudeEnvelope: number[];
  };
  // Suggested visualization parameters for AI/agent-driven presets
  suggested_visualization?: string;
  suggested_kinetic_preset?: string;
  suggested_theme_seed?: string;
}

export async function getAnalysis(filename: string): Promise<any> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/analysis/by-filename/${encodeURIComponent(filename)}`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No cached analysis found");
  }
  return res.json();
}

/** Ensure analysis exists for a file — runs analysis if not cached */
export async function ensureAnalysis(filename: string, backend: string = "sonara"): Promise<{ status: string; analysis: any }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/ensure-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, backend }),
    timeout: 300000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to ensure analysis");
  }
  return res.json();
}

export async function getCudaStatus(): Promise<{ available: boolean; gpu_name?: string; error?: string }> {
  const base = getApiBase();
  // Try correct path first, fallback to legacy health path
  let res = await fetchWithTimeout(`${base}/api/integrations/cuda/status`, { timeout: 30000 });
  if (!res.ok) res = await fetchWithTimeout(`${base}/api/health/integrations/cuda/status`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get CUDA status");
  return res.json();
}

export async function analyzeAudio(file: File, backend: string = "sonara"): Promise<AudioAnalysisResult> {
  const base = getApiBase();
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetchWithTimeout(`${base}/api/audio/analyze?backend=${encodeURIComponent(backend)}`, {
    method: "POST",
    body: formData,
    timeout: 300000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Analysis failed");
  }
  return res.json();
}

export async function analyzeAudioCuda(file: File): Promise<AudioAnalysisResult> {
  const base = getApiBase();
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetchWithTimeout(`${base}/api/audio/analyze-cuda`, {
    method: "POST",
    body: formData,
    timeout: 300000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "CUDA analysis failed");
  }
  return res.json();
}

export async function getAnalysisResult(jobId: string): Promise<AudioAnalysisResult> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/analysis/${jobId}`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to get analysis result");
  }
  return res.json();
}

/** Get Remotion-ready timing metadata (TimingContract) for a file. */
export async function getTimingMetadata(filename: string): Promise<any> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/timing-metadata/${encodeURIComponent(filename)}`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No timing metadata found");
  }
  return res.json();
}

export async function listAudioFiles(): Promise<Array<{
  filename: string; path: string; size_bytes: number;
}>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/files`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to list audio files");
  }
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.files || []);
}

// =============================================================================
// Audio Analysis API — agent-friendly expanded surface
// =============================================================================

export interface AudioBackendsResponse {
  available: string[];
  default: string;
}

export async function getAvailableAudioBackends(): Promise<AudioBackendsResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/backends`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to get audio backends");
  }
  return res.json();
}

export async function getAnalysisSummary(filename: string): Promise<{
  filename: string;
  tempo_bpm: number | null;
  duration_seconds: number | null;
  beat_count: number | null;
  confidence: number | null;
  sections: Array<{ type: string; start: number; end: number; energy: number }>;
  has_beat_times: boolean;
  has_onset_times: boolean;
  has_energy_curve: boolean;
  has_spectral: boolean;
  job_id: string | null;
  stored_path: string | null;
}> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/audio/analysis/summary/${encodeURIComponent(filename)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No analysis summary found");
  }
  return res.json();
}

export async function analyzeAllPending(backend: string = "sonara"): Promise<{
  status: string;
  analyzed: number;
  total: number;
  files: Array<{ filename: string; bpm: number; beats: number; confidence: number }>;
  errors: Array<{ filename: string; error: string }>;
}> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/analyze-all?backend=${encodeURIComponent(backend)}`, {
    method: "POST",
    timeout: 300000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "analyze-all failed");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Transcription API
// ---------------------------------------------------------------------------

export interface LyricLine {
  start: number;
  end: number;
  text: string;
  section?: string;
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
}

export interface TranscriptionResult {
  filename: string;
  language: string;
  duration: number;
  segments: LyricLine[];
}

export async function transcribeAudio(filename: string, language?: string, modelSize?: string): Promise<TranscriptionResult> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, language, model_size: modelSize }),
    timeout: 300000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Transcription failed");
  }
  return res.json();
}

export async function getTranscription(filename: string): Promise<TranscriptionResult> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/transcript/${encodeURIComponent(filename)}`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No transcription found");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Lyrics API (database-stored)
// ---------------------------------------------------------------------------

export async function getLyricsForTrack(trackId: string): Promise<{
  track_id: string;
  title: string;
  artist: string;
  lines: LyricLine[];
  total_lines: number;
}> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/lyrics/track/${trackId}`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No lyrics found");
  }
  return res.json();
}

export async function saveLyricsForTrack(trackId: string, lines: LyricLine[]): Promise<{ status: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/lyrics/track/${trackId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines }),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to save lyrics");
  }
  return res.json();
}

export async function deleteLyricsForTrack(trackId: string): Promise<{ status: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/lyrics/track/${trackId}`, { method: "DELETE", timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to delete lyrics");
  }
  return res.json();
}

export async function importLRC(trackId: string, lrcContent: string): Promise<{ status: string; lines_count: number }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/lyrics/import-lrc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id: trackId, lrc_content: lrcContent }),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to import LRC");
  }
  return res.json();
}

export async function exportLRC(trackId: string): Promise<{ lrc: string; format: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/lyrics/track/${trackId}/lrc`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to export LRC");
  }
  return res.json();
}

export async function getTracksWithLyrics(): Promise<Array<{
  id: string;
  title: string;
  artist: string;
  filename: string;
  duration_seconds: number;
  lyric_count: number;
}>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/lyrics/tracks-with-lyrics`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to get tracks");
  }
  return res.json();
}

export async function getLyricsByFilename(filename: string): Promise<{
  track_id: string;
  title: string;
  artist: string;
  lines: LyricLine[];
  total_lines: number;
}> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/lyrics/by-filename/${encodeURIComponent(filename)}`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No lyrics found");
  }
  return res.json();
}

export async function renameAudioFile(oldFilename: string, newFilename: string): Promise<{ success: boolean; new_filename: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_filename: oldFilename, new_filename: newFilename }),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to rename file");
  }
  return res.json();
}

export interface ExtractAudioResponse {
  success: boolean;
  filename: string;
  relative_path: string; // output-relative, e.g. "audio/song.m4a"
  stored_path: string;
  size_bytes: number;
  render_s: number;
  lossless: boolean;
  source_codec: string | null;
  source_sample_rate: string | null;
  message: string;
}

export async function extractVideoAudio(params: {
  source_path: string;
  format?: "original" | "mp3";
  bitrate?: "128k" | "192k" | "320k";
}): Promise<ExtractAudioResponse> {
  const base = getApiBase();
  return withDirectBackendFallback(
    () =>
      fetchWithTimeout(`${base}/api/audio/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 600000,
      }).then((res) => {
        if (!res.ok) throw new Error("Audio extraction failed");
        return res.json();
      }),
    "/api/audio/extract",
    { method: "POST", body: params, timeout: 600000 },
  );
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
  const res = await fetchWithTimeout(`${base}/api/health/gpu`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get GPU snapshot");
  return res.json();
}

export async function getGPUProcesses(): Promise<{ processes: GPUProcessInfo[]; count: number }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/gpu/processes`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get GPU processes");
  return res.json();
}

export interface GPUHistoryPoint {
  ts_ms: number;
  ts_iso: string;
  gpu_name?: string;
  memory_total?: number;
  memory_used?: number;
  memory_free?: number;
  memory_percent?: number;
  gpu_util?: number;
  mem_controller_util?: number;
  temperature_c?: number;
}

export async function getGPUHistory(range?: string, limit: number = 2000): Promise<{ points: GPUHistoryPoint[]; count: number }> {
  const base = getApiBase();
  const params = new URLSearchParams();
  if (range) params.set("range", range);
  params.set("limit", String(limit));
  const res = await fetchWithTimeout(`${base}/api/health/gpu/history?${params.toString()}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get GPU history");
  return res.json();
}

export async function getGPUStats(range?: string): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const params = new URLSearchParams();
  if (range) params.set("range", range);
  const res = await fetchWithTimeout(`${base}/api/health/gpu/stats?${params.toString()}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get GPU stats");
  return res.json();
}

export async function clearGPUHistory(keepDays: number = 0): Promise<{ deleted: number }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/gpu/history?keep_days=${keepDays}`, { method: "DELETE", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to clear GPU history");
  return res.json();
}

// Vision OCR (MiniCPM-V 2.6 — see docs/knowledge-library/minicpm-v-best-practices.md)
export async function visionOCR(file: File, prompt: string = "ocr", model: string = "minicpm-v:8b"): Promise<{ text: string; model: string; prompt: string }> {
  const base = getApiBase();
  const fd = new FormData();
  fd.append("file", file);
  fd.append("prompt", prompt);
  fd.append("model", model);
  const res = await fetchWithTimeout(`${base}/api/vision/ocr`, { method: "POST", body: fd, timeout: 120000 });
  if (!res.ok) throw new Error("Vision OCR failed");
  return res.json();
}

// Native Open — Blender / Unity (local-first)
export async function openInBlender(relativePath: string): Promise<{ success: boolean; method?: string; message?: string; path?: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/native/open/blender`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relative_path: relativePath }), timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to open in Blender" }));
    throw new Error((err as { detail?: string }).detail || "Failed to open in Blender");
  }
  return res.json();
}

export async function openInUnity(relativePath: string): Promise<{ success: boolean; unity_path?: string; message?: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/native/open/unity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relative_path: relativePath }), timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to open in Unity" }));
    throw new Error((err as { detail?: string }).detail || "Failed to open in Unity");
  }
  return res.json();
}

export async function getNativeOpenStatus(): Promise<{ blender: { available: boolean; path: string | null }; unity: { available: boolean; project: string } }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/native/open/status`, { timeout: 10000 });
  if (!res.ok) throw new Error("Failed to get native open status");
  return res.json();
}

export async function getFFmpegStatus(): Promise<{ running: boolean; count: number; processes: any[] }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/ffmpeg`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get ffmpeg status");
  return res.json();
}

// =============================================================================
// FFmpeg frontend-exposed media inspection API
// =============================================================================

export interface MediaProbeResponse {
  path: string;
  relative_path?: string;
  probe?: Record<string, unknown>;
  error?: string;
}

export async function probeMedia(path: string): Promise<MediaProbeResponse> {
  const base = getApiBase();
  const url = `${base}/api/media/probe?path=${encodeURIComponent(path)}`;
  const res = await fetchWithTimeout(url, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "probe failed" }));
    throw new Error(err.detail || "Failed to probe media");
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export interface LoudnessResponse {
  path: string;
  relative_path?: string;
  integrated_lufs?: number | null;
  loudness_range?: number | null;
  true_peak?: number | null;
  error?: string | null;
}

export async function getMediaLoudness(path: string): Promise<LoudnessResponse> {
  const base = getApiBase();
  const url = `${base}/api/media/loudness?path=${encodeURIComponent(path)}`;
  const res = await fetchWithTimeout(url, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "loudness failed" }));
    throw new Error(err.detail || "Failed to compute loudness");
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export interface WaveformResponse {
  path: string;
  relative_path?: string;
  peaks: number[];
  count: number;
  duration?: number | null;
  error?: string | null;
}

export async function getMediaWaveform(path: string, maxPoints: number = 240): Promise<WaveformResponse> {
  const base = getApiBase();
  const url = `${base}/api/media/waveform?path=${encodeURIComponent(path)}&max_points=${encodeURIComponent(String(maxPoints))}`;
  const res = await fetchWithTimeout(url, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "waveform failed" }));
    throw new Error(err.detail || "Failed to extract waveform");
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export interface ThumbnailAtTimeRequest {
  path: string;
  time_sec: number;
  width?: number;
}

export interface ThumbnailAtTimeResponse {
  path: string;
  relative_path?: string;
  thumbnail_path?: string | null;
  error?: string | null;
}

export async function extractThumbnailAtTime(body: ThumbnailAtTimeRequest): Promise<ThumbnailAtTimeResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/media/thumbnail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: body.path,
      time_sec: body.time_sec,
      width: body.width ?? 480,
    }),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "thumbnail failed" }));
    throw new Error(err.detail || "Failed to extract thumbnail");
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export interface RegenerateCoverResponse {
  path: string;
  relative_path?: string;
  cover_image?: string | null;
  error?: string | null;
}

export async function regenerateAudioCover(path: string): Promise<RegenerateCoverResponse> {
  const base = getApiBase();
  const url = `${base}/api/media/cover?path=${encodeURIComponent(path)}`;
  const res = await fetchWithTimeout(url, { method: "POST", timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "cover regeneration failed" }));
    throw new Error(err.detail || "Failed to regenerate cover");
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export interface GPUProcessInfo {
  pid: number;
  name: string;
  mem_mb: number;
}

export async function get3DStatus(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/3d/status`, { timeout: 30000 });
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
  const res = await fetchWithTimeout(`${base}/api/3d/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    timeout: 600000,
  });
  if (!res.ok) throw new Error("Failed to trigger 3D generation");
  return res.json();
}

/** Generate a 3D model from a reference image (character face/body lock source). */
export async function generate3DFromImage(
  file: File,
  opts?: { steps?: number; output_name?: string },
): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const form = new FormData();
  form.append("file", file, file.name);
  const params = new URLSearchParams();
  if (opts?.steps) params.set("steps", String(opts.steps));
  if (opts?.output_name) params.set("output_name", opts.output_name);
  const res = await fetchWithTimeout(`${base}/api/3d/generate-image?${params.toString()}`, {
    method: "POST",
    body: form,
    timeout: 600000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to trigger image-to-3D generation");
  }
  return res.json();
}

// =============================================================================
// Diagnostics API
// =============================================================================

export async function getDiagnostics(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/diagnostics`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get diagnostics");
  return res.json();
}

export async function getSystemDiagnostics(): Promise<SystemHealth> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/diagnostics/system`, { timeout: 30000 });
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
  const res = await fetchWithTimeout(`${base}/api/health/diagnostics/memory`, { timeout: 30000 });
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
  const res = await fetchWithTimeout(`${base}/api/health/diagnostics/memory/cleanup`, { method: "POST", timeout: 30000 });
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
  activity?: Record<string, { task: string; description: string; started_at: number; elapsed_seconds?: number }>;
  error?: string;
}

export async function getLoadedModels(): Promise<DiagnosticsModelsResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/ollama/models`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get loaded models");
  return res.json();
}

export async function checkService(service: string): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/services/${service}/check`, { method: "POST", timeout: 30000 });
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
  benchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
  codingBenchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
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

export interface OllamaBenchmarkResult {
  model: string;
  success: boolean;
  latency_ms: number;
  chars: number;
  lines: number;
  validation: {
    score: number;
    raw_score: number;
    max_score: number;
    passed_rules: number;
    total_rules: number;
    details: Array<{ rule: string; description: string; weight: number; passed: boolean }>;
    metrics: { lines: number; chars: number; balanced_braces: boolean; node_valid: boolean | null; node_error: string | null };
  };
  preview: string;
  error: string | null;
  timestamp: string;
}

export async function getBenchmarkResults(): Promise<{ updated_at: string | null; results: Record<string, OllamaBenchmarkResult> }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/benchmark/results`);
  if (!res.ok) throw new Error("Failed to get benchmark results");
  return res.json();
}

export async function runBenchmark(models?: string[], max_models = 8): Promise<{ updated_at: string | null; results: Record<string, OllamaBenchmarkResult> }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/benchmark/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models: models || null, max_models }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Benchmark failed" }));
    throw new Error(err.detail || "Benchmark failed");
  }
  return res.json();
}

export async function getBestBenchmarkModel(): Promise<{ best: string | null; result?: OllamaBenchmarkResult; results: { updated_at: string | null; results: Record<string, OllamaBenchmarkResult> } }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/benchmark/best`);
  if (!res.ok) throw new Error("Failed to get best benchmark model");
  return res.json();
}

export interface CodingBenchmarkTaskResult {
  task: string;
  weight: number;
  success: boolean;
  latency_ms: number;
  validation: {
    score: number;
    raw_score: number;
    max_score: number;
    passed_rules: number;
    total_rules: number;
    details: Array<{ rule: string; passed: boolean; weight: number }>;
    metrics: Record<string, unknown>;
  };
  preview: string;
  error: string | null;
}

export interface CodingBenchmarkResult {
  model: string;
  success: boolean;
  total_score: number;
  raw_score: number;
  max_score: number;
  total_latency_ms: number;
  tasks: CodingBenchmarkTaskResult[];
  timestamp: string;
}

export async function getCodingBenchmarkResults(): Promise<{ updated_at: string | null; results: Record<string, CodingBenchmarkResult> }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/coding-benchmark/results`);
  if (!res.ok) throw new Error("Failed to get coding benchmark results");
  return res.json();
}

export async function runCodingBenchmark(models?: string[], max_models = 12): Promise<{ updated_at: string | null; results: Record<string, CodingBenchmarkResult> }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/coding-benchmark/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models: models || null, max_models }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Coding benchmark failed" }));
    throw new Error(err.detail || "Coding benchmark failed");
  }
  return res.json();
}

export async function getBestCodingModel(): Promise<{ best: string | null; result?: CodingBenchmarkResult; results: { updated_at: string | null; results: Record<string, CodingBenchmarkResult> } }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/coding-benchmark/best`);
  if (!res.ok) throw new Error("Failed to get best coding model");
  return res.json();
}

export async function saveGeneratedScene(code: string, track: string, model: string): Promise<{ success: boolean; filename: string; path: string }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/saved-scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, track, model }),
  });
  if (!res.ok) throw new Error("Failed to save scene");
  return res.json();
}

export async function cleanupIncompleteScenes(track: string, keep = 3): Promise<{ removed: number; kept: number }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/saved-scenes/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track, keep }),
  });
  if (!res.ok) throw new Error("Failed to cleanup scenes");
  return res.json();
}

export async function listSavedScenes(): Promise<{ scenes: Array<{ filename: string; path: string; size: number; modified: string }> }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/saved-scenes`);
  if (!res.ok) throw new Error("Failed to list saved scenes");
  return res.json();
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
    ollamaOptions?: Record<string, unknown>;
    // also allow direct spread for convenience
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    repeat_penalty?: number;
    num_ctx?: number;
  },
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const base = getApiBase();
  const ollamaOpts: Record<string, unknown> = {
    ...(options?.ollamaOptions || {}),
  };
  // Collect known Ollama generation options if passed flat
  for (const k of ["temperature", "top_p", "top_k", "num_predict", "repeat_penalty", "num_ctx", "seed", "stop"]) {
    if ((options as any)?.[k] !== undefined) (ollamaOpts as any)[k] = (options as any)[k];
  }
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
      ...(Object.keys(ollamaOpts).length ? { options: ollamaOpts } : {}),
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
// AI Visualizer Preset Generation
// =============================================================================

export interface AIGeneratedPreset {
  version: string;
  id: string;
  name: string;
  description: string;
  tags: string[];
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    glow: string;
  };
  visualizer: {
    style: string;
    colors: string;
    intensity: number;
    particleCount: number;
    speed: number;
    scale: number;
    glow: boolean;
    rotation: boolean;
  };
  camera: {
    keyframes: Array<{ at: number; position: [number, number, number]; target: [number, number, number]; easing?: string }>;
    mode: string;
    fov: number;
  };
  postfx: Record<string, number>;
  lyrics: {
    style: string;
    glowIntensity: number;
    fontSize: number;
    fontWeight: number;
    letterSpacing: number;
    beatReact: boolean;
    enterAnimation: string;
    exitAnimation: string;
  };
  audioReactivity: {
    bass: string;
    mid: string;
    treble: string;
    beat: string;
    beatDecay: number;
    smoothing: number;
  };
}

export async function generateVisualizerPreset(
  description: string,
  model: string = "gemma4:e2b-it-qat",
  temperature: number = 0.7,
  track?: { bpm?: number; energy?: number; duration_seconds?: number; genre?: string },
): Promise<{ success: boolean; preset: AIGeneratedPreset; model: string }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/integrations/ollama/visualizer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, model, temperature, track }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to generate visualizer preset");
  }
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
  const res = await fetch(`${base}/api/data/tracks/`);
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

// =============================================================================
// MCP Context API
// =============================================================================

export interface MCPContext {
  updatedAt?: number;
  character?: {
    name?: string;
    notes?: string;
    seed?: number;
    prompt?: string;
    visible?: boolean;
    animation?: string;
  };
  scene?: {
    name?: string;
    objects?: string[];
    camera?: string;
  };
  audio?: {
    filename?: string;
    bpm?: number;
    energy?: number;
    beat?: boolean;
  };
  visualization?: {
    style?: string;
    mode?: "3d" | "shader" | "2d";
    preset?: string;
  };
}

export async function fetchMCPContext(): Promise<MCPContext> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/context`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to fetch MCP context");
  return res.json();
}

export async function updateMCPContext(patch: MCPContext): Promise<MCPContext> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to update MCP context");
  return res.json();
}

// =============================================================================
// HyperFrames API
// =============================================================================

export interface HyperFramesStatus {
  test_project: string;
  exists: boolean;
  hyperframes_cli: string;
  cli_available: boolean;
  version: string;
}

export async function getHyperFramesStatus(): Promise<HyperFramesStatus> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hyperframes/status`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get HyperFrames status");
  return res.json();
}

export async function getHyperFramesExamples(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hyperframes/examples`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get HyperFrames examples");
  return res.json();
}

export async function launchHyperFramesPreview(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hyperframes/preview`, {
    method: "POST",
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to launch HyperFrames preview");
  return res.json();
}

export async function renderHyperFramesComposition(params: {
  composition?: string;
  format?: string;
  fps?: number;
  quality?: string;
  workers?: string;
  output?: string;
}): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hyperframes/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 300000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to render HyperFrames composition");
  }
  return res.json();
}

// ============================================================================
// Video render engine abstraction (stack-extensions-2026.md Phase 2)
// ============================================================================

export interface RenderEngineInfo {
  id: string;
  label: string;
  notes: string;
  available: boolean;
  detail: string;
}

export interface RenderResponse {
  success: boolean;
  engine: string;
  output_path: string;
  relative_path: string | null;
  render_s: number;
  size_bytes: number;
  error: string | null;
  notes: string;
}

export async function getRenderEngines(): Promise<RenderEngineInfo[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/render/engines`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to list render engines");
  const data = await res.json();
  return data.engines;
}

export async function renderClip(params: {
  kind: "color" | "frames" | "image";
  engine?: string;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  output_path?: string;
  color?: string;
  frames_dir?: string;
  frame_pattern?: string;
  image_path?: string;
  audio_path?: string;
}): Promise<RenderResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 600000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Render request failed");
  }
  return res.json();
}

// ============================================================================
// Export Matrix (ai-video-trends-2026.md Trend 5)
// ============================================================================

export interface MatrixArtifact {
  kind: "vertical" | "loop" | "thumbnail";
  path: string;
  relative_path: string;
  width: number;
  height: number;
  duration: number;
  notes: string;
}

export interface ExportMatrixResponse {
  success: boolean;
  source: string;
  artifacts: MatrixArtifact[];
  errors: { kind: string; error: string }[];
  render_s: number;
  manifest_path: string | null;
  message: string;
}

export async function buildExportMatrix(params: {
  source_path: string;
  beat_times?: number[];
  sections?: { type: string; start: number; end: number; energy?: number }[];
  loop_seconds?: number;
}): Promise<ExportMatrixResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/export-matrix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 600000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Export matrix failed");
  }
  return res.json();
}

// ============================================================================
// Prompt History — version history + repair log (ai-video-trends-2026 §5 P2)
// ============================================================================

export interface PromptHistoryEntry {
  id: string;
  track_filename: string;
  section: string;
  section_index: number;
  prompt: string;
  negative_prompt: string;
  parent_id: string | null;
  version: number;
  action: "create" | "repair" | "restore" | "import";
  repair_reason: string;
  failure_notes: string;
  generation_params: Record<string, unknown>;
  outcome: "draft" | "generated" | "failed" | "approved";
  created_at: string;
}

export async function getPromptHistory(params?: {
  track_filename?: string;
  section?: string;
  limit?: number;
}): Promise<PromptHistoryEntry[]> {
  const base = getApiBase();
  const qs = new URLSearchParams();
  if (params?.track_filename) qs.set("track_filename", params.track_filename);
  if (params?.section) qs.set("section", params.section);
  if (params?.limit) qs.set("limit", String(params.limit));
  const res = await fetchWithTimeout(`${base}/api/data/prompt-history?${qs.toString()}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to load prompt history");
  return res.json();
}

export async function savePromptVersion(entry: {
  track_filename?: string;
  section?: string;
  section_index?: number;
  prompt: string;
  negative_prompt?: string;
  parent_id?: string | null;
  action?: "create" | "repair" | "restore" | "import";
  repair_reason?: string;
  failure_notes?: string;
  generation_params?: Record<string, unknown>;
  outcome?: "draft" | "generated" | "failed" | "approved";
}): Promise<{ success: boolean; entry: PromptHistoryEntry }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/prompt-history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to save prompt version");
  }
  return res.json();
}

export async function getPromptChain(entryId: string): Promise<PromptHistoryEntry[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/prompt-history/${entryId}/chain`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to load prompt chain");
  return res.json();
}

export async function deletePromptVersion(entryId: string): Promise<{ success: boolean }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/prompt-history/${entryId}`, { method: "DELETE", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to delete prompt version");
  return res.json();
}

// ============================================================================
// Upscale — 4x post-process pass (ai-video-trends-2026 Trend 4)
// ============================================================================

export interface UpscaleResponse {
  success: boolean;
  engine: "comfyui" | "ffmpeg";
  model: string;
  scale: number;
  source: string;
  output_path: string;
  relative_path: string | null;
  elapsed_s: number;
  warnings: string[];
  error: string | null;
}

export async function upscaleImage(params: {
  image: string;
  model?: string;
  scale?: 2 | 4;
  prefer_comfyui?: boolean;
}): Promise<UpscaleResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/upscale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 600000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Upscale failed");
  }
  return res.json();
}


