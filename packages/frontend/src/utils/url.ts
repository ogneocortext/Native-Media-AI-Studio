/**
 * URL helpers.
 *
 * ``getOutputUrl`` is the only helper defined here because it is specific to
 * output/media routing. All other URL getters live in ``services/portConfig.ts``
 * and are re-exported below so callers can import from a single module.
 */
import { getCachedConfig } from "../services/portConfig";

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

  // ComfyUI files are served from a separate endpoint
  if (relativePath.startsWith("comfyui/")) {
    const cached = getCachedConfig();
    const filePart = relativePath.substring(8);
    if (cached?.backend_url) {
      return `${cached.backend_url}/api/outputs/comfyui/${filePart}`;
    }
    return `/api/outputs/comfyui/${filePart}`;
  }

  const cached = getCachedConfig();
  if (cached?.backend_url) {
    return `${cached.backend_url}/output/${relativePath}`;
  }

  // Fallback: let the dev proxy / static host resolve /output/... for us.
  return `/output/${relativePath}`;
}

// Re-export the canonical URL getters from portConfig so callers can use
// `import { getBackendUrl } from "../../utils/url"` OR from portConfig.
export {
  getBackendUrl,
  getApiBaseUrl,
  getEventsUrl,
  getVideoEditorUrl,
  getComfyuiUrl,
  getComfyuiWsUrl,
  getDashboardUrl,
  getCachedConfig,
  fetchPortConfig,
  getPortConfigFromEnv,
} from "../services/portConfig";
