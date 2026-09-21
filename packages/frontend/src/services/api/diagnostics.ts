import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export async function getDiagnostics(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/diagnostics`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get diagnostics");
  return res.json();
}

export async function getSystemDiagnostics(): Promise<import("./core").SystemHealth> {
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

// Job Types
export async function getJobTypes(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/jobs/types`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get job types");
  return res.json();
}
