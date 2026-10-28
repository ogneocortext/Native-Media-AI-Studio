/**
 * Fetch with timeout wrapper.
 * Wraps fetch() with a timeout to prevent hanging requests.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 30000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new Error(`Request timed out after ${options.timeout}ms`, { cause: err });
      }
      throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
