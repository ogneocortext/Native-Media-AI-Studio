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
      cachedConfig = {
        backend_url:
          config.backend_url ||
          `http://localhost:${config.backend_port || 8000}`,
        backend_port: config.backend_port || 8000,
        frontend_port: config.frontend_port || 5173,
        ws_port: config.ws_port || config.backend_port || 8000,
        ws_url: config.ws_url,
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
  const wsPort = getEnvVar("VITE_WS_PORT", "8000"); // WebSocket on same port as backend

  cachedConfig = {
    backend_url: getEnvVar(
      "VITE_BACKEND_URL",
      `http://127.0.0.1:${backendPort}`,
    ),
    backend_port: parseInt(backendPort, 10),
    frontend_port: parseInt(frontendPort, 10),
    ws_port: parseInt(wsPort, 10),
    ws_url: `ws://127.0.0.1:${wsPort}/ws`,
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
 * The studio runs on port 3000 (see config/ports.json `video_editor_port`).
 */
export function getVideoEditorUrl(): string {
  if (!cachedConfig) {
    return "http://localhost:3000";
  }
  const port = cachedConfig.video_editor_port ?? 3000;
  return `http://localhost:${port}`;
}
