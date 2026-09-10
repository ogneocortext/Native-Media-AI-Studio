/**
 * Port Configuration Service
 *
 * Reads backend URL from the backend API first, then falls back to the
 * static config/ports.json asset, then to Vite environment variables.
 *
 * Per Guidelines section 6: "No hardcoded API URLs. Always read from ports.json or Vite env vars."
 */

/// <reference types="vite/client" />

export interface PortConfig {
  backend_url: string;
  backend_port: number;
  frontend_port: number;
  // Canonical realtime endpoint (SSE). `ws_*` kept as deprecated alias for compat.
  events_url?: string;
  sse_url?: string;
  ws_port: number;
  ws_url?: string;
  video_editor_port?: number;
  comfyui_port?: number;
  comfyui_url?: string;
  dashboard_port?: number;
  dashboard_url?: string;
}

// Cache for the port configuration
let cachedConfig: PortConfig | null = null;

// Environment variable fallback getters
function getEnvVar(key: string, fallback: string): string {
  return (import.meta.env as Record<string, string>)[key] || fallback;
}

/**
 * Normalize a raw ports.json payload into the PortConfig shape the frontend expects.
 * Falls back to safe defaults for any missing fields.
 */
function normalizePortConfig(raw: Record<string, unknown>): PortConfig {
  const backendPort = (raw.backend_port as number) || 8000;
  const frontendPort = (raw.frontend_port as number) || 5173;
  const dashboardPort = (raw.dashboard_port as number) || 3847;
  const dashboardUrl = (raw.dashboard_url as string) || `http://127.0.0.1:${dashboardPort}`;
  const eventsUrl = (raw.events_url as string) || (raw.sse_url as string) || `http://127.0.0.1:${backendPort}/api/events`;
  const sseUrl = (raw.sse_url as string) || (raw.events_url as string) || eventsUrl;
  const wsPort = (raw.ws_port as number) || backendPort;
  const wsUrl = (raw.ws_url as string) || `ws://127.0.0.1:${wsPort}/ws`;

  return {
    backend_url: (raw.backend_url as string) || `http://127.0.0.1:${backendPort}`,
    backend_port: backendPort,
    frontend_port: frontendPort,
    events_url: eventsUrl,
    sse_url: sseUrl,
    ws_port: wsPort,
    ws_url: wsUrl,
    video_editor_port: (raw.video_editor_port as number) || undefined,
    comfyui_port: (raw.comfyui_port as number) || undefined,
    comfyui_url: (raw.comfyui_url as string) || undefined,
    dashboard_port: dashboardPort,
    dashboard_url: dashboardUrl,
  };
}

/**
 * Fetch port configuration from the backend API, then static asset, then env vars.
 */
export async function fetchPortConfig(): Promise<PortConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  // 1) Preferred: backend API (always reflects actual bound ports)
  try {
    const response = await fetch("/api/integrations/config/ports");
    if (response.ok) {
      const raw = await response.json();
      cachedConfig = normalizePortConfig(raw as Record<string, unknown>);
      return cachedConfig;
    }
  } catch {
    // Backend unreachable — fall through to static asset
  }

  // 2) Fallback: static asset bundled with the frontend
  try {
    const response = await fetch("/config/ports.json");
    if (response.ok) {
      const raw = await response.json();
      cachedConfig = normalizePortConfig(raw as Record<string, unknown>);
      return cachedConfig;
    }
  } catch {
    // Static asset missing — fall through to env vars
  }

  // 3) Final fallback: environment variables or hardcoded defaults
  cachedConfig = getPortConfigFromEnv();
  return cachedConfig;
}

/**
 * Get port configuration from environment variables.
 * Priority: VITE_ prefixed env vars > defaults
 */
