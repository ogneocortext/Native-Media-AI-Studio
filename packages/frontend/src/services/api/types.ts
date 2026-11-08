/**
 * Comprehensive API response type definitions for Native Media AI Studio.
 * These types mirror the backend Pydantic models exactly.
 * Single source of truth for frontend-backend contracts.
 */

import type { QueueStats } from "@shared/types";
import type { AudioData } from "../../features/visualizer/types";

export type { Job, JobType, JobStatus, QueueStats, QueueMetrics, PortConfig } from "@shared/types";

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
  /** True when the upload arrived as video and was converted to .m4a. */
  converted?: boolean;
  /** The video filename the user dropped, when `converted` is true. */
  source_filename?: string | null;
  /** True when the audio was remuxed with `-c:a copy` (bit-identical). */
  lossless?: boolean;
  /** True when an existing library file with the same content was reused. */
  deduplicated?: boolean;
  /** Output-relative path (e.g. "audio/video-extracted/x.m4a") for serving. */
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
  /** Absolute filesystem paths per stem — `stems` carries playback URLs. */
  stems_paths?: Record<string, string>;
}

export interface SeparationQualityOptions {
  mode?: "single" | "hierarchical";
  segment_size?: number; // seconds; clamped to the model's trained max
  overlap?: number; // 0.25–0.75
  denoise?: boolean;
}

export interface AudioStemsResponse {
  audio_file: string;
  stems: Record<string, string>;
  stems_mp3?: Record<string, string>;
  stems_paths?: Record<string, string>;
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
  /** Output-relative path (e.g. "audio/track.wav"), for /api/audio/file/*. */
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
  // Key detection (schema v2+). key_confidence is the clamped display value;
  // key_confidence_r is the raw correlation used by the chroma->hue mapper.
  estimated_key?: string | null;
  key_confidence?: number | null;
  key_confidence_r?: number | null;
  key_runner_up?: string | null;
  key_runner_up_r?: number | null;
  // Tier 2 chroma: per-frame 12-bin pitch-class vectors for the visualizer.
  // Consumed by useKeyPalette; kept out of the analysis UI (large arrays).
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
  stems: Record<
    string,
    {
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
    }
  >;
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
  words?: {
    word: string;
    start: number;
    end: number;
  }[];
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
  /** Visualization config (mode, palette, …) for the `visualization` method. */
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
  /** Manual trim in dB applied after normalization, before limiting. */
  gain_trim_db?: number;
  /** Apply corrective-balance finishing chain before loudness normalization. */
  finishing?: boolean;
  /** dB of low-shelf cut at 120 Hz (sub tame). Only applied when finishing. */
  sub_cut_db?: number;
  /** dB of peaking lift at 3.2 kHz (vocal presence). Only applied when finishing. */
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
  model: string;
  stems: Record<StemName, boolean>;
  /** BPM from the cached probe, when one exists. */
  bpm?: number | null;
  duration_sec?: number | null;
  first_audible_sec?: number | null;
  /** B6: the library filename this stem directory joined to, when
   *  unambiguous. Lets a picker speak the library's identity. */
  library_file?: string;
}

export interface RemixProbe {
  track: string;
  bpm: number;
  duration_sec: number;
  first_audible_sec: number;
  /** Advisory only. Detection is unreliable on this material - see key_confident. */
  key_advisory: string;
  key_correlation: number;
  chroma_flatness: number;
  key_confident: boolean;
  beat_count: number;
  analysed_stem: StemName;
}

export interface RemixLayerSpec {
  track: string;
  stem: StemName;
  gain_db: number;
  key_shift_semitones: number;
  source_start_bar: number;
  // B4 tone shaping; omitted/None leaves the stem untouched, and the
  // renderer treats them the same way.
  lowpass_hz?: number | null;
  brightness_db?: number | null;
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
  beats_per_bar: number;
  key?: string | null;
  overwrite?: boolean;
}

export type RemixRecipeRoundTrip = RemixRecipeSpec;

