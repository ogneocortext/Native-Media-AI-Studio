/**
 * Debug API service — wraps global fetch to log every request/response
 * for in-app inspection. The DebugPanel consumes this log.
 */

export interface ApiLogEntry {
  id: number;
  timestamp: number;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  requestSize?: number;
  responseSize?: number;
  error?: string;
}

const MAX_LOG_ENTRIES = 200;
let entries: ApiLogEntry[] = [];
let nextId = 1;
const listeners = new Set<(entries: ApiLogEntry[]) => void>();

function notify() {
  listeners.forEach((fn) => fn([...entries]));
}

export function getApiLogs(): ApiLogEntry[] {
  return [...entries];
}

export function clearApiLogs() {
  entries = [];
  nextId = 1;
  notify();
}

export function onApiLogsChange(fn: (entries: ApiLogEntry[]) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function addEntry(entry: Omit<ApiLogEntry, "id">) {
  entries = [...entries, { ...entry, id: nextId++ }];
  if (entries.length > MAX_LOG_ENTRIES) {
    entries = entries.slice(-MAX_LOG_ENTRIES);
  }
  notify();
}

function requestSize(body?: BodyInit | null): number {
  if (!body) return 0;
  if (typeof body === "string") return new Blob([body]).size;
  if (body instanceof Blob) return body.size;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return 0;
}

export function installDebugFetch() {
  if (typeof window === "undefined") return;
  if ((window as unknown as Record<string, unknown>).__debugFetchInstalled) return;
  (window as unknown as Record<string, unknown>).__debugFetchInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const start = performance.now();
    const reqSize = requestSize(init?.body);

    try {
      const response = await originalFetch(input, init);
      const end = performance.now();
      const cloned = response.clone();
      const resSize = cloned instanceof Response ? cloned.headers.get("content-length") : undefined;

      addEntry({
        timestamp: Date.now(),
        method,
        url,
        status: response.status,
        durationMs: Math.round(end - start),
        requestSize: reqSize || undefined,
        responseSize: resSize ? Number(resSize) : undefined,
      });

      return response;
    } catch (error) {
      const end = performance.now();
      addEntry({
        timestamp: Date.now(),
        method,
        url,
        durationMs: Math.round(end - start),
        requestSize: reqSize || undefined,
        error: error instanceof Error ? error.message : "Network error",
      });
      throw error;
    }
  };
}
