import { getApiBase, withDirectBackendFallback } from "./core";
import type { AggregateHealth, SystemHealth, ServiceStatus } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

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
