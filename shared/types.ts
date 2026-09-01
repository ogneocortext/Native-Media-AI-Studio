/**
 * Shared TypeScript types for Native Media AI Studio
 * Generated from Pydantic models - Single source of truth for frontend-backend contracts
 */

// ============================================================================
// Enums
// ============================================================================

export enum JobStatus {
  PENDING = "pending",
  QUEUED = "queued",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
  RETRYING = "retrying",
}

export enum JobType {
  IMAGE_GENERATION = "image_generation",
  MUSIC_VIDEO = "music_video",
  MUSIC_VIDEO_PREVIEW = "music_video_preview",
  AUDIO_ANALYSIS = "audio_analysis",
  VISUALIZER = "visualizer",
  SCENE_RENDER = "scene_render",
  NARRATIVE_VIDEO = "narrative_video",
  STORYBOARD_GENERATION = "storyboard_generation",
  COMFYUI_WORKFLOW = "comfyui_workflow",
  AUDIO_FEATURE_EXTRACTION = "audio_feature_extraction",
}

export enum AdapterStatus {
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  ERROR = "error",
}

export enum ServiceHealth {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  OFFLINE = "offline",
}

// ============================================================================
// Job Models
// ============================================================================

export interface Job {
  id: string;
  job_type: JobType;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  progress: number;
  message: string;
  error: string | null;
  result: Record<string, unknown> | null;
  params: Record<string, unknown>;
  output_path: string | null;
  retry_count: number;
  max_retries: number;
  // Computed fields
  is_active: boolean;
  is_terminal: boolean;
  has_error: boolean;
  duration_seconds: number | null;
  can_retry: boolean;
  can_cancel: boolean;
}

export interface JobCreateRequest {
  job_type: JobType;
  params: Record<string, unknown>;
  max_retries: number;
}

export interface JobUpdateRequest {
  status?: JobStatus;
  progress?: number;
  message?: string;
  error?: string;
  result?: Record<string, unknown>;
}

export interface QueueStats {
  total_jobs: number;
  pending: number;
  queued: number;
  running: number;
  retrying: number;
  completed: number;
  failed: number;
  cancelled: number;
  // Computed fields
  active_jobs: number;
  terminal_jobs: number;
  success_rate: number;
  is_healthy: boolean;
}

// ============================================================================
// Health & Diagnostics
// ============================================================================

export interface AdapterHealth {
  status: ServiceHealth;
  url: string;
  response_time_ms?: number;
  error?: string;
}

export interface HealthResponse {
  status: ServiceHealth;
  backend: "online" | "offline";
  adapters: Record<string, AdapterHealth>;
  overall: "healthy" | "degraded";
}

export interface SystemHealth {
  status: ServiceHealth;
  timestamp: string;
  platform: string;
  platform_version: string;
  cpu: CpuInfo;
  memory: MemoryInfo;
  disk: DiskInfo;
}

export interface CpuInfo {
  usage_percent: number;
  count: number;
  count_logical: number;
}

export interface MemoryInfo {
  total_gb: number;
  available_gb: number;
  used_gb: number;
  percent: number;
}

export interface DiskInfo {
  total_gb?: number;
  free_gb?: number;
  percent?: number;
  error?: string;
}

export interface ResourceWarning {
  type: "memory" | "vram" | "disk";
  level: "warning" | "critical";
  message: string;
  current_value: number;
  threshold: number;
  unit: string;
}

// ============================================================================
// Output Files
// ============================================================================

export interface OutputFile {
  filename: string;
  path: string;
  relative_path: string;
  file_type: "image" | "video" | "audio" | "other";
  size_bytes: number;
  created_at: string;
  modified_at?: string;
  cover_image?: string;
  metadata: Record<string, unknown> | null;
  job_id: string | null;
}

export interface OutputsResponse {
  outputs: OutputFile[];
  total: number;
  images_count: number;
  videos_count: number;
  audio_count: number;
}

// ============================================================================
// WebSocket Events
// ============================================================================

export interface WebSocketMessage {
  type: string;
  data: unknown;
  timestamp: string;
}

export interface JobEvent extends WebSocketMessage {
  type: "job.queued" | "job.started" | "job.progress" | "job.completed" | "job.failed" | "job.cancelled";
  data: { job: Job };
}

export interface HealthEvent extends WebSocketMessage {
  type: "system.health_changed";
  data: HealthResponse;
}

export interface ResourceWarningEvent extends WebSocketMessage {
  type: "system.resource_warning";
  data: ResourceWarning;
}

export interface QueueUpdateEvent extends WebSocketMessage {
  type: "queue_update";
  data: QueueStats;
}

// ============================================================================
// Port Configuration
// ============================================================================

export interface PortConfig {
  backend_url: string;
  backend_port: number;
  frontend_port: number;
  video_editor_port: number;
  comfyui_port: number;
  comfyui_url: string;
  events_url: string;
  sse_url: string;
  ws_port: number;
  ws_url: string;
}

// ============================================================================
// API Responses
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface JobsListResponse {
  jobs: Job[];
  stats: QueueStats;
}