export interface RemixPreview {
  duration_sec: number;
  total_bars: number;
  bar_seconds: number;
  sample_rate: number;
  stretch_ratios: Record<string, number>;
  layers: {
    track: string;
    stem: StemName;
    source_bpm: number;
    measured_rms_db: number;
    stretch_ratio: number;
    source_start_bar: number;
  }[];
  warnings: string[];
  /** Same facts as `warnings`, structured for agents:
   * {code, layer_ref, field, measured_rms_db, suggestion}. */
  warnings_detail?: {
    code: string;
    layer_ref: string;
    field: string;
    measured_rms_db: number;
    suggestion: string;
  }[];
}

export interface RemixPreviewAudio {
  /** Playable URL for the excerpt. */
  url: string;
  duration_sec: number;
  /** True when the excerpt is shorter than the arrangement. */
  truncated: boolean;
  warnings: string[];
}

export interface RemixDraft {
  /** The exact /build request shape, ready for review then render. */
  recipe: RemixRecipeSpec;
  explanation: string;
  warnings: string[];
  model_used: string | null;
  source: "ollama" | "heuristic";
  /** R1: human-readable diff of base vs revised; [] for fresh drafts. */
  changes: string[];
}

export interface RemixBuildResult {
  name: string;
  directory: string;
  stems: Record<StemName, string>;
  duration_sec: number;
  manifest: Record<string, unknown>;
  warnings: string[];
}

export interface RemixSummary {
  name: string;
  duration_sec: number | null;
  target_bpm: number | null;
  source_tracks: string[];
  stems: string[];
  has_enhanced: boolean;
}

export interface RemixLineageEntry extends RemixSummary {
  role: "primary" | "contributor";
  /** null when the manifest cannot round-trip; see the backend note. */
  recipe: RemixRecipeRoundTrip | null;
}

export interface RemixTrackLineage {
  track: string;
  remixes: RemixLineageEntry[];
}

export interface RemixEnhanceResult {
  name: string;
  output_dir: string;
  wav_path: string | null;
  mp3_path: string | null;
  duration_sec: number;
  steps: { step: number; name: string }[];
  error: string | null;
}

export interface RemixJobAccepted {
  job_id: string;
  kind: string;
  label: string;
  state: string;
}

export interface RemixJobStatus {
  job_id: string;
  kind: "build" | "enhance";
  label: string;
  /**
   * False for work with no safe point to stop at (an enhance runs
   * inside one call), so the client can hide Cancel rather than
   * offer a button that would only earn a 409.
   */
  cancellable?: boolean;
  state: "queued" | "running" | "cancelling" | "done" | "failed" | "cancelled";
  /** Set when the backend capped a wedged job and reported it failed. */
  timed_out?: boolean;
  progress?: string | null;
  /** The build/enhance payload, present once `state` is `done`. */
  result?: RemixBuildResult | RemixEnhanceResult;
  error?: string | null;
  elapsed_sec: number;
  started_at: number;
  finished_at: number | null;
}

export interface RemixVersion {
  version: number;
  /** True for the live render, false for an archived one. */
  current: boolean;
  duration_sec?: number | null;
  target_bpm?: number | null;
  total_bars?: number | null;
  source_tracks?: string[];
  stems: string[];
  has_enhanced: boolean;
}

export type StemName = "vocals" | "drums" | "bass" | "other";

// ============================================================================
// Log Types
// ============================================================================

export interface LogInfo {
  log_directory: string;
  files: Record<
    string,
    {
      path: string;
      size_bytes: number;
      size_human: string;
      modified?: number;
    }
  >;
}

export interface LogContent {
  log: string;
  lines: number;
  content: string[];
}

export interface LogAnalyticsSummary {
  total_events: number;
  last_event_at: string | null;
  last_cleanup_at: string | null;
  levels: { level: string; count: number }[];
  top_loggers: { logger: string; count: number }[];
  top_messages: { message: string; count: number; level: string }[];
  sources: { source: string; count: number }[];
}

export interface LogAnalyticsTrendPoint {
  ts_iso: string;
  ts_ms: number;
  level: string;
  logger: string;
  message: string;
}

