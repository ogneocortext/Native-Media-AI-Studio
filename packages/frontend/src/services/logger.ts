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
}

class Logger {
  private source: string;
  private queue: LogEntry[] = [];
  private flushInterval: number = 5000;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(source: string) {
    this.source = source;
    this.startFlushInterval();
  }

  private startFlushInterval() {
    this.intervalId = setInterval(() => this.flush(), this.flushInterval);
  }

  private async flush() {
    if (this.queue.length === 0) return;

    const entries = [...this.queue];
    this.queue = [];

    try {
      await fetch("/api/logs/frontend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
    } catch {
      // Backend not available, keep in queue for next flush
      this.queue.unshift(...entries);
      if (this.queue.length > 100) {
        this.queue = this.queue.slice(-100);
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
    }
    this.flush();
  }
}

const loggers = new Map<string, Logger>();

export function getLogger(source: string): Logger {
  if (!loggers.has(source)) {
    loggers.set(source, new Logger(source));
  }
  return loggers.get(source)!;
}
