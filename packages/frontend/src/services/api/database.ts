/**
 * Frontend client for /api/database — database admin (inventory, health, maintenance).
 * Types mirror the response models in app/api/database_admin.py.
 */

import { getJson, postJson } from "./typed-fetch";
import type {
  DatabaseOverview,
  DatabaseTableDetail,
  DatabaseSchema,
  DatabaseIntegrityResult,
  DatabaseMaintenanceResult,
  DatabaseMaintenanceAction,
} from "./types";

const BASE = "/api/database";

/**
 * Get database overview (size, tables, WAL, reclaimable space).
 */
export async function getDatabaseOverview(): Promise<DatabaseOverview> {
  return getJson<DatabaseOverview>(`${BASE}/overview`, { timeout: 30000 });
}

/**
 * Get detailed table info (columns, indexes, row count, optional sizes).
 */
export async function getDatabaseTable(
  name: string,
  options: { sizes?: boolean } = {},
): Promise<DatabaseTableDetail> {
  const query = options.sizes ? "?sizes=true" : "";
  return getJson<DatabaseTableDetail>(
    `${BASE}/tables/${encodeURIComponent(name)}${query}`,
    { timeout: 30000 },
  );
}

/**
 * Get database schema version and migration status.
 */
export async function getDatabaseSchema(): Promise<DatabaseSchema> {
  return getJson<DatabaseSchema>(`${BASE}/schema`, { timeout: 30000 });
}

/**
 * Run integrity check (quick or full).
 */
export async function checkDatabaseIntegrity(full = false): Promise<DatabaseIntegrityResult> {
  return postJson<DatabaseIntegrityResult>(
    `${BASE}/integrity-check`,
    { full },
    { timeout: full ? 120000 : 30000 },
  );
}

/**
 * Run maintenance action (vacuum, analyze, checkpoint, prune).
 */
export async function runDatabaseMaintenance(
  action: DatabaseMaintenanceAction,
  options: { keepDays?: number } = {},
): Promise<DatabaseMaintenanceResult> {
  const body = options.keepDays ? { keep_days: options.keepDays } : {};
  return postJson<DatabaseMaintenanceResult>(`${BASE}/maintenance/${action}`, body, { timeout: 120000 });
}

/** Default retention windows the backend applies when keep_days is omitted. */
export const DEFAULT_KEEP_DAYS: Record<string, number> = {
  "prune-logs": 30,
  "prune-telemetry": 14,
  "prune-resources": 7,
};

/**
 * Read a numeric value out of a maintenance result's free-form detail bag.
 */
export function maintenanceDetailNumber(
  detail: Record<string, unknown>,
  key: string,
): number | null {
  const value = detail[key];
  return typeof value === "number" ? value : null;
}

export type * from "./types";