export interface LogAnalyticsPatterns {
  levels: { level: string; count: number }[];
  loggers: { logger: string; count: number }[];
  messages: { message: string; count: number; level: string }[];
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

export interface LogAnalyticsEvent {
  ts_iso: string;
  ts_ms: number;
  level: string;
  logger: string;
  message: string;
  source: string;
}

// ============================================================================
// Data Persistence Types
// ============================================================================

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

// ============================================================================
// Database Admin Types
// ============================================================================

export interface DatabaseOverview {
  path: string;
  exists: boolean;
  schema_version: number;
  target_schema_version: number;
  journal_mode: string;
  page_size: number;
  page_count: number;
  freelist_count: number;
  /** Free pages times page size — what VACUUM would return to the filesystem. */
  reclaimable_bytes: number;
  file_bytes: number;
  wal_bytes: number;
  shm_bytes: number;
  table_count: number;
  view_count: number;
  index_count: number;
  tables: DatabaseTableSummary[];
  last_activity: Record<string, string | null>;
}

export interface DatabaseTableSummary {
  name: string;
  type: string;
  /** Exact COUNT(*). -1 means the table could not be read. */
  rows: number;
}

export interface DatabaseTableDetail {
  name: string;
  type: string;
  rows: number;
  columns: DatabaseColumnInfo[];
  indexes: DatabaseIndexInfo[];
  /** dbstat page bytes for the table + its indexes; null when dbstat is unavailable. */
  indexes_bytes: number | null;
}

export interface DatabaseColumnInfo {
  name: string;
  type: string;
  notnull: boolean;
  default: string | null;
  primary_key: boolean;
}

export interface DatabaseIndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface DatabaseSchema {
  schema_version: number;
  target_schema_version: number;
  up_to_date: boolean;
  migrations: DatabaseMigrationInfo[];
}

export interface DatabaseMigrationInfo {
  version: number;
  applied: boolean;
}

export interface DatabaseIntegrityResult {
  ok: boolean;
  /** "quick_check" or "integrity_check". */
  mode: string;
  duration_ms: number;
  messages: string[];
}

export interface DatabaseMaintenanceResult {
  action: string;
  ok: boolean;
  duration_ms: number;
  before_bytes: number;
  after_bytes: number;
  freed_bytes: number;
  detail: Record<string, unknown>;
}

export type DatabaseMaintenanceAction =
  "vacuum" | "wal-checkpoint" | "analyze" | "prune-logs" | "prune-telemetry" | "prune-resources";

// ============================================================================
// GPU / 3D Types
// ============================================================================

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
  processes?: {
    pid: number;
    name: string;
    used_mb: number | null;
    kind: string;
  }[];
  memory_available?: boolean;
  vram_total_mb?: number;
  vram_used_mb?: number;
  vram_free_mb?: number;
  temperature?: number;
  gpu_utilization_pct?: number;
}

export interface GPUProcessInfo {
  pid: number;
  name: string;
  mem_mb: number;
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
  cfg?: number;
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
  text: string;
  model: string;
  mode: string;
  error?: string;
}

// ============================================================================
// Native (Blender/Unity) Types
// ============================================================================

export interface FFmpegProcessInfo {
  pid: number;
  cpu?: number;
  working_set_mb?: number;
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
  path: string;
  relative_path?: string;
  probe?: Record<string, unknown>;
  error?: string;
}

export interface LoudnessResponse {
  path: string;
  relative_path?: string;
  integrated_lufs?: number | null;
  loudness_range?: number | null;
  true_peak?: number | null;
  error?: string | null;
}

