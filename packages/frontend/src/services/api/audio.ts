/**
 * Frontend client for /api/audio — upload, analysis, stems, editing, file serving.
 *
 * Backend mapping (per AGENTS.md D15: /api/audio is four peer modules, not one):
 *   audio.py          uploadAudioFile, separateAudioStems, getAnalysis,
 *                     ensureAnalysis, analyzeAudio, analyzeAudioCuda,
 *                     getAnalysisResult, getTimingMetadata, getAnalysisSummary,
 *                     analyzeAllPending, getAvailableAudioBackends
 *   audio_stems.py    getAudioStems, enhanceStems
 *   audio_edit.py     renameAudioFile, trimAudioFile, extractVideoAudio
 *   audio_remix.py    (see services/api/remix.ts — separate module)
 *
 * Endpoint traps an agent should know before adding or changing a call here:
 *   - listAudioFiles() is intentionally thin. Components must NOT call it
 *     directly — read the library through useAudioLibrary() instead
 *     (hooks/useAudioLibrary + state/audioLibraryStore). Six pages used to
 *     each call listAudioFiles() with their own hash-stripping regex; two
 *     regexes leaked a raw sha256 prefix into 12 of 58 rows.
 *   - enhanceStems() hits /api/audio/enhance-stems, which resolves a library
 *     filename under output/audio/ and 404s for a remix. To master a remix use
 *     POST /api/audio/remix/{name}/enhance via remix.ts instead.
 *   - Analysis results carry ANALYSIS_SCHEMA_VERSION (currently 2 in
 *     audio_analysis.py). A stale cached result can be served forever unless
 *     the caller treats results below the current schema as stale.
 *
 * Shape mirrors the backend request/response models exactly, so a field rename
 * on either side shows up as a type error rather than as undefined at runtime.
 */

import { getApiBase, withDirectBackendFallback } from "./core";
import {
  postForm,
  getJson,
  postJson,
  fetchJson,
} from "./typed-fetch";
import type {
  AudioUploadResponse,
  StemSeparationResponse,
  SeparationQualityOptions,
  AudioStemsResponse,
  AudioAnalysisResult,
  EnsureAnalysisResponse,
  TimingMetadata,
  StemsAnalysisResponse,
  StemsStatusResponse,
  AudioFileListItem,
  AudioBackendsResponse,
  AudioAnalysisSummary,
  AnalyzeAllPendingResponse,
  LyricLine,
  TranscriptionResult,
  TracksWithLyricsResponse,
  RenameAudioResponse,
  TrimRange,
  TrimAudioResponse,
  ExtractAudioResponse,
  VideoGenerateRequest,
  VideoGenerateResponse,
  KineticVideoRequest,
  KineticVideoResponse,
  EnhanceStemsResponse,
  EnhanceStemsParams,
  MasterMeasureResponse,
  MasterTarget,
  MasterRequest,
  MasterFinishPreset,
  MasterResponse,
} from "./types";

const BASE = "/api/audio";

/**
 * Upload an audio file to the library.
 * Accepts audio files and video files (which are converted to audio).
 */
export async function uploadAudioFile(file: File): Promise<AudioUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return postForm<AudioUploadResponse>(`${BASE}/upload`, formData, { timeout: 120000 });
}

/**
 * Separate stems from an uploaded file.
 * Long-running operation (up to 10 minutes).
 */
export async function separateAudioStems(
  file: File,
  model = "mdx_extra_q",
  quality: SeparationQualityOptions = {},
): Promise<StemSeparationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", model);
  if (quality.mode) formData.append("mode", quality.mode);
  if (quality.segment_size != null) formData.append("segment_size", String(quality.segment_size));
  if (quality.overlap != null) formData.append("overlap", String(quality.overlap));
  if (quality.denoise != null) formData.append("denoise", String(quality.denoise));

  return postForm<StemSeparationResponse>(`${BASE}/separate`, formData, { timeout: 600000 });
}

/**
 * Get stems for a library file (already separated).
 * Uses direct backend fallback for reliability.
 */
export async function getAudioStems(filename: string): Promise<AudioStemsResponse> {
  return withDirectBackendFallback(
    async () => {
      const encoded = encodeURIComponent(filename);
      return getJson<AudioStemsResponse>(`${BASE}/stems/${encoded}`, { timeout: 30000 });
    },
    `/api/audio/stems/${encodeURIComponent(filename)}`,
    { timeout: 30000 },
  );
}

