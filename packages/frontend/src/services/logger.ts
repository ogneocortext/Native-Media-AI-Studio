/**
 * Centralized logging service for the frontend.
 * Sends log entries to the backend /api/logs/frontend endpoint for unified monitoring.
 */

import { getBackendUrl } from "./portConfig";

type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: Record<string, unknown>;
  trace_id?: string;
}

const FLUSH_INTERVAL_MS = 5000;
const MAX_QUEUE = 200;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function resolveFrontendLogUrl(): string {
  try {
    const base = getBackendUrl().replace(/\/$/, "");
    // Same-origin dev proxy serves /api/* directly; only use the absolute
    // backend URL when it differs from the page origin (detached frontend).
    if (typeof window !== "undefined" && base.startsWith(window.location.origin)) {
      return "/api/logs/frontend";
    }
    // In dev with the Vite proxy, relative URL is preferred (avoids CORS).
    // Use the direct backend URL only as a fallback when fetch fails (below).
    return "/api/logs/frontend";
  } catch {
    return "/api/logs/frontend";
  }
}

function resolveDirectBackendUrl(): string | null {
  try {
    const base = getBackendUrl().replace(/\/$/, "");
    if (typeof window !== "undefined" && base.startsWith(window.location.origin)) {
      return null; // same origin — no separate fallback needed
    }
    return `${base}/api/logs/frontend`;
  } catch {
    return null;
  }
}

class LogHub {
  private static loggers = new Set<Logger>();
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static retryCount = 0;

  static register(logger: Logger) {
    this.loggers.add(logger);
    if (this.timer === null && typeof window !== "undefined") {
      this.timer = setInterval(() => void this.flushAll(), FLUSH_INTERVAL_MS);
      const flushNow = () => void this.flushAll(true);
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushNow();
      });
      window.addEventListener("beforeunload", flushNow);
    }
  }

  static collect(): LogEntry[] {
    const entries: LogEntry[] = [];
    for (const logger of this.loggers) {
      entries.push(...logger.drain());
    }
    return entries;
  }

  static requeue(entries: LogEntry[]) {
    // Return entries to their originating logger queues (cap size).
    const bySource = new Map<string, LogEntry[]>();
    for (const e of entries) {
      const list = bySource.get(e.source) ?? [];
      list.push(e);
      bySource.set(e.source, list);
    }
    for (const logger of this.loggers) {
      const list = bySource.get(logger.source);
      if (list) logger.requeue(list);
    }
  }

  static async flushAll(isUnload = false) {
    const entries = this.collect();
    if (entries.length === 0) return;

    const payload = JSON.stringify({ entries });

    // On page hide/unload, fetch() may be cancelled — sendBeacon survives.
    if (isUnload && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      try {
        const ok = navigator.sendBeacon(
          resolveFrontendLogUrl(),
          new Blob([payload], { type: "application/json" }),
        );
        if (ok) {
          this.retryCount = 0;
          return;
        }
      } catch {
        // Fall through to fetch with keepalive.
      }
    }

    const send = async (url: string, timeoutMs: number) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal,
          keepalive: isUnload,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } finally {
        clearTimeout(timeout);
      }
    };

    try {
      await send(resolveFrontendLogUrl(), isUnload ? 4000 : 8000);
      this.retryCount = 0;
    } catch {
      // One direct-backend fallback attempt (detached frontend without proxy).
      const direct = resolveDirectBackendUrl();
      if (direct) {
        try {
          await send(direct, isUnload ? 4000 : 8000);
          this.retryCount = 0;
          return;
        } catch {
          // Fall through to requeue.
        }
      }
      this.requeue(entries);
      this.retryCount += 1;
      if (this.retryCount <= MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, this.retryCount - 1);
        setTimeout(() => void this.flushAll(), delay);
      }
    }
  }
}

class Logger {
  readonly source: string;
  private queue: LogEntry[] = [];
  private traceId: string;

  constructor(source: string) {
    this.source = source;
    this.traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    LogHub.register(this);
  }

  /** Remove up to all queued entries for a hub flush. */
  drain(): LogEntry[] {
    const entries = [...this.queue];
    this.queue = [];
    return entries;
  }

  /** Return entries to the front of the queue (cap size). */
  requeue(entries: LogEntry[]) {
    this.queue.unshift(...entries);
    if (this.queue.length > MAX_QUEUE) {
      this.queue = this.queue.slice(-MAX_QUEUE);
    }
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source: this.source,
      message,
      data,
      trace_id: this.traceId,
    };

    // Also log to console for development
    const consoleMethod = level === "ERROR" ? "error" : level === "WARNING" ? "warn" : "log";
    console[consoleMethod](`[${this.source}] ${message}`, data ?? "");

    this.queue.push(entry);
    if (this.queue.length > MAX_QUEUE) {
      this.queue = this.queue.slice(-MAX_QUEUE);
    }
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log("DEBUG", message, data);
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log("INFO", message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log("WARNING", message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    this.log("ERROR", message, data);
  }

  destroy() {
    // No per-instance timer anymore — the hub owns the single interval.
    // Flush remaining entries through the hub.
    void LogHub.flushAll(true);
  }
}

const loggers = new Map<string, Logger>();

export function getLogger(source: string): Logger {
  if (!loggers.has(source)) {
    loggers.set(source, new Logger(source));
  }
  return loggers.get(source)!;
}
