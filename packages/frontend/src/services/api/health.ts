/**
 * Frontend client for /api/health — health checks and system status.
 */

import { getApiBase, withDirectBackendFallback } from "./core";
import { fetchJson } from "./typed-fetch";
import type { AggregateHealth, SystemHealth, ServiceStatus } from "./types";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../queryClient";

/** Ping the backend (liveness probe). */
export async function ping(): Promise<{ status: string }> {
  const base = getApiBase();
  return fetchJson<{ status: string }>(`${base}/api/health/ping`, { timeout: 10000 });
}

/**
 * Check aggregate health of all adapters.
 * Uses direct backend fallback for reliability.
 */
export async function healthCheck(): Promise<AggregateHealth> {
  const base = getApiBase();
  return withDirectBackendFallback(
    async () => fetchJson<AggregateHealth>(`${base}/api/health`, { timeout: 30000 }),
    "/api/health",
  );
}

/**
 * Get system health (CPU, memory, disk).
 * Uses direct backend fallback for reliability.
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  const base = getApiBase();
  return withDirectBackendFallback(
    async () => fetchJson<SystemHealth>(`${base}/api/render/health`, { timeout: 30000 }),
    "/api/render/health",
  );
}

/**
 * Get service status (adapter details, connections).
 * Uses direct backend fallback for reliability.
 */
export async function getServiceStatus(): Promise<ServiceStatus> {
  const base = getApiBase();
  return withDirectBackendFallback(
    async () => fetchJson<ServiceStatus>(`${base}/api/services/status`, { timeout: 30000 }),
    "/api/services/status",
  );
}

/**
 * TanStack Query hook for backend aggregate health.
 *
 * Refetches every 15s while the page is visible, caches for 30s, retries
 * once. SSE already pushes `health_changed` events for instant updates, so
 * this poll is only a fallback — 5s was probing every adapter (ComfyUI
 * /system_stats, Ollama /api/tags) far more often than status can change.
 * Complements the Zustand healthStore (which owns SSE + granular polling);
 * this hook is for components that just need the latest aggregate health
 * without hand-rolling their own polling interval.
 *
 * @param enabled - Set false to disable automatic fetching.
 */
export function useHealthQuery(enabled = true) {
  return useQuery({
    queryKey: ["health", "aggregate"],
    queryFn: healthCheck,
    enabled,
    staleTime: 5_000,
    gcTime: 30_000,
    retry: 1,
    refetchInterval: 15_000,
  });
}

/**
 * Prefetch aggregate health so the first render has data.
 * Call this from a component that mounts before any `useHealthQuery` consumer,
 * or from a route loader.
 */
export async function prefetchHealth() {
  return queryClient.prefetchQuery({
    queryKey: ["health", "aggregate"],
    queryFn: healthCheck,
    staleTime: 5_000,
  });
}

export type * from "./types";
