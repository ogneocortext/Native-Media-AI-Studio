import { fetchWithTimeout } from "../fetchWithTimeout";
import { getBackendUrl, getCachedConfig } from "../portConfig";

export { fetchWithTimeout };

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
    const init: RequestInit = {
      method: options?.method || "GET",
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    };
    if (options?.method === "POST") {
      init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    }
    return fetchWithTimeout(directUrl, { timeout: options?.timeout || 30000, ...init }).then(
      (resp) => {
        if (!resp.ok) throw new Error(`Direct backend request failed: ${resp.status}`);
        return resp.json();
      },
    );
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

export interface AppConfig {
  backend_port: number;
  frontend_port: number;
  ws_port: number;
  backend_url: string;
  frontend_url: string;
  comfyui_url: string;
  comfyui_port: number;
  video_editor_port: number;
  ollama_url: string;
  atomic_chat_url: string;
  atomic_chat_enabled: boolean;
  go_dashboard_url: string;
  go_media_url: string;
  go_worker_url: string;
  go_gateway_url: string;
  go_ports_url: string;
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