/**
 * Separate stems from a file already in the library.
 * Long-running operation (up to 10 minutes).
 */
export async function separateAudioFile(
  filename: string,
  model = "mdx_extra_q",
  quality: SeparationQualityOptions = {},
): Promise<StemSeparationResponse> {
  const payload: Record<string, unknown> = { filename, model, ...quality };
  return withDirectBackendFallback(
    async () =>
      postJson<StemSeparationResponse>(`${BASE}/separate-file`, payload, { timeout: 600000 }),
    "/api/audio/separate-file",
    { method: "POST", body: payload, timeout: 600000 },
  );
}

/**
 * Get cached analysis for a file by filename.
 */
export async function getAnalysis(filename: string): Promise<AudioAnalysisResult> {
  const encoded = encodeURIComponent(filename);
  return getJson<AudioAnalysisResult>(
    `${BASE}/analysis/by-filename/${encoded}`,
    { timeout: 30000 },
  );
}

/**
 * Ensure analysis exists, computing if necessary.
 * Long-running (up to 5 minutes).
 */
export async function ensureAnalysis(
  filename: string,
  backend = "sonara",
): Promise<EnsureAnalysisResponse> {
  return postJson<EnsureAnalysisResponse>(
    `${BASE}/ensure-analysis`,
    { filename, backend },
    { timeout: 300000 },
  );
}

/**
 * Get CUDA availability status.
 */
export async function getCudaStatus(): Promise<{
  available: boolean;
  gpu_name?: string;
  error?: string;
}> {
  const base = getApiBase();
  let res = await fetchJson<{ available: boolean; gpu_name?: string; error?: string }>(
    `${base}/api/integrations/cuda/status`,
    { timeout: 30000 },
  );
  if (!res.available) {
    res = await fetchJson<{ available: boolean; gpu_name?: string; error?: string }>(
      `${base}/api/health/integrations/cuda/status`,
      { timeout: 30000 },
    );
  }
  return res;
}

/**
 * Analyze an uploaded audio file.
 * Long-running (up to 5 minutes).
 */
export async function analyzeAudio(file: File, backend = "sonara"): Promise<AudioAnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);
  return postForm<AudioAnalysisResult>(
    `${BASE}/analyze?backend=${encodeURIComponent(backend)}`,
    formData,
    { timeout: 300000 },
  );
}

/**
 * Analyze an uploaded audio file using CUDA acceleration.
 * Long-running (up to 5 minutes).
 */
export async function analyzeAudioCuda(file: File): Promise<AudioAnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);
  return postForm<AudioAnalysisResult>(`${BASE}/analyze-cuda`, formData, { timeout: 300000 });
}

/**
 * Get analysis result by job ID.
 */
export async function getAnalysisResult(jobId: string): Promise<AudioAnalysisResult> {
  return getJson<AudioAnalysisResult>(`${BASE}/analysis/${jobId}`, { timeout: 30000 });
}

/**
 * Get timing metadata (beats, downbeats, sections) for a file.
 */
export async function getTimingMetadata(filename: string): Promise<TimingMetadata> {
  const encoded = encodeURIComponent(filename);
  return getJson<TimingMetadata>(
    `${BASE}/timing-metadata/${encoded}`,
    { timeout: 30000 },
  );
}

/**
 * Get per-stem analysis (spectral, energy curves).
 */
export async function getStemsAnalysis(filename: string): Promise<StemsAnalysisResponse> {
  const encoded = encodeURIComponent(filename);
  return getJson<StemsAnalysisResponse>(
    `${BASE}/stems-analysis/${encoded}`,
    { timeout: 30000 },
  );
}

/**
 * Get stems status for all tracks in the library.
 */
export async function getStemsStatus(): Promise<StemsStatusResponse> {
  return getJson<StemsStatusResponse>(`${BASE}/stems-status`, { timeout: 30000 });
}

/**
 * List all audio files in the library.
 * NOTE: Components should use useAudioLibrary() instead of calling this directly.
 */
export async function listAudioFiles(): Promise<AudioFileListItem[]> {
  const base = getApiBase();
  const data = await fetchJson<AudioFileListItem[] | { files: AudioFileListItem[] }>(
    `${base}${BASE}/files`,
    { timeout: 30000 },
  );
  return Array.isArray(data) ? data : (data?.files ?? []);
}

