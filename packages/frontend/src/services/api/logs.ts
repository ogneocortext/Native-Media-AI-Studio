/**
 * Frontend client for /api/logs — log access and analytics.
 */

import { getJson, postJson } from "./typed-fetch";
import type {
  LogInfo,
  LogContent,
  LogAnalyticsSummary,
  LogAnalyticsTrendPoint,
  LogAnalyticsPatterns,
  LogAnalyticsErrors,
  LogAnalyticsEvent,
} from "./types";

const BASE = "/api/logs";

/**
 * Get log directory info and file listing.
 */
export async function getLogInfo(): Promise<LogInfo> {
  return getJson<LogInfo>(BASE, { timeout: 30000 });
}

/**
 * Get log content (last N lines).
 */
export async function getLogContent(logName: string, lines = 100): Promise<LogContent> {
  return getJson<LogContent>(`${BASE}/${logName}?lines=${lines}`, { timeout: 30000 });
}

/**
 * Clear all log files.
 */
export async function clearLogs(): Promise<unknown> {
  return postJson<unknown>(`${BASE}/clear`, {}, { timeout: 30000 });
}

/**
 * Get log analytics summary (levels, top loggers, messages, sources).
 */
export async function getLogAnalyticsSummary(): Promise<LogAnalyticsSummary> {
  return getJson<LogAnalyticsSummary>(`${BASE}/analytics/summary`, { timeout: 30000 });
}

/**
 * Get log analytics errors (top error patterns).
 */
export async function getLogAnalyticsErrors(limit = 20): Promise<LogAnalyticsErrors> {
  return getJson<LogAnalyticsErrors>(`${BASE}/analytics/errors?limit=${limit}`, { timeout: 30000 });
}

/**
 * Get log analytics events (filtered by level/source).
 */
export async function getLogAnalyticsEvents(params: {
  level?: string;
  source?: string;
  limit?: number;
} = {}): Promise<{ count: number; events: LogAnalyticsEvent[] }> {
  const qs = new URLSearchParams();
  if (params.level) qs.set("level", params.level);
  if (params.source) qs.set("source", params.source);
  qs.set("limit", String(params.limit ?? 200));
  return getJson<{ count: number; events: LogAnalyticsEvent[] }>(
    `${BASE}/analytics/events?${qs.toString()}`,
    { timeout: 30000 },
  );
}

/**
 * Get log analytics trends (time-series data).
 */
export async function getLogAnalyticsTrends(
  sinceMs?: number,
  limit = 5000,
): Promise<{ count: number; points: LogAnalyticsTrendPoint[] }> {
  const params = new URLSearchParams();
  if (sinceMs !== undefined) params.set("since_ms", String(sinceMs));
  params.set("limit", String(limit));
  return getJson<{ count: number; points: LogAnalyticsTrendPoint[] }>(
    `${BASE}/analytics/trends?${params.toString()}`,
    { timeout: 30000 },
  );
}

/**
 * Get log analytics patterns (levels, loggers, messages).
 */
export async function getLogAnalyticsPatterns(limit = 20): Promise<LogAnalyticsPatterns> {
  return getJson<LogAnalyticsPatterns>(`${BASE}/analytics/patterns?limit=${limit}`, { timeout: 30000 });
}

/**
 * Ingest logs for analytics (parse and store in SQLite).
 */
export async function ingestLogsForAnalytics(params: {
  source?: string;
  log_name?: string;
  limit?: number;
}): Promise<{ inserted: number; source: string; path: string }> {
  const body = {
    source: params.source ?? "app",
    log_name: params.log_name ?? "app",
    limit: params.limit ?? 20000,
  };
  return postJson<{ inserted: number; source: string; path: string }>(
    `${BASE}/analytics/ingest`,
    body,
    { timeout: 120000 },
  );
}

/**
 * Cleanup old log analytics data.
 */
export async function cleanupLogAnalytics(
  keepDays = 30,
): Promise<{ deleted: number; keep_days: number }> {
  return postJson<{ deleted: number; keep_days: number }>(
    `${BASE}/analytics/cleanup?keep_days=${keepDays}`,
    {},
    { timeout: 30000 },
  );
}