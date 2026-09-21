import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

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
