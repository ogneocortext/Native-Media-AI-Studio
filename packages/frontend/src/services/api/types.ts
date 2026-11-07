/**
 * Comprehensive API response type definitions for Native Media AI Studio.
 * These types mirror the backend Pydantic models exactly.
 * Single source of truth for frontend-backend contracts.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- re-exported for consumers
import type { Job, JobType, JobStatus, QueueStats, QueueMetrics, PortConfig } from "@shared/types";

// ============================================================================
// Core / Health / System Types
// ============================================================================

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

export interface AppConfig {
  backend_port: number;
  frontend_port: number;
  ws_port: number;
  backend_url: string;
  frontend_url: string;
  comfyui_url: string;
  comfyui_port: number;
  video_editor_port: number;
  ollama_url: string;
  atomic_chat_url: string;
  atomic_chat_enabled: boolean;
  go_dashboard_url: string;
  go_media_url: string;
  go_worker_url: string;
  go_gateway_url: string;
  go_ports_url: string;
}

// ============================================================================
// Audio Types
// ============================================================================

export interface AudioUploadResponse {
  success: boolean;
  filename: string;
  stored_path: string;
  size_bytes: number;
  message: string;
  converted?: boolean;
  source_filename?: string | null;
  lossless?: boolean;
  deduplicated?: boolean;
  relative_path: string;
}

export interface StemSeparationResponse {
  success: boolean;
  audio_file: string;
  model: string;
  stems: Record<string, string>;
  duration: number;
  computed_at: string;
  error?: string | null;
  stems_mp3?: Record<string, string>;
}

export interface SeparationQualityOptions {
  mode?: "single" | "hierarchical";
  segment_size?: number;
  overlap?: number;
  denoise?: boolean;
}

export interface AudioStemsResponse {
  audio_file: string;
  stems: Record<string, string>;
  stems_mp3?: Record<string, string>;
  found: boolean;
}

export interface AudioAnalysisResult {
  tempo_bpm: number;
  duration_seconds: number;
  beat_count: number;
  sections: { type: string; start: number; end: number; energy: number }[];
  beat_times: number[];
  onset_times: number[];
  energy_curve: number[];
  confidence: number;
  amplitude_envelope: number[];
  stored_path: string | null;
  relative_path?: string | null;
  job_id: string | null;
  beats_truncated?: boolean;
  downbeat_times?: number[];
  spectral?: {
    centroid_mean?: number;
    rolloff_mean?: number;
    bandwidth_mean?: number;
    zcr_mean?: number;
  };
  timing_contract?: {
    filename: string;
    duration: number;
    bpm: number;
    bpmConfidence: number;
    beats: {
      time: number;
      drumType: string | null;
      energy: number;
      isDownbeat?: boolean;
      bpm?: number;
    }[];
    sections: { type: string; start: number; end: number; energy: number }[];
    energyCurve: { time: number; value: number }[];
    amplitudeEnvelope: number[];
  };
  spectral_centroid?: number[];
  spectral_rolloff?: number[];
  spectral_bandwidth?: number[];
  zero_crossing_rate?: number[];
  estimated_key?: string | null;
  key_confidence?: number | null;
  key_confidence_r?: number | null;
  key_runner_up?: string | null;
  key_runner_up_r?: number | null;
  chroma_frames?: {
    fps?: number;
    t0?: number;
    pc?: number[];
    conf?: number[];
    [key: string]: unknown;
  } | null;
  schema_version?: number;
  computed_on?: string | null;
  suggested_visualization?: string;
  suggested_visualization_confidence?: number;
  suggested_visualization_candidates?: { value: string; confidence: number }[];
  suggested_kinetic_preset?: string;
  suggested_kinetic_preset_confidence?: number;
  suggested_theme_seed?: string;
  suggested_theme_seed_confidence?: number;
  metadata?: {
    backend?: string;
    computed_on?: string;
    duration_samples?: number;
    hop_length?: number;
    frame_length?: number;
    sonara?: {
      loudness_lufs?: number;
      rms_mean?: number;
      rms_max?: number;
      dynamic_range_db?: number;
      bpm_raw?: number;
      n_beats?: number;
      onset_density?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

export interface EnsureAnalysisResponse {
  status: string;
  analysis: AudioAnalysisResult;
}

export interface TimingMetadata {
  filename: string;
  duration: number;
  bpm: number;
  bpmConfidence: number;
  beats: {
    time: number;
    drumType: string | null;
    energy: number;
    isDownbeat?: boolean;
    bpm?: number;
  }[];
  sections: { type: string; start: number; end: number; energy: number }[];
  energyCurve: { time: number; value: number }[];
  amplitudeEnvelope: number[];
}

export interface StemsAnalysisResponse {
  stems: Record<string, {
    file: string;
    url: string;
    duration: number;
    sample_rate: number;
    rms_mean: number;
    rms_std: number;
    centroid_mean: number;
    zcr_mean: number;
    energy_curve: number[];
    energy_curve_points: number;
  }>;
  separated: boolean;
}

export interface StemsStatusResponse {
  tracks: Record<string, { has_stems: boolean; stems: string[] }>;
}

export interface AudioFileListItem {
  filename: string;
  relative_path: string;
  folder: string;
  size_bytes: number;
  modified: number;
}

export interface AudioBackendsResponse {
  available: string[];
  default: string;
}

export interface AudioAnalysisSummary {
  filename: string;
  tempo_bpm: number | null;
  duration_seconds: number | null;
  beat_count: number | null;
  confidence: number | null;
  sections: { type: string; start: number; end: number; energy: number }[];
  has_beat_times: boolean;
  has_onset_times: boolean;
  has_energy_curve: boolean;
  has_spectral: boolean;
  job_id: string | null;
  stored_path: string | null;
}

export interface AnalyzeAllPendingResponse {
  status: string;
  analyzed: number;
  total: number;
  files: { filename: string; bpm: number; beats: number; confidence: number }[];
  errors: { filename: string; error: string }[];
}

export interface LyricLine {
  start: number;
  end: number;
  text: string;
  section?: string;
  words?: { word: string; start: number; end: number }[];
}

export interface TranscriptionResult {
  filename: string;
  language: string;
  duration: number;
  segments: LyricLine[];
}

export interface TracksWithLyricsResponse {
  id: string;
  title: string;
  artist: string;
  filename: string;
  duration_seconds: number;
  lyric_count: number;
}

export interface RenameAudioResponse {
  success: boolean;
  new_filename: string;
}

export interface TrimRange {
  start: number;
  end: number;
}

export interface TrimAudioResponse {
  success: boolean;
  filename: string;
  stored_path: string;
  relative_path: string;
  size_bytes: number;
  duration: number;
  source_filename: string;
  source_duration: number;
  mode: "keep" | "remove";
  kept: TrimRange[];
  lossless: boolean;
  render_s: number;
  message: string;
}

export interface ExtractAudioResponse {
  success: boolean;
  filename: string;
  relative_path: string;
  stored_path: string;
  size_bytes: number;
  render_s: number;
  lossless: boolean;
  source_codec: string | null;
  source_sample_rate: string | null;
  message: string;
}

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
  visualization?: Record<string, unknown>;
}

export interface VideoGenerateResponse {
  success: boolean;
  job_id: string | null;
  output_path: string | null;
  section: string;
  error: string | null;
  message: string | null;
}

export interface KineticVideoRequest {
  audio_filename: string;
  duration: number;
  preset_id: string;
  lyrics?: LyricLine[];
  prompt?: string;
}

export interface KineticVideoResponse {
  success: boolean;
  job_id: string | null;
  output_path: string | null;
  section: string;
  error: string | null;
  message: string | null;
}

export interface EnhanceStemsResponse {
  success: boolean;
  input_filename: string;
  model: string;
  stems: string[];
  wav_path: string | null;
  mp3_path: string | null;
  steps: Record<string, unknown>[];
  error: string | null;
  duration: number;
}

export interface EnhanceStemsParams {
  filename: string;
  model?: string;
  target_peak_dbfs?: number;
  attack_ms?: number;
  release_ms?: number;
  ratio?: number;
  threshold_dbfs?: number;
  reverb_decay?: number;
  reverb_mix?: number;
  delay_mix?: number;
  stereo_widen_amount?: number;
  master_ceiling_dbfs?: number;
  output_format?: "wav" | "mp3" | "both";
  pre_highpass_hz?: number;
  vocal_spectral_gate_threshold_db?: number;
  vocal_dynamic_eq_max_reduction_db?: number;
  vocal_expander?: boolean;
  deess_freq_hz?: number;
  air_boost_gain_db?: number;
  air_boost_freq_hz?: number;
  vocal_balance_db?: number;
  parallel_weight_bus_db?: number;
  sidechain_pocket_eq_enabled?: boolean;
}

// Mastering
export interface MasterMeasureResponse {
  filename: string;
  integrated_lufs: number | null;
  true_peak_dbtp: number | null;
  lra_lu: number | null;
  error: string | null;
}

export type MasterTarget = "spotify" | "apple" | "competitive" | "amazon";

export interface MasterRequest {
  filename: string;
  target_lufs?: MasterTarget;
  ceiling_dbtp?: number;
  tone_fixes?: boolean;
  gain_trim_db?: number;
  finishing?: boolean;
  sub_cut_db?: number;
  presence_db?: number;
}

export interface MasterFinishPreset {
  label: string;
  sub_cut_db: number;
  presence_db: number;
}

export interface MasterApplied {
  gain_db: number;
  gain_trim_db?: number;
  target_lufs: number;
  ceiling_dbtp: number;
  tone_fixes: boolean;
  gain_passes?: number;
  finishing?: boolean;
  sub_cut_db?: number;
  presence_db?: number;
  band_energy?: {
    before: { sub_db: number; presence_db: number };
    after: { sub_db: number; presence_db: number };
  };
}

export interface MasterResponse {
  filename: string;
  mastered_path: string | null;
  error: string | null;
  before: MasterMeasureResponse | null;
  after: MasterMeasureResponse | null;
  applied: MasterApplied | null;
}

// ============================================================================
// Remix Types
// ============================================================================

export interface RemixSource {
  track: string;
  stems_available: string[];
  bpm?: number;
  duration?: number;
  first_audible_bar?: number;
}

export interface RemixProbe {
  track: string;
  bpm: number;
  key: string;
  key_confident: boolean;
  duration: number;
  first_audible_bar?: number;
}

export interface RemixLayerSpec {
  track: string;
  stem: string;
  gain_db: number;
  key_shift_semitones: number;
  source_start_bar: number;
  lowpass_hz?: number;
  brightness_db?: number;
}

export interface RemixSlotSpec {
  layers: RemixLayerSpec[];
  bars: number;
  crossfade_bars: number;
}

export interface RemixRecipeSpec {
  name: string;
  target_bpm: number;
  slots: RemixSlotSpec[];
  beats_per_bar?: number;
}

export interface RemixRecipeRoundTrip {
  recipe: RemixRecipeSpec;
  warnings: string[];
}

export interface RemixPreview {
  timeline: {
    slot: number;
    layers: {
      track: string;
      stem: string;
      gain_db: number;
      key_shift_semitones: number;
      source_start_bar: number;
      start_beat: number;
      end_beat: number;
      stretch_ratio: number;
    }[];
    bars: number;
    crossfade_bars: number;
  }[];
  per_source: Record<string, {
    stretch_ratio: number;
    measured_loudness: number;
    measured_duration: number;
  }>;
  warnings: {
    type: string;
    message: string;
    layer?: RemixLayerSpec;
  }[];
}

export interface RemixPreviewAudio {
  url: string;
  duration: number;
  sample_rate: number;
}

export interface RemixDraft {
  recipe: RemixRecipeSpec;
  explanation: string;
  warnings: string[];
  changes?: string[];
}

export interface RemixBuildResult {
  name: string;
  stems: Record<string, string>;
  duration: number;
  manifest: {
    slots: RemixSlotSpec[];
    target_bpm: number;
    beats_per_bar: number;
  };
  warnings: string[];
}

export interface RemixSummary {
  name: string;
  created_at: string;
  target_bpm: number;
  slots: RemixSlotSpec[];
  duration: number;
  stems: string[];
}

export interface RemixLineageEntry {
  remix_name: string;
  created_at: string;
  source_tracks: string[];
}

export interface RemixTrackLineage {
  track: string;
  remixes: RemixLineageEntry[];
}

export interface RemixEnhanceResult {
  success: boolean;
  remix_name: string;
  mastered_path: string | null;
  error: string | null;
  loudnorm: {
    lufs_before: number | null;
    gain_db: number;
    peak_after: number;
  } | null;
}

export interface RemixJobAccepted {
  job_id: string;
  name: string;
  status: "queued" | "running";
}

export interface RemixJobStatus {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  result?: RemixBuildResult;
  error?: string;
}

export interface RemixVersion {
  name: string;
  created_at: string;
  recipe: RemixRecipeSpec;
}

export type StemName = "vocals" | "drums" | "bass" | "other";

export const STEM_NAMES: StemName[] = ["vocals", "drums", "bass", "other"];

// ============================================================================
// Log Types
// ============================================================================

export interface LogInfo {
  name: string;
  size: number;
  modified: number;
}

export interface LogContent {
  name: string;
  content: string;
  size: number;
}

export interface LogAnalyticsSummary {
  total_lines: number;
  error_count: number;
  warning_count: number;
  time_range: { start: string; end: string } | null;
}

export interface LogAnalyticsTrendPoint {
  timestamp: string;
  count: number;
}

export interface LogAnalyticsPatterns {
  top_errors: { pattern: string; count: number }[];
  top_warnings: { pattern: string; count: number }[];
  error_rate_over_time: LogAnalyticsTrendPoint[];
}

export interface LogAnalyticsErrorPattern {
  pattern: string;
  count: number;
  examples: string[];
}

export interface LogAnalyticsErrors {
  patterns: LogAnalyticsErrorPattern[];
  total: number;
}

export interface LogAnalyticsEvent {
  timestamp: string;
  level: string;
  message: string;
  source: string;
}

// ============================================================================
// Data Persistence Types
// ============================================================================

export interface StoredPrompt {
  id: string;
  prompt: string;
  negative_prompt?: string;
  parameters: Record<string, unknown>;
  tags: string[];
  favorite: boolean;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface AIVisualRecord {
  id: string;
  prompt: string;
  image_url: string;
  thumbnail_url?: string;
  model: string;
  parameters: Record<string, unknown>;
  tags: string[];
  created_at: string;
}

export interface GenerationSession {
  id: string;
  name: string;
  description?: string;
  track_filename?: string;
  prompt?: string;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

export interface APITrack {
  id: string;
  title: string;
  artist: string;
  filename: string;
  duration_seconds: number;
  has_lyrics: boolean;
}

export interface PromptHistoryEntry {
  prompt_id: string;
  version: number;
  prompt: string;
  negative_prompt?: string;
  parameters: Record<string, unknown>;
  created_at: string;
}

// ============================================================================
// Database Admin Types
// ============================================================================

export interface DatabaseOverview {
  tables: Record<string, DatabaseTableSummary>;
  total_rows: number;
  size_bytes: number;
}

export interface DatabaseTableSummary {
  name: string;
  row_count: number;
  size_bytes: number;
  columns: string[];
}

export interface DatabaseTableDetail {
  name: string;
  row_count: number;
  size_bytes: number;
  columns: DatabaseColumnInfo[];
  indexes: DatabaseIndexInfo[];
  foreign_keys: { column: string; references_table: string; references_column: string }[];
  sample_rows: Record<string, unknown>[];
}

export interface DatabaseColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  primary_key: boolean;
}

export interface DatabaseIndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface DatabaseSchema {
  tables: Record<string, {
    columns: DatabaseColumnInfo[];
    indexes: DatabaseIndexInfo[];
    row_count: number;
  }>;
}

export interface DatabaseMigrationInfo {
  version: string;
  description: string;
  applied_at: string;
}

export interface DatabaseIntegrityResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  table_counts: Record<string, number>;
}

export interface DatabaseMaintenanceResult {
  action: DatabaseMaintenanceAction;
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export type DatabaseMaintenanceAction =
  | "vacuum"
  | "analyze"
  | "reindex"
  | "checkpoint"
  | "cleanup_old_jobs"
  | "cleanup_old_logs";

// ============================================================================
// GPU / 3D Types
// ============================================================================

export interface GPUSnapshot {
  timestamp: string;
  gpu_name: string;
  driver_version: string;
  memory_total_mb: number;
  memory_used_mb: number;
  memory_free_mb: number;
  temperature_c?: number;
  utilization_percent: number;
  power_draw_w?: number;
  power_limit_w?: number;
}

export interface GPUProcessInfo {
  pid: number;
  name: string;
  memory_mb: number;
  gpu_utilization_percent: number;
}

export interface GPUHistoryPoint {
  timestamp: string;
  memory_used_mb: number;
  utilization_percent: number;
  temperature_c?: number;
}

export interface GPUStats {
  current: GPUSnapshot | null;
  history: GPUHistoryPoint[];
  processes: GPUProcessInfo[];
}

export interface Generate3DRequest {
  prompt: string;
  model?: string;
  seed?: number;
  steps?: number;
  guidance_scale?: number;
}

export interface Generate3DResponse {
  success: boolean;
  model_url?: string;
  error?: string;
  job_id?: string;
}

// ============================================================================
// Vision Types
// ============================================================================

export interface VisionOCRResponse {
  text: string;
  blocks: {
    text: string;
    bbox: [number, number, number, number];
    confidence: number;
  }[];
}

export interface AnalyzeVisualizerResponse {
  mode: string;
  quality_score: number;
  issues: string[];
  suggestions: string[];
}

// ============================================================================
// Native (Blender/Unity) Types
// ============================================================================

export interface FFmpegProcessInfo {
  pid: number;
  command: string;
  started_at: string;
  status: "running" | "completed" | "failed";
  progress?: number;
}

export interface NativeOpenStatus {
  blender_available: boolean;
  unity_available: boolean;
  blender_version?: string;
  unity_version?: string;
  ffmpeg_available: boolean;
  ffmpeg_version?: string;
}

// ============================================================================
// Media Inspection Types
// ============================================================================

export interface MediaProbeResponse {
  format: {
    filename: string;
    format_name: string;
    format_long_name: string;
    duration: number;
    size: number;
    bit_rate: number;
    probe_score: number;
  };
  streams: {
    index: number;
    codec_name: string;
    codec_type: "video" | "audio" | "subtitle" | "data";
    width?: number;
    height?: number;
    sample_rate?: number;
    channels?: number;
    channel_layout?: string;
    bit_rate?: number;
    duration?: number;
    tags?: Record<string, string>;
  }[];
}

export interface LoudnessResponse {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  output_i: number;
  output_tp: number;
  output_lra: number;
  output_thresh: number;
  normalization_type: string;
  target_offset: number;
}

export interface WaveformResponse {
  peaks: number[];
  duration: number;
  sample_rate: number;
  channels: number;
}

export interface ThumbnailAtTimeRequest {
  path: string;
  time: number;
  width?: number;
  height?: number;
}

export interface ThumbnailAtTimeResponse {
  image_base64: string;
  mime_type: string;
}

export interface RegenerateCoverResponse {
  success: boolean;
  cover_path: string | null;
  error: string | null;
}

// ============================================================================
// Media Library Types
// ============================================================================

export interface Collection {
  id: string;
  name: string;
  description?: string;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionDetail extends Collection {
  items: CollectionItem[];
}

export interface CollectionItem {
  id: string;
  filename: string;
  file_type: "image" | "video" | "audio" | "other" | "3d";
  relative_path: string;
  cover_image?: string;
  metadata: Record<string, unknown> | null;
  added_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  item_count: number;
}

export interface TrashItem {
  id: string;
  filename: string;
  file_type: "image" | "video" | "audio" | "other" | "3d";
  relative_path: string;
  original_path: string;
  deleted_at: string;
  size_bytes: number;
  metadata: Record<string, unknown> | null;
}

export interface FavoriteToggleResponse {
  favorite: boolean;
  item_id: string;
}

export interface CreateCollectionRequest {
  name: string;
  description?: string;
}

export interface CreateTagRequest {
  name: string;
  color?: string;
}

export interface SetItemTagsRequest {
  item_id: string;
  tag_ids: string[];
}

export interface MoveToTrashRequest {
  item_id: string;
}

export interface ItemOrganization {
  collections: Collection[];
  tags: Tag[];
  favorite: boolean;
  in_trash: boolean;
}

// ============================================================================
// Diagnostics Types
// ============================================================================

export interface DiagnosticsResponse {
  backend: "online" | "offline";
  adapters: Record<string, AdapterHealth>;
  queue: QueueStats;
  system: SystemHealth;
  timestamp: string;
}

export interface MemoryDiagnostics {
  python: {
    rss_mb: number;
    vms_mb: number;
    percent: number;
  };
  system: {
    total_gb: number;
    available_gb: number;
    percent: number;
  };
  processes: {
    pid: number;
    name: string;
    memory_mb: number;
  }[];
}

export interface DiagnosticsModelsResponse {
  ollama: {
    name: string;
    size: string;
    modified: string;
    digest: string;
  }[];
  huggingface: {
    name: string;
    size: string;
  }[];
}

// ============================================================================
// Ollama Types
// ============================================================================

export interface OllamaModel {
  name: string;
  size: number;
  modified_at?: string;
  capabilities?: string[];
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  vram_estimate_mb?: number;
  benchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
  codingBenchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
  verified?: boolean;
  verified_features?: string[];
  performance?: { tokens_per_sec?: number; vision_latency_sec?: number };
  verification_notes?: string;
  broken_reason?: string;
  [key: string]: unknown;
}

export interface UnifiedModel {
  source: "ollama" | "atomic-chat";
  id: string;
  name: string;
  size: number;
  digest: string;
  capabilities: string[];
  supports_tools: boolean;
  supports_vision: boolean;
  supports_thinking: boolean;
  supports_embedding: boolean;
  supports_rerank: boolean;
  vram_required: number;
  is_available: boolean;
  verified: boolean | undefined;
  verified_features: string[];
  performance: { tokens_per_sec?: number; vision_latency_sec?: number };
  verification_notes: string;
  broken_reason: string;
  chat_eligible: boolean;
  task_routes: string[];
  benchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
  [key: string]: unknown;
}

export interface TaskModelRoute {
  engine: string;
  model: string;
  reason: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: Date;
  tool_calls?: { name: string; arguments: Record<string, unknown> }[];
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
    details: { rule: string; description: string; weight: number; passed: boolean }[];
    metrics: {
      lines: number;
      chars: number;
      balanced_braces: boolean;
      node_valid: boolean | null;
      node_error: string | null;
    };
  };
  preview: string;
  error: string | null;
  timestamp: string;
}

export interface HardwareBenchmarkMetrics {
  median_latency_ms?: number;
  avg_latency_ms?: number;
  min_latency_ms?: number;
  max_latency_ms?: number;
  latency_q1_ms?: number;
  latency_q3_ms?: number;
  tokens_per_second?: number;
  output_tokens?: number;
  prompt_tokens?: number;
}

export interface HardwareBenchmarkRun {
  run_id: string;
  engine: string;
  model: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  duration_ms?: number;
  iterations?: number;
  successful_iterations?: number;
  error?: string | null;
  metrics?: HardwareBenchmarkMetrics;
}

export interface HardwareBenchmarkSummary {
  model: string;
  median_latency_ms: number;
  tokens_per_second: number | null;
  runs: number;
  last_run_at: string;
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
    details: { rule: string; passed: boolean; weight: number }[];
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

export interface OllamaChatResponse {
  response: string;
  model: string;
  toolCalls: number;
  toolDetails?: {
    name: string;
    arguments: Record<string, unknown>;
    result: string;
  }[];
}

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
    keyframes: {
      at: number;
      position: [number, number, number];
      target: [number, number, number];
      easing?: string;
    }[];
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

// ============================================================================
// Sub-agent Types
// ============================================================================

export interface SubAgentTask {
  task_id: string;
  prompt: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  created_at: string;
  started_at?: string;
  completed_at?: string;
  result?: string;
  error?: string;
}

export interface SubAgentRunRequest {
  prompt: string;
  model?: string;
  max_turns?: number;
}

export interface SubAgentRunResponse {
  task_id: string;
  status: string;
}

export interface SubAgentEvent {
  type: "content" | "tool_call" | "tool_result" | "done" | "error";
  data: unknown;
  timestamp: string;
}

// ============================================================================
// Integration Types
// ============================================================================

export interface ComfyUIStatus {
  running: boolean;
  pid?: number;
  port?: number;
  url?: string;
  version?: string;
  models_loaded?: number;
  queue_depth?: number;
}

export interface ComfyUIStartResponse {
  success: boolean;
  pid?: number;
  port?: number;
  url?: string;
  error?: string;
}

export interface ComfyUIStopResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ComfyUIUpdateResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface IntegrationStatus {
  comfyui: ComfyUIStatus;
  ollama: { online: boolean; engine: string };
  atomic_chat: { online: boolean; version?: string };
  go_services: Record<string, { online: boolean; url?: string }>;
}

export interface AtomicChatStatus {
  online: boolean;
  version?: string;
  model?: string;
  models_available?: string[];
}

export interface VRAMStatus {
  total_mb: number;
  used_mb: number;
  free_mb: number;
  percent: number;
  processes: GPUProcessInfo[];
}

export interface MusicVideoStyle {
  id: string;
  name: string;
  description: string;
  preview_image?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface UpscaleResponse {
  success: boolean;
  output_path?: string;
  error?: string;
}

// ============================================================================
// MCP + HyperFrames Types
// ============================================================================

export interface MCPContext {
  character?: Record<string, unknown>;
  scene?: Record<string, unknown>;
  audio?: Record<string, unknown>;
  visualization?: Record<string, unknown>;
}

export interface CompileStoryboardRequest {
  storyboard: Record<string, unknown>;
  track?: { bpm?: number; duration?: number };
}

export interface CompileStoryboardResponse {
  success: boolean;
  composition?: string;
  error?: string;
}

export interface HyperFramesAudioPayload {
  track_url: string;
  analysis_url: string;
  stems_urls: Record<string, string>;
  timing_metadata: TimingMetadata;
}

export interface HyperFramesStatus {
  available: boolean;
  version?: string;
  compositions: string[];
}

export interface HyperFramesExample {
  name: string;
  description: string;
  composition_url: string;
}

export interface RenderHyperFramesResponse {
  success: boolean;
  output_path?: string;
  job_id?: string;
  error?: string;
}

// ============================================================================
// MCP Skills Types
// ============================================================================

export interface SkillInfo {
  name: string;
  description: string;
  version: string;
  author?: string;
  tags: string[];
}

export interface SkillContent {
  name: string;
  description: string;
  version: string;
  code: string;
  dependencies?: string[];
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ExecuteToolRequest {
  tool_name: string;
  arguments: Record<string, unknown>;
  timeout_ms?: number;
}

export interface ExecuteToolResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  duration_ms: number;
}

// ============================================================================
// Agent Loop Types
// ============================================================================

export interface AgentTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { name: string; arguments: Record<string, unknown> }[];
  tool_result?: unknown;
}

export interface AgentLoopOptions {
  max_turns?: number;
  model?: string;
  temperature?: number;
  tools?: ToolDefinition[];
  system_prompt?: string;
}

export interface AgentLoopResult {
  success: boolean;
  turns: AgentTurn[];
  final_response: string;
  error?: string;
}

// ============================================================================
// Video Render Types
// ============================================================================

export interface RenderEngineInfo {
  name: string;
  available: boolean;
  version?: string;
  formats: string[];
  max_resolution?: string;
}

export interface RenderResponse {
  success: boolean;
  job_id?: string;
  output_path?: string;
  error?: string;
  duration_ms?: number;
}

export interface MatrixArtifact {
  engine: string;
  format: string;
  resolution: string;
  path: string;
  size_bytes: number;
  duration_ms: number;
}

export interface ExportMatrixResponse {
  success: boolean;
  artifacts: MatrixArtifact[];
  errors: { engine: string; format: string; error: string }[];
  total_duration_ms: number;
}

// ============================================================================
// Docs Types
// ============================================================================

export interface DocSearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface DocsBootstrap {
  structure: { name: string; path: string; children?: { name: string; path: string }[] }[];
  index: Record<string, { title: string; path: string }>;
}

export interface ProjectStructure {
  directories: { name: string; path: string; children?: ProjectStructure["directories"] }[];
  files: { name: string; path: string; size: number }[];
}

// ============================================================================
// Unity Types
// ============================================================================

export interface UnityStatus {
  running: boolean;
  version?: string;
  project_path?: string;
  scene_loaded?: string;
}

export interface UnityCommandResult {
  success: boolean;
  result?: unknown;
  error?: string;
  command: string;
}

export interface UnityCommandInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}