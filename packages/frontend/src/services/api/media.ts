/**
 * Frontend client for /api/media — media inspection (probe, loudness, waveform, thumbnails).
 */

import { getJson, postJson } from "./typed-fetch";
import type {
  MediaProbeResponse,
  LoudnessResponse,
  WaveformResponse,
  ThumbnailAtTimeRequest,
  ThumbnailAtTimeResponse,
  RegenerateCoverResponse,
} from "./types";

const BASE = "/api/media";

/**
 * Probe a media file (ffprobe).
 */
export async function probeMedia(path: string): Promise<MediaProbeResponse> {
  return getJson<MediaProbeResponse>(`${BASE}/probe?path=${encodeURIComponent(path)}`, { timeout: 30000 });
}

/**
 * Get loudness measurement for a media file.
 */
export async function getMediaLoudness(path: string): Promise<LoudnessResponse> {
  return getJson<LoudnessResponse>(
    `${BASE}/loudness?path=${encodeURIComponent(path)}`,
    { timeout: 30000 },
  );
}

/**
 * Get waveform peaks for a media file.
 */
export async function getMediaWaveform(path: string, maxPoints = 240): Promise<WaveformResponse> {
  return getJson<WaveformResponse>(
    `${BASE}/waveform?path=${encodeURIComponent(path)}&max_points=${encodeURIComponent(String(maxPoints))}`,
    { timeout: 30000 },
  );
}

/**
 * Extract thumbnail at a specific time.
 */
export async function extractThumbnailAtTime(
  body: ThumbnailAtTimeRequest,
): Promise<ThumbnailAtTimeResponse> {
  return postJson<ThumbnailAtTimeResponse>(`${BASE}/thumbnail`, body, { timeout: 30000 });
}

/**
 * Regenerate audio cover art.
 */
export async function regenerateAudioCover(path: string): Promise<RegenerateCoverResponse> {
  return postJson<RegenerateCoverResponse>(
    `${BASE}/cover?path=${encodeURIComponent(path)}`,
    {},
    { method: "POST", timeout: 30000 },
  );
}