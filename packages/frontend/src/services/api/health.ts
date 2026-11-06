import { getApiBase, withDirectBackendFallback } from "./core";
import type { AggregateHealth, SystemHealth, ServiceStatus } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../queryClient";

/** Ping the backend (liveness probe). */
export async function ping(): Promise<{ status: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/ping`, { timeout: 10000 });
  if (!res.ok) throw new Error("Ping failed");
  return res.json();
}

export async function healthCheck(): Promise<AggregateHealth> {
  const base = getApiBase();
  return withDirectBackendFallback(
    async () =>
      fetchWithTimeout(`${base}/api/health`, { timeout: 30000 }).then(async (res) => {
        if (!res.ok) throw new Error("Health check failed");
        return res.json();
      }),
    "/api/health",
  );
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const base = getApiBase();
  return withDirectBackendFallback(
    async () =>
      fetchWithTimeout(`${base}/api/render/health`, { timeout: 30000 }).then(async (res) => {
        if (!res.ok) throw new Error("Failed to get system health");
        return res.json();
      }),
    "/api/render/health",
  );
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  const base = getApiBase();
  return withDirectBackendFallback(
    async () =>
      fetchWithTimeout(`${base}/api/services/status`, { timeout: 30000 }).then(async (res) => {
        if (!res.ok) throw new Error("Failed to get service status");
        return res.json();
      }),
    "/api/services/status",
  );
}

/**
 * TanStack Query hook for backend aggregate health.
 *
 * Refetches every 5s while the page is visible, caches for 30s, retries once.
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
    refetchInterval: 5_000,
  });
}

/**
 * Prefetch aggregate health so the first render has data.
 * Call this from a component that mounts before any `useHealthQuery` consumer,
 * or from a route loader.
 */
export function prefetchHealth() {
  return queryClient.prefetchQuery({
    queryKey: ["health", "aggregate"],
    queryFn: healthCheck,
    staleTime: 5_000,
  });
}