export function getPortConfigFromEnv(): PortConfig {
  const backendPort = getEnvVar("VITE_BACKEND_PORT", "8000");
  const frontendPort = getEnvVar("VITE_FRONTEND_PORT", "5173");
  const wsPort = getEnvVar("VITE_WS_PORT", "8000");

  const backendPortInt = parseInt(backendPort, 10);
  const eventsUrl = getEnvVar("VITE_EVENTS_URL", `http://127.0.0.1:${backendPortInt}/api/events`);
  const sseUrl = getEnvVar("VITE_SSE_URL", eventsUrl);
  const dashboardPort = parseInt(getEnvVar("VITE_DASHBOARD_PORT", "3847"), 10);

  cachedConfig = {
    backend_url: getEnvVar("VITE_BACKEND_URL", `http://127.0.0.1:${backendPort}`),
    backend_port: backendPortInt,
    frontend_port: parseInt(frontendPort, 10),
    events_url: eventsUrl,
    sse_url: sseUrl,
    ws_port: parseInt(wsPort, 10),
    ws_url: getEnvVar("VITE_WS_URL", `ws://127.0.0.1:${wsPort}/ws`),
    dashboard_port: dashboardPort,
    dashboard_url: getEnvVar("VITE_DASHBOARD_URL", `http://127.0.0.1:${dashboardPort}`),
  };

  return cachedConfig;
}

/**
 * Get the cached configuration (must call fetchPortConfig or getPortConfigFromEnv first)
 */
export function getCachedConfig(): PortConfig | null {
  return cachedConfig;
}

/**
 * Get the backend API base URL
 */
export function getBackendUrl(): string {
  if (!cachedConfig) {
    // Sync fallback to env vars (non-async path)
    return getEnvVar("VITE_BACKEND_URL", "http://127.0.0.1:8000");
  }
  return cachedConfig.backend_url;
}

/**
 * Get the API base URL (for proxy configuration)
 */
export function getApiBaseUrl(): string {
  if (!cachedConfig) {
    return "http://127.0.0.1:8000";
  }
  return cachedConfig.backend_url;
}

/**
 * Get the Remotion Video Editor studio URL.
 * The studio runs on the port configured in config/ports.json (default: 8080).
 */
export function getVideoEditorUrl(): string {
  if (!cachedConfig) {
    return "http://127.0.0.1:8080";
  }
  const port = cachedConfig.video_editor_port ?? 8080;
  return `http://127.0.0.1:${port}`;
}

/**
 * Get the ComfyUI server URL.
 * Reads from config/ports.json comfyui_url, falls back to comfyui_port, then env var.
 */
export function getComfyuiUrl(): string {
  if (!cachedConfig) {
    return getEnvVar("VITE_COMFYUI_URL", "http://127.0.0.1:8188");
  }
  if (cachedConfig.comfyui_url) {
    return cachedConfig.comfyui_url;
  }
  const port = cachedConfig.comfyui_port ?? 8188;
  return `http://127.0.0.1:${port}`;
}

/**
 * Get the canonical SSE events URL (preferred realtime transport).
 */
export function getEventsUrl(): string {
  if (cachedConfig?.events_url) return cachedConfig.events_url;
  if (cachedConfig?.sse_url) return cachedConfig.sse_url;
  // Fallback derives from backend_url when config not yet loaded
  const base = getBackendUrl();
  return `${base.replace(/\/$/, "")}/api/events`;
}

/** @deprecated Use getEventsUrl() — ws:// shim kept for compat */
export function getWsUrl(): string {
  if (cachedConfig?.ws_url) return cachedConfig.ws_url;
  const base = getBackendUrl();
  return base.replace(/^http/, "ws") + "/ws";
}

/**
 * Get the ComfyUI WebSocket URL.
 */
export function getComfyuiWsUrl(): string {
  const baseUrl = getComfyuiUrl();
  return baseUrl.replace(/^http/, "ws") + "/ws";
}

/**
 * Get the Go Dashboard URL (utility SSE + health server).
 */
export function getDashboardUrl(): string {
  if (cachedConfig?.dashboard_url) return cachedConfig.dashboard_url;
  return getEnvVar("VITE_DASHBOARD_URL", "http://127.0.0.1:3847");
}