/**
 * Get available audio analysis backends.
 */
export async function getAvailableAudioBackends(): Promise<AudioBackendsResponse> {
  return getJson<AudioBackendsResponse>(`${BASE}/backends`, { timeout: 30000 });
}

/**
 * Get analysis summary (lightweight, no large arrays).
 */
export async function getAnalysisSummary(filename: string): Promise<AudioAnalysisSummary> {
  const encoded = encodeURIComponent(filename);
  return getJson<AudioAnalysisSummary>(
    `${BASE}/analysis/summary/${encoded}`,
    { timeout: 30000 },
  );
}

/**
 * Analyze all pending files in the library.
 * Long-running (up to 5 minutes).
 */
export async function analyzeAllPending(backend = "sonara"): Promise<AnalyzeAllPendingResponse> {
  const base = getApiBase();
  return postJson<AnalyzeAllPendingResponse>(
    `${base}${BASE}/analyze-all?backend=${encodeURIComponent(backend)}`,
    {},
    { timeout: 300000 },
  );
}

/**
 * Transcribe audio to lyrics.
 * Long-running (up to 5 minutes).
 */
export async function transcribeAudio(
  filename: string,
  language?: string,
  modelSize?: string,
): Promise<TranscriptionResult> {
  const base = getApiBase();
  return postJson<TranscriptionResult>(
    `${base}${BASE}/transcribe`,
    { filename, language, model_size: modelSize },
    { timeout: 300000 },
  );
}

/**
 * Get transcription for a file.
 */
export async function getTranscription(filename: string): Promise<TranscriptionResult> {
  const encoded = encodeURIComponent(filename);
  return getJson<TranscriptionResult>(
    `${BASE}/transcript/${encoded}`,
    { timeout: 30000 },
  );
}

/**
 * Get lyrics for a track by track ID.
 */
export async function getLyricsForTrack(trackId: string): Promise<{
  track_id: string;
  title: string;
  artist: string;
  lines: LyricLine[];
  total_lines: number;
}> {
  const base = getApiBase();
  return getJson<{
    track_id: string;
    title: string;
    artist: string;
    lines: LyricLine[];
    total_lines: number;
  }>(`${base}/api/lyrics/track/${trackId}`, { timeout: 30000 });
}

/**
 * Save lyrics for a track.
 */
export async function saveLyricsForTrack(
  trackId: string,
  lines: LyricLine[],
): Promise<{ status: string }> {
  const base = getApiBase();
  return postJson<{ status: string }>(
    `${base}/api/lyrics/track/${trackId}`,
    { lines },
    { timeout: 30000 },
  );
}

/**
 * Delete lyrics for a track.
 */
export async function deleteLyricsForTrack(trackId: string): Promise<{ status: string }> {
  const base = getApiBase();
  const { fetchJson } = await import("./typed-fetch");
  const response = await fetchJson<{ status: string }>(
    `${base}/api/lyrics/track/${trackId}`,
    { method: "DELETE", timeout: 30000 },
  );
  return response;
}

/**
 * Import LRC format lyrics for a track.
 */
export async function importLRC(
  trackId: string,
  lrcContent: string,
): Promise<{ status: string; lines_count: number }> {
  const base = getApiBase();
  return postJson<{ status: string; lines_count: number }>(
    `${base}/api/lyrics/import-lrc`,
    { track_id: trackId, lrc_content: lrcContent },
    { timeout: 30000 },
  );
}

/**
 * Export LRC format lyrics for a track.
 */
export async function exportLRC(trackId: string): Promise<{ lrc: string; format: string }> {
  const base = getApiBase();
  return getJson<{ lrc: string; format: string }>(
    `${base}/api/lyrics/track/${trackId}/lrc`,
    { timeout: 30000 },
  );
}

/**
 * Get all tracks that have lyrics.
 */
export async function getTracksWithLyrics(): Promise<TracksWithLyricsResponse[]> {
  const base = getApiBase();
  return getJson<TracksWithLyricsResponse[]>(
    `${base}/api/lyrics/tracks-with-lyrics`,
    { timeout: 30000 },
  );
}

/**
 * Get lyrics by audio filename.
 */
