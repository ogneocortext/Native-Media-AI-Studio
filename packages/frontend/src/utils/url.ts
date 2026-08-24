/**
 * URL helpers.
 * Single source of truth for resolving output file URLs, using the
 * dynamic port configuration instead of hardcoded hosts / localStorage.
 */
import { getCachedConfig, getBackendUrl } from "../services/portConfig";

/**
 * Build a browser URL for a stored output file.
 * Falls back gracefully when the port config has not been fetched yet.
 */
export function getOutputUrl(relativePath: string): string {
  if (!relativePath) return "";

  // Relative output paths are proxied by Vite in dev / served alongside the app.
  if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
    return relativePath;
  }

  const cached = getCachedConfig();
  if (cached?.backend_url) {
    return `${cached.backend_url}/output/${relativePath}`;
  }

  // Fallback: let the dev proxy / static host resolve /output/... for us.
  return `/output/${relativePath}`;
}

/**
 * Resolved backend API base URL. Prefer `getBackendUrl()` (portConfig) so all
 * HTTP calls agree on the same origin.
 */
export function getApiBaseUrl(): string {
  const cached = getCachedConfig();
  if (cached?.backend_url) return cached.backend_url;
  const fromConfig = getBackendUrl();
  return fromConfig || "/";
}