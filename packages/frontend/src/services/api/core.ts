import { fetchWithTimeout } from "../fetchWithTimeout";
import { getBackendUrl, getCachedConfig } from "../portConfig";

export const getApiBase = (): string => {
  return "";
};

export async function withDirectBackendFallback<T>(
  proxyCall: () => Promise<T>,
  directPath: string,
  options?: { method?: string; body?: unknown; timeout?: number },
): Promise<T> {
  try {
    return await proxyCall();
  } catch (error) {
    const cached = getCachedConfig();
    const backendUrl = cached?.backend_url || getBackendUrl();
    const directUrl = `${backendUrl.replace(/\/$/, "")}${directPath}`;
    console.warn(`[api] proxy call failed, falling back to direct backend URL: ${directUrl}`, error);
    const init: RequestInit = {
      method: options?.method || "GET",
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    };
    if (options?.method === "POST") {
      init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    }
    return fetchWithTimeout(directUrl, { timeout: options?.timeout || 30000, ...init }).then((res) => {
      if (!res.ok) throw new Error(`Direct backend request failed: ${res.status}`);
      return res.json();
    });
  }
}

export interface HealthStatus {
  status: string;
  services: Record<string, string>;
}

export interface AdapterHealth {
  name: string;
  status: "online" | "offline" | "unknown";
  url?: string;
  response_time_ms?: number;
  error?: string;
}

export interface AggregateHealth {
  backend: "online" | "offline";
  overall: "healthy" | "degraded" | "unhealthy";
  adapters: Record<string, AdapterHealth>;
  timestamp: string;
}

export interface AdapterDetail {
  status: string;
  error?: string;
  url?: string;
}

export interface ServiceStatus {
  adapters: Record<string, string>;
  adapter_details?: Record<string, AdapterDetail>;
  connections: number;
}

export interface SystemHealth {
  status: string;
  timestamp: string;
  platform: string;
  platform_version: string;
  cpu: {
    usage_percent: number;
    count: number;
    count_logical: number;
  };
  memory: {
    total_gb: number;
    available_gb: number;
    used_gb: number;
    percent: number;
  };
  disk: {
    total_gb?: number;
    free_gb?: number;
    percent?: number;
    error?: string;
  };
}