export interface WaveformResponse {
  path: string;
  relative_path?: string;
  peaks: number[];
  count: number;
  duration?: number | null;
  error?: string | null;
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

export interface RegenerateCoverResponse {
  path: string;
  relative_path?: string;
  cover_image?: string | null;
  error?: string | null;
}

// ============================================================================
// Media Library Types
// ============================================================================

export interface Collection {
  id: string;
  name: string;
  cover_path: string | null;
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
  color: string;
  created_at: string;
}

export interface TrashItem {
  relative_path: string;
  file_type: string;
  deleted_at: string;
  expires_at: string;
}

export interface FavoriteToggleResponse {
  relative_path: string;
  favorited: boolean;
}

export interface CreateCollectionRequest {
  name: string;
  cover_path?: string | null;
}

export interface CreateTagRequest {
  name: string;
  color?: string;
}

export interface SetItemTagsRequest {
  relative_paths: string[];
  tag_ids: string[];
}

export interface MoveToTrashRequest {
  relative_path: string;
}

export interface ItemOrganization {
  tags: Record<string, Tag[]>;
  collections: Record<string, Collection[]>;
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
  memory: {
    total_mb: number;
    used_mb: number;
    available_mb: number;
    percent: number;
  };
  top_processes: { pid: number; name: string; mem_mb: number; mem_percent: number }[];
  process_count: number;
}

export interface DiagnosticsModelsResponse {
  loaded: boolean;
  models: DiagnosticsModel[];
  activity?: Record<
    string,
    { task: string; description: string; started_at: number; elapsed_seconds?: number }
  >;
  error?: string;
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
  // Verification fields
  verified?: boolean;
  verified_features?: string[];
  performance?: { tokens_per_sec?: number; vision_latency_sec?: number };
  verification_notes?: string;
  broken_reason?: string;
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
  verified: boolean;
  verified_features: string[];
  performance: { tokens_per_sec?: number; vision_latency_sec?: number };
  verification_notes: string;
  broken_reason: string;
  chat_eligible: boolean;
  task_routes: string[];
  benchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
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
  status: "running" | "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  error_detail?: string;
  created_at: string;
  model?: string;
  has_result?: boolean;
  has_error?: boolean;
  metrics?: {
    tool_calls: number;
    iterations: number;
    tool_usage: Record<string, number>;
    context_truncations: number;
    simulated_context_window?: number;
    dry_run: boolean;
  };
}

export interface SubAgentRunRequest {
  task: string;
  model?: string;
}

export interface SubAgentRunResponse {
  task_id: string;
  status: string;
  model?: string;
}

export interface SubAgentEvent {
  type: "agent_output" | "agent_done" | "agent_error" | "agent_cancelled";
  data: {
    task_id: string;
    text?: string;
    result?: string;
    error?: string;
    error_detail?: string;
    metrics?: {
      tool_calls: number;
      iterations: number;
      tool_usage: Record<string, number>;
      context_truncations: number;
      simulated_context_window?: number;
      dry_run: boolean;
    };
    timestamp: string;
  };
  timestamp?: string;
}

// ============================================================================
// Integration Types
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

export interface ComfyUIStartResponse {
  success: boolean;
  message: string;
  suggestion?: string;
}

export interface ComfyUIStopResponse {
  success: boolean;
  message: string;
  suggestion?: string;
}

export interface ComfyUIUpdateResponse {
  success: boolean;
  message: string;
  output?: string;
  was_running?: boolean;
  restarted?: { success: boolean; message?: string };
  errors?: string[];
  hint?: string;
}

export interface IntegrationStatus {
  name: string;
  status: string;
  url: string;
  mock_mode: boolean;
}

export interface AtomicChatStatus {
  reachable: boolean;
  model?: string;
  model_count?: number;
  reason?: string;
}

export interface VRAMStatus {
  vram?: {
    available: boolean;
    total_mb: number;
    used_mb: number;
    free_mb: number;
    percent: number;
    gpu_utilization: number;
    temperature: number;
    state: string;
    fallback: string;
    name: string;
  };
  manager?: Record<string, unknown>;
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

// ============================================================================
// MCP + HyperFrames Types
// ============================================================================

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

export interface CompileStoryboardRequest {
  storyboard: {
    track?: string;
    title?: string;
    duration?: number;
    scenes: {
      id?: string;
      title?: string;
      description?: string;
      start?: number;
      end?: number;
      duration_seconds?: number;
      palette?: Record<string, string>;
    }[];
  };
  name?: string;
  title?: string;
  audio_path?: string;
  audio_data?: HyperFramesAudioPayload;
}

export interface CompileStoryboardResponse {
  success: boolean;
  composition: string;
  manifest: string;
  scene_count: number;
  duration_seconds: number;
  message: string;
}

export interface HyperFramesAudioPayload {
  fps: number;
  duration: number;
  bands: number;
  totalFrames: number;
  beat_times: number[];
  downbeat_times: number[];
  frames: {
    time: number;
    rms: number;
    energy: number;
    bands: number[];
    isBeat: boolean;
    isDownbeat: boolean;
  }[];
  lyrics: unknown[];
}

export interface HyperFramesStatus {
  test_project: string;
  exists: boolean;
  hyperframes_cli: string;
  cli_available: boolean;
  version: string;
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
  version: string | null;
  server: string | null;
  tools: string[];
  tags: string[];
  uri: string;
  resources: {
    uri: string;
    name: string;
    mimeType: string;
    size: number;
  }[];
}

export interface SkillContent {
  name: string;
  version: string | null;
  server: string | null;
  tools: string[];
  tags: string[];
  frontmatter: Record<string, unknown>;
  body: string;
  resources: {
    uri: string;
    name: string;
    mimeType: string;
    size: number;
  }[];
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface ExecuteToolRequest {
  tool_name: string;
  arguments: Record<string, unknown>;
}

export interface ExecuteToolResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================================
// Agent Loop Types
// ============================================================================

export interface AgentTurn {
  type: "thought" | "tool_call" | "tool_result" | "final" | "error";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: ExecuteToolResponse;
}

export interface AgentLoopOptions {
  model?: string;
  taskType?: "coding" | "vision" | "chat" | "default";
  maxIterations?: number;
  onTurn?: (turn: AgentTurn) => void;
  systemPrompt?: string;
}

export interface AgentLoopResult {
  success: boolean;
  finalResponse: string;
  turns: AgentTurn[];
  iterations: number;
}

// ============================================================================
// Video Render Types
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
  version?: string;
  project?: string;
  description?: string;
  ports?: Record<string, number>;
  vault_docs?: { path: string; title: string; tags: string[] }[];
  quick_start?: Record<string, string>;
  [key: string]: unknown;
}

export interface ProjectStructure {
  root?: string;
  structure?: Record<string, unknown>;
  depth?: number;
  directories?: { name: string; path: string; children?: ProjectStructure["directories"] }[];
  files?: { name: string; path: string; size: number }[];
}

// ============================================================================
// Unity Types
// ============================================================================

export interface UnityStatus {
  online: boolean;
  error?: string;
  status?: unknown;
}

export interface UnityCommandResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface UnityCommandInfo {
  name: string;
  description?: string;
  tags?: string[];
  package?: string;
}
// ============================================================================
// Types recovered from the pre-typed-fetch module files (db2110ca~1)
// that the rewrite moved to types.ts incompletely.
// recovered from pre-typed-fetch rewrite
export interface VideoGenerationResponse {
  success: boolean;
  output_path?: string;
  seed?: number;
  prompt_id?: string;
  message?: string;
}

// recovered from pre-typed-fetch rewrite
export interface GenerationResultResponse {
  status: string;
  success?: boolean;
  output_path?: string;
  prompt_id: string;
  error?: string;
  kind?: string;
}

// recovered from pre-typed-fetch rewrite
export interface GenerationProgressResponse {
  status: string;
  prompt_id: string;
  step?: number;
  total_steps?: number;
  queue_position?: number;
  error?: string;
}

// recovered from pre-typed-fetch rewrite
export interface GenerationPreviewResponse {
  filename?: string;
  subfolder?: string;
  node_id?: string;
  error?: string;
}

// recovered from pre-typed-fetch rewrite
export interface CanvasLoopResponse {
  success: boolean;
  output_path: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  message: string | null;
}

// recovered from pre-typed-fetch rewrite
export interface RouteSceneResponse {
  model: string;
  tier: string;
  reason: string;
  vram_required_mb: number | null;
  cloud_fallback: string | null;
  routing_note: string | null;
}

// recovered from pre-typed-fetch rewrite
export interface AssembleResponse {
  success: boolean;
  output_path: string | null;
  duration: number | null;
  shots_used: number | null;
  render_s: number | null;
  error: string | null;
  message: string | null;
  engine: string | null;
}

// recovered from pre-typed-fetch rewrite
export interface StemVisualizationResponse {
  stems: Record<string, unknown>;
  separated: boolean;
  uniforms: Record<string, StemVisualizationUniform>;
  curve_points: number;
}

// recovered from pre-typed-fetch rewrite
export interface StemVisualizationUniform {
  stem: string;
  energy_curve: number[];
  curve_points: number;
  rms_mean: number;
  rms_std: number;
  centroid_mean: number;
  zcr_mean: number;
  duration: number;
  file: string;
  url: string;
}

/**
 * POST /api/video/lipsync — local MuseTalk lip-sync (D42).
 * Mirrors backend LipSyncRequest: exactly one of video_path / image_path is
 * required; audio_path should be the isolated vocals stem (full mix syncs
 * markedly worse). audio_filename is only a fallback lookup under
 * output/audio/.
 */
export interface LipSyncRequest {
  video_path?: string | null;
  image_path?: string | null;
  audio_path?: string | null;
  audio_filename?: string | null;
  section?: string;
  output_path?: string | null;
}

/** POST /api/video/lipsync response — the job is polled via GET /api/jobs/{id}. */
export interface LipSyncResponse {
  success: boolean;
  job_id?: string | null;
  output_path?: string | null;
  section?: string | null;
  error?: string | null;
  message?: string | null;
}

// recovered from pre-typed-fetch rewrite
export interface HealthStatus {
  status: string;
  services: Record<string, string>;
}

// ============================================================================
// Restored pre-rewrite definitions (were module-local before db2110ca)
// ============================================================================

export interface DiagnosticsModel {
  name: string;
  size_mb: number;
  vram_mb: number;
  expires_at: string;
}

export interface ImageProcessRequest {
  style: string;
  style_image?: string;
  output_name?: string;
}

export interface ImageProcessResponse {
  output_path: string;
  relative_path: string;
  size: [number, number];
  mode: string;
  format: string;
  applied_effects: string[];
}

export interface ImageRemixRequest {
  images: string[];
  preset?: "drums_a_vocals_b" | "blend" | "intro_swap";
  gain?: number;
  key_shift?: number;
  start_bar?: number;
}

export interface ImageRemixResponse {
  output_path: string;
  relative_path: string;
  layers: number;
  mastered: boolean;
  master_path?: string;
}

export interface ImagePreviewRequest {
  layers: ImageRemixRequest["images"];
  preset?: ImageRemixRequest["preset"];
}

export interface ImagePreviewResponse {
  output_path: string;
  relative_path: string;
  preview_url: string;
}

export interface ImageCapabilities {
  service: string;
  pillow_version: string;
  features: Record<string, boolean>;
  operations: Record<string, unknown>;
  max_image_size: { width: number; height: number };
  max_file_size_mb: number;
}

export interface ImageHealth {
  status: string;
  service: string;
  bridge_version: string;
  provider_update_detected: boolean;
  compatibility: {
    parameter_map: Record<string, string>;
    response_map: Record<string, string>;
    unsupported_features: string[];
  };
}

export interface SkillResourceContent {
  contents: {
    uri: string;
    mimeType: string;
    text?: string;
    blob?: string;
  }[];
}

export interface NotificationItem {
  id: string;
  type: string | null;
  data: Record<string, unknown> | null;
  timestamp: string | null;
  priority: "urgent" | "high" | "medium" | "low";
}

export interface NotificationPreferences {
  progress: boolean;
  completed: boolean;
  failed: boolean;
  cancelled: boolean;
  system: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
  push: { enabled: boolean; subscribed: boolean };
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface AppSettings {
  comfyui_url: string;
  ollama_url: string;
  atomic_chat_url: string;
  atomic_chat_enabled: boolean;
  log_level: string;
  max_queue_workers: number;
  backend_port: number;
  frontend_port: number;
  default_model?: string;
}

export interface UnityAudioSyncFrame {
  audioData: Pick<
    AudioData,
    "bass" | "mid" | "treble" | "beat" | "energy" | "peak" | "beatPhase" | "analyzedEnergy"
  >;
  audioTime: number;
  progress?: number;
  intensity?: number;
}
