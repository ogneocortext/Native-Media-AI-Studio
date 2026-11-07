/**
 * Frontend client for /api/health/diagnostics — system diagnostics and memory cleanup.
 */

import { getApiBase } from "./core";
import { getJson, postJson } from "./typed-fetch";
import type {
  DiagnosticsResponse,
  SystemHealth,
  MemoryDiagnostics,
  DiagnosticsModelsResponse,
} from "./types";

const BASE = "/api/health";

/**
 * Get full diagnostics (backend, adapters, queue, system).
 */
export async function getDiagnostics(): Promise<DiagnosticsResponse> {
  return getJson<DiagnosticsResponse>(`${BASE}/diagnostics`, { timeout: 30000 });
}

/**
 * Get system diagnostics (CPU, memory, disk).
 */
export async function getSystemDiagnostics(): Promise<SystemHealth> {
  return getJson<SystemHealth>(`${BASE}/diagnostics/system`, { timeout: 30000 });
}

/**
 * Get memory diagnostics (top processes, process count).
 */
export async function getMemoryDiagnostics(): Promise<MemoryDiagnostics> {
  return getJson<MemoryDiagnostics>(`${BASE}/diagnostics/memory`, { timeout: 30000 });
}

/**
 * Cleanup system memory (drop caches, garbage collect).
 */
export async function cleanupSystemMemory(): Promise<{
  before_percent: number;
  after_percent: number;
  freed_percent: number;
  actions: string[];
  memory: { total_mb: number; used_mb: number; available_mb: number; percent: number };
}> {
  return postJson<{
    before_percent: number;
    after_percent: number;
    freed_percent: number;
    actions: string[];
    memory: { total_mb: number; used_mb: number; available_mb: number; percent: number };
  }>(`${BASE}/diagnostics/memory/cleanup`, {}, { timeout: 30000 });
}

/**
 * Get loaded Ollama models with VRAM info.
 */
export async function getLoadedModels(): Promise<DiagnosticsModelsResponse> {
  return getJson<DiagnosticsModelsResponse>(`${BASE}/ollama/models`, { timeout: 30000 });
}

/**
 * Check a specific service health.
 */
export async function checkService(service: string): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    `${BASE}/services/${service}/check`,
    {},
    { timeout: 30000 },
  );
}

/**
 * Get job types available in the queue.
 */
export async function getJobTypes(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  return getJson<Record<string, unknown>>(`${base}/api/jobs/types`, { timeout: 30000 });
}