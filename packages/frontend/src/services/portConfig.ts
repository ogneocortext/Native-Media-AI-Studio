/**
 * Port Configuration Service
 *
 * Reads backend URL from config/ports.json at runtime.
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
}

// Cache for the port configuration
let cachedConfig: PortConfig | null = null;

// Environment variable fallback getters
function getEnvVar(key: string, fallback: string): string {
  return (import.meta.env as Record<string, string>)[key] || fallback;
}

/**
 * Fetch port configuration from config/ports.json
 * Falls back to environment variables or defaults if fetch fails
 */
export async function fetchPortConfig(): Promise<PortConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const response = await fetch("/config/ports.json");
    if (response.ok) {
      const config = await response.json();
      const backendPort = config.backend_port || 8000;
      cachedConfig = {
        backend_url:
          config.backend_url ||
          `http://localhost:${backendPort}`,
        backend_port: backendPort,
        frontend_port: config.frontend_port || 5173,
        // Canonical SSE endpoint; fall back to ws alias or synthesize from backend
        events_url: config.events_url || config.sse_url || `http://localhost:${backendPort}/api/events`,
        sse_url: config.sse_url || config.events_url || `http://localhost:${backendPort}/api/events`,
        // Deprecated WS alias — still populated so old code doesn't break
        ws_port: config.ws_port || backendPort,
        ws_url: config.ws_url || `ws://localhost:${backendPort}/ws`,
        video_editor_port: config.video_editor_port,
        comfyui_port: config.comfyui_port,
        comfyui_url: config.comfyui_url,
      };
      return cachedConfig;
    }
  } catch {
    // Fetch failed, fall through to env vars
  }

  // Fallback to environment variables or defaults
  return getPortConfigFromEnv();
}

/**
 * Get port configuration from environment variables
 * Priority: VITE_ prefixed env vars > defaults
 */
export function getPortConfigFromEnv(): PortConfig {
  const backendPort = getEnvVar("VITE_BACKEND_PORT", "8000");
  const frontendPort = getEnvVar("VITE_FRONTEND_PORT", "5173");
  const wsPort = getEnvVar("VITE_WS_PORT", "8000");

  const backendPortInt = parseInt(backendPort, 10);
  cachedConfig = {
    backend_url: getEnvVar(
      "VITE_BACKEND_URL",
      `http://127.0.0.1:${backendPort}`,
    ),
    backend_port: backendPortInt,
    frontend_port: parseInt(frontendPort, 10),
    // Canonical SSE endpoint
    events_url: getEnvVar("VITE_EVENTS_URL", `http://127.0.0.1:${backendPortInt}/api/events`),
    sse_url: getEnvVar("VITE_SSE_URL", getEnvVar("VITE_EVENTS_URL", `http://127.0.0.1:${backendPortInt}/api/events`)),
    // Deprecated WS alias — retained for compatibility
    ws_port: parseInt(wsPort, 10),
    ws_url: getEnvVar("VITE_WS_URL", `ws://127.0.0.1:${wsPort}/ws`),
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
    return "http://localhost:8080";
  }
  const port = cachedConfig.video_editor_port ?? 8080;
  return `http://localhost:${port}`;
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
