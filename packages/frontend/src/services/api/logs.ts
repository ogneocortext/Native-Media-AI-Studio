import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface LogInfo {
  log_directory: string;
  files: Record<string, {
    path: string;
    size_bytes: number;
    size_human: string;
    modified?: number;
  }>;
}

export interface LogContent {
  log: string;
  lines: number;
  content: string[];
}

export async function getLogInfo(): Promise<LogInfo> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log info");
  return res.json();
}

export async function getLogContent(logName: string, lines: number = 100): Promise<LogContent> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/${logName}?lines=${lines}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log content");
  return res.json();
}

export async function clearLogs(): Promise<unknown> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/clear`, { method: "POST", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to clear logs");
  return res.json();
}

export interface LogAnalyticsSummary {
  total_events: number;
  last_event_at: string | null;
  last_cleanup_at: string | null;
  levels: Array<{ level: string; count: number }>;
  top_loggers: Array<{ logger: string; count: number }>;
  top_messages: Array<{ message: string; count: number; level: string }>;
  sources: Array<{ source: string; count: number }>;
}

export interface LogAnalyticsTrendPoint {
  ts_iso: string;
  ts_ms: number;
  level: string;
  logger: string;
  message: string;
}

export interface LogAnalyticsPatterns {
  levels: Array<{ level: string; count: number }>;
  loggers: Array<{ logger: string; count: number }>;
  messages: Array<{ message: string; count: number; level: string }>;
}

export interface LogAnalyticsErrorPattern {
  message: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export interface LogAnalyticsErrors {
  errors: LogAnalyticsErrorPattern[];
}

export async function getLogAnalyticsErrors(limit = 20): Promise<LogAnalyticsErrors> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/errors?limit=${limit}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics errors");
  return res.json();
}

export interface LogAnalyticsEvent {
  ts_iso: string;
  ts_ms: number;
  level: string;
  logger: string;
  message: string;
  source: string;
}

export async function getLogAnalyticsEvents(params: {
  level?: string;
  source?: string;
  limit?: number;
} = {}): Promise<{ count: number; events: LogAnalyticsEvent[] }> {
  const base = getApiBase();
  const qs = new URLSearchParams();
  if (params.level) qs.set("level", params.level);
  if (params.source) qs.set("source", params.source);
  qs.set("limit", String(params.limit ?? 200));
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/events?${qs.toString()}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics events");
  return res.json();
}

export async function getLogAnalyticsSummary(): Promise<LogAnalyticsSummary> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/summary`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics summary");
  return res.json();
}

export async function getLogAnalyticsTrends(sinceMs?: number, limit = 5000): Promise<{ count: number; points: LogAnalyticsTrendPoint[] }> {
  const base = getApiBase();
  const params = new URLSearchParams();
  if (sinceMs !== undefined) params.set("since_ms", String(sinceMs));
  params.set("limit", String(limit));
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/trends?${params.toString()}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics trends");
  return res.json();
}

export async function getLogAnalyticsPatterns(limit = 20): Promise<LogAnalyticsPatterns> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/patterns?limit=${limit}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get log analytics patterns");
  return res.json();
}

export async function ingestLogsForAnalytics(params: {
  source?: string;
  log_name?: string;
  limit?: number;
}): Promise<{ inserted: number; source: string; path: string }> {
  const base = getApiBase();
  const body = {
    source: params.source ?? "app",
    log_name: params.log_name ?? "app",
    limit: params.limit ?? 20000,
  };
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeout: 120000,
  });
  if (!res.ok) throw new Error("Failed to ingest logs for analytics");
  return res.json();
}

export async function cleanupLogAnalytics(keepDays = 30): Promise<{ deleted: number; keep_days: number }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/logs/analytics/cleanup?keep_days=${keepDays}`, { method: "POST", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to cleanup log analytics");
  return res.json();
}