export async function getLyricsByFilename(filename: string): Promise<{
  track_id: string;
  title: string;
  artist: string;
  lines: LyricLine[];
  total_lines: number;
}> {
  const base = getApiBase();
  const encoded = encodeURIComponent(filename);
  return getJson<{
    track_id: string;
    title: string;
    artist: string;
    lines: LyricLine[];
    total_lines: number;
  }>(`${base}/api/lyrics/by-filename/${encoded}`, { timeout: 30000 });
}

/**
 * Rename an audio file in the library.
 */
export async function renameAudioFile(
  oldFilename: string,
  newFilename: string,
): Promise<RenameAudioResponse> {
  return postJson<RenameAudioResponse>(`${BASE}/rename`, {
    old_filename: oldFilename,
    new_filename: newFilename,
  });
}

/**
 * Trim an audio file (keep or remove ranges).
 * Long-running (up to 10 minutes).
 */
export async function trimAudioFile(params: {
  filename: string;
  mode: "keep" | "remove";
  ranges: TrimRange[];
}): Promise<TrimAudioResponse> {
  return postJson<TrimAudioResponse>(`${BASE}/trim`, params, { timeout: 600000 });
}

/**
 * Extract audio from a video file.
 * Long-running (up to 10 minutes).
 * Uses direct backend fallback for reliability.
 */
export async function extractVideoAudio(params: {
  source_path: string;
  format?: "original" | "mp3";
  bitrate?: "128k" | "192k" | "320k";
}): Promise<ExtractAudioResponse> {
  return withDirectBackendFallback(
    async () =>
      postJson<ExtractAudioResponse>(`${BASE}/extract`, params, { timeout: 600000 }),
    "/api/audio/extract",
    { method: "POST", body: params, timeout: 600000 },
  );
}

/**
 * Generate a video section from audio.
 */
export async function generateVideoSection(
  request: VideoGenerateRequest,
): Promise<VideoGenerateResponse> {
  const base = getApiBase();
  return postJson<VideoGenerateResponse>(
    `${base}/api/video/generate-section`,
    request,
    { timeout: 30000 },
  );
}

/**
 * Generate a kinetic typography lyric video.
 */
export async function generateKineticVideo(
  request: KineticVideoRequest,
): Promise<KineticVideoResponse> {
  const base = getApiBase();
  return postJson<KineticVideoResponse>(
    `${base}/api/video/generate-section`,
    {
      prompt: request.prompt ?? `Kinetic typography lyric video with ${request.preset_id} preset`,
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
        lyrics: request.lyrics ?? [],
      },
    },
    { timeout: 30000 },
  );
}

/**
 * Enhance stems with mastering chain.
 * Long-running (up to 10 minutes).
 */
export async function enhanceStems(params: EnhanceStemsParams): Promise<EnhanceStemsResponse> {
  return postJson<EnhanceStemsResponse>(`${BASE}/enhance-stems`, params, { timeout: 600000 });
}

/* ------------------------------------------------------------------ */
/* Mastering — /api/audio/master  (backend module audio_mastering.py) */
/* ------------------------------------------------------------------ */

/** Delivery loudness presets offered to the user. Mirrors backend TARGET_LUFS. */
export const MASTER_TARGETS: Record<MasterTarget, number> = {
  spotify: -14,
  apple: -16,
  competitive: -11,
  amazon: -2,
} as const;

/** Predefined finishing-chain presets applied via the UI. */
export const MASTER_FINISH_PRESETS: MasterFinishPreset[] = [
  { label: "Gentle", sub_cut_db: 2, presence_db: 1.5 },
  { label: "Standard", sub_cut_db: 3, presence_db: 2.5 },
  { label: "Aggressive", sub_cut_db: 5, presence_db: 4 },
];

/**
 * Measurement-only: LUFS / true peak / LRA of a file (preview, no write).
 */
export async function measureMasterLoudness(filename: string): Promise<MasterMeasureResponse> {
  const encoded = encodeURIComponent(filename);
  return getJson<MasterMeasureResponse>(
    `${BASE}/master/measure/${encoded}`,
    { timeout: 60000 },
  );
}

/**
 * Master a library file to a delivery loudness target and write a mastered
 * copy under output/audio/mastered/. Returns a before/after QC report.
 * Long-running (up to 10 minutes).
 */
export async function masterAudio(body: MasterRequest): Promise<MasterResponse> {
  return postJson<MasterResponse>(`${BASE}/master`, body, { timeout: 600000 });
}