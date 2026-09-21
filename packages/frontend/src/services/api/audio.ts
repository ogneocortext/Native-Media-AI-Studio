import { getApiBase, withDirectBackendFallback } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

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

  const res = await fetchWithTimeout(`${base}/api/audio/upload`, {
    method: "POST",
    body: formData,
    timeout: 120000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Failed to upload audio file");
  }
  return res.json();
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

export interface AudioStemsResponse {
  audio_file: string;
  stems: Record<string, string>;
  stems_mp3?: Record<string, string>;
  found: boolean;
}

export async function getAudioStems(filename: string): Promise<AudioStemsResponse> {
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
  spectral_centroid?: number[];
  spectral_rolloff?: number[];
  spectral_bandwidth?: number[];
  zero_crossing_rate?: number[];
  suggested_visualization?: string;
  suggested_kinetic_preset?: string;
  suggested_theme_seed?: string;
  metadata?: {
    backend?: string;
    computed_on?: string;
    duration_samples?: number;
    hop_length?: number;
    frame_length?: number;
    [key: string]: unknown;
  };
}

export async function getAnalysis(filename: string): Promise<AudioAnalysisResult> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/analysis/by-filename/${encodeURIComponent(filename)}`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No cached analysis found");
  }
  return res.json();
}

export interface EnsureAnalysisResponse {
  status: string;
  analysis: AudioAnalysisResult;
}

export async function ensureAnalysis(filename: string, backend: string = "sonara"): Promise<EnsureAnalysisResponse> {
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

export interface TimingMetadata {
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
}

export async function getTimingMetadata(filename: string): Promise<TimingMetadata> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/timing-metadata/${encodeURIComponent(filename)}`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No timing metadata found");
  }
  return res.json();
}

export async function listAudioFiles(): Promise<Array<{
  filename: string; relative_path: string; folder: string; size_bytes: number;
  modified: number;
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
  const res = await fetchWithTimeout(`${base}/api/audio/analysis/summary/${encodeURIComponent(filename)}`, { timeout: 30000 });
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

export async function trimAudioFile(params: {
  filename: string;
  mode: "keep" | "remove";
  ranges: TrimRange[];
}): Promise<TrimAudioResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/trim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 600000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to trim audio");
  }
  return res.json();
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
  const res = await fetchWithTimeout(`${base}/api/video/generate-section`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to generate video section");
  return res.json();
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

export async function generateKineticVideo(request: KineticVideoRequest): Promise<KineticVideoResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/generate-section`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: request.prompt || `Kinetic typography lyric video with ${request.preset_id} preset`,
      negative_prompt: "blurry, low quality, distorted text, unreadable",
      steps: 20,
      cfg_scale: 7.0,
      seed: -1,
      section: "full",
      duration: request.duration,
      vertical_first: false,
      audio_filename: request.audio_filename,
      method: "visualization",
      visualization: {
        style: "kinetic",
        duration: request.duration < 60 ? `${Math.round(request.duration)}s` : "full",
        resolution: "1080p",
        fps: 30,
        preset_id: request.preset_id,
        lyrics: request.lyrics || [],
      },
    }),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to generate kinetic video");
  }
  return res.json();
}
