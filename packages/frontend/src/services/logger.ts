/**
 * Centralized logging service for the frontend.
 * Sends log entries to the backend /api/logs/ endpoint for unified monitoring.
 */

type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: Record<string, unknown>;
  trace_id?: string;
}

class Logger {
  private source: string;
  private queue: LogEntry[] = [];
  private flushInterval: number = 5000;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private traceId: string;
  private retryCount: number = 0;
  private maxRetries: number = 3;
  private baseDelay: number = 1000;

  constructor(source: string) {
    this.source = source;
    this.traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.startFlushInterval();
    this.installUnloadHook();
  }

  private installUnloadHook() {
    if (typeof window === "undefined") return;
    const flushNow = () => this.flush(true);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushNow();
    });
    window.addEventListener("beforeunload", flushNow);
  }

  private startFlushInterval() {
    this.intervalId = setInterval(() => this.flush(), this.flushInterval);
  }

  private async flush(isUnload: boolean = false) {
    if (this.queue.length === 0) return;

    const entries = [...this.queue];
    this.queue = [];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), isUnload ? 4000 : 8000);
      await fetch("/api/logs/frontend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this.retryCount = 0;
    } catch {
      // Backend not available, keep in queue for next flush (cap size).
      this.queue.unshift(...entries);
      if (this.queue.length > 200) {
        this.queue = this.queue.slice(-200);
      }
      this.retryCount += 1;
      if (this.retryCount <= this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, this.retryCount - 1);
        setTimeout(() => this.flush(), delay);
      }
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
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.flush(true);
  }
}

const loggers = new Map<string, Logger>();

export function getLogger(source: string): Logger {
  if (!loggers.has(source)) {
    loggers.set(source, new Logger(source));
  }
  return loggers.get(source)!;
}
