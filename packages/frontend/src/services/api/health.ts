import { getApiBase, withDirectBackendFallback } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

/** Ping the backend (liveness probe). */
export async function ping(): Promise<{ status: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/ping`, { timeout: 10000 });
  if (!res.ok) throw new Error("Ping failed");
  return res.json();
}

export async function healthCheck(): Promise<import("./core").AggregateHealth> {
  const base = getApiBase();
  return withDirectBackendFallback(
    () => fetchWithTimeout(`${base}/api/health`, { timeout: 30000 }).then((res) => {
      if (!res.ok) throw new Error("Health check failed");
      return res.json();
    }),
    "/api/health",
  );
}

export async function getSystemHealth(): Promise<import("./core").SystemHealth> {
  const base = getApiBase();
  return withDirectBackendFallback(
    () => fetchWithTimeout(`${base}/api/render/health`, { timeout: 30000 }).then((res) => {
      if (!res.ok) throw new Error("Failed to get system health");
      return res.json();
    }),
    "/api/render/health",
  );
}

export async function getServiceStatus(): Promise<import("./core").ServiceStatus> {
  const base = getApiBase();
  return withDirectBackendFallback(
    () => fetchWithTimeout(`${base}/api/services/status`, { timeout: 30000 }).then((res) => {
      if (!res.ok) throw new Error("Failed to get service status");
      return res.json();
    }),
    "/api/services/status",
  );
}
