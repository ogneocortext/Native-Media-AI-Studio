/**
 * Fetch with timeout wrapper.
 * Wraps fetch() with a timeout to prevent hanging requests.
 * Automatically records API timing metrics under api.<endpoint>.duration
 * and api.<endpoint>.count for the ApiPerformanceCard dashboard.
 */
import { recordApiTiming } from "../../utils/metrics";

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 30000);
  const start = performance.now();
  let success = false;

  // Extract endpoint name from URL path for metrics grouping.
  // e.g. http://localhost:8000/api/audio/upload → "audio.upload"
  const endpointName = (() => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      // Skip the "/api" prefix and join the rest
      const apiIndex = pathParts.indexOf("api");
      if (apiIndex >= 0) {
        return pathParts.slice(apiIndex + 1).join(".");
      }
      return pathParts.join(".");
    } catch {
      return "unknown";
    }
  })();

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    success = response.ok;
    return response;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Request timed out after ${options.timeout}ms`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    const duration = performance.now() - start;
    recordApiTiming(endpointName, duration, success);
  }
}
