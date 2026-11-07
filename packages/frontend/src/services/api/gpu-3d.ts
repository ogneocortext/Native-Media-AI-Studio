/**
 * Frontend client for /api/health/gpu and /api/3d — GPU monitoring and 3D generation.
 */

import { getApiBase } from "./core";
import { getJson, postJson, postForm, fetchJson } from "./typed-fetch";
import type {
  GPUSnapshot,
  GPUProcessInfo,
  GPUHistoryPoint,
  GPUStats,
  Generate3DRequest,
  Generate3DResponse,
} from "./types";

const BASE = "/api/health/gpu";
const BASE_3D = "/api/3d";

/**
 * Get current GPU snapshot (memory, utilization, temperature, processes).
 */
export async function getGPUSnapshot(): Promise<GPUSnapshot> {
  return getJson<GPUSnapshot>(BASE, { timeout: 30000 });
}

/**
 * Get GPU processes (PID, name, memory).
 */
export async function getGPUProcesses(): Promise<{ processes: GPUProcessInfo[]; count: number }> {
  return getJson<{ processes: GPUProcessInfo[]; count: number }>(`${BASE}/processes`, { timeout: 30000 });
}

/**
 * Get GPU history (time-series data).
 */
export async function getGPUHistory(
  range?: string,
  limit = 2000,
): Promise<{ points: GPUHistoryPoint[]; count: number }> {
  const params = new URLSearchParams();
  if (range) params.set("range", range);
  params.set("limit", String(limit));
  return getJson<{ points: GPUHistoryPoint[]; count: number }>(
    `${BASE}/history?${params.toString()}`,
    { timeout: 30000 },
  );
}

/**
 * Get GPU statistics (aggregated).
 */
export async function getGPUStats(range?: string): Promise<GPUStats> {
  const params = new URLSearchParams();
  if (range) params.set("range", range);
  return getJson<GPUStats>(`${BASE}/stats?${params.toString()}`, { timeout: 30000 });
}

/**
 * Clear GPU history (optionally keep N days).
 */
export async function clearGPUHistory(keepDays = 0): Promise<{ deleted: number }> {
  return fetchJson<{ deleted: number }>(`${BASE}/history?keep_days=${keepDays}`, {
    method: "DELETE",
    timeout: 30000,
  });
}

/**
 * Get 3D service status.
 */
export async function get3DStatus(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  return getJson<Record<string, unknown>>(`${base}${BASE_3D}/status`, { timeout: 30000 });
}

/**
 * Generate 3D model from text prompt.
 * Long-running (up to 10 minutes).
 */
export async function generate3D(request: Generate3DRequest): Promise<Generate3DResponse> {
  const base = getApiBase();
  return postJson<Generate3DResponse>(`${base}${BASE_3D}/generate`, request, { timeout: 600000 });
}

/**
 * Generate 3D model from image file.
 * Long-running (up to 10 minutes).
 */
export async function generate3DFromImage(
  file: File,
  opts?: { steps?: number; output_name?: string; model?: string },
): Promise<Generate3DResponse> {
  const base = getApiBase();
  const form = new FormData();
  form.append("file", file, file.name);
  const params = new URLSearchParams();
  if (opts?.steps) params.set("steps", String(opts.steps));
  if (opts?.output_name) params.set("output_name", opts.output_name);
  if (opts?.model) params.set("model", opts.model);
  return postForm<Generate3DResponse>(`${base}${BASE_3D}/generate-image?${params.toString()}`, form, {
    timeout: 600000,
  });
}