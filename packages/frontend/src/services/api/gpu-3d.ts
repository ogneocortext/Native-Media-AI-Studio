import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

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

export interface GPUProcessInfo {
  pid: number;
  name: string;
  mem_mb: number;
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

// 3D
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
