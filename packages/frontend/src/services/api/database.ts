import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

// Types mirror the response models in app/api/database_admin.py.

export interface DatabaseTableSummary {
  name: string;
  type: string;
  /** Exact COUNT(*). -1 means the table could not be read. */
  rows: number;
}

export interface DatabaseOverview {
  path: string;
  exists: boolean;
  schema_version: number;
  target_schema_version: number;
  journal_mode: string;
  page_size: number;
  page_count: number;
  freelist_count: number;
  /** Free pages times page size — what VACUUM would return to the filesystem. */
  reclaimable_bytes: number;
  file_bytes: number;
  wal_bytes: number;
  shm_bytes: number;
  table_count: number;
  view_count: number;
  index_count: number;
  tables: DatabaseTableSummary[];
  last_activity: Record<string, string | null>;
}

export interface DatabaseColumnInfo {
  name: string;
  type: string;
  notnull: boolean;
  default: string | null;
  primary_key: boolean;
}

export interface DatabaseIndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface DatabaseTableDetail {
  name: string;
  type: string;
  rows: number;
  columns: DatabaseColumnInfo[];
  indexes: DatabaseIndexInfo[];
  /** dbstat page bytes for the table + its indexes; null when dbstat is unavailable. */
  indexes_bytes: number | null;
}

export interface DatabaseMigrationInfo {
  version: number;
  applied: boolean;
}

export interface DatabaseSchema {
  schema_version: number;
  target_schema_version: number;
  up_to_date: boolean;
  migrations: DatabaseMigrationInfo[];
}

export interface DatabaseIntegrityResult {
  ok: boolean;
  /** "quick_check" or "integrity_check". */
  mode: string;
  duration_ms: number;
  messages: string[];
}

export interface DatabaseMaintenanceResult {
  action: string;
  ok: boolean;
  duration_ms: number;
  before_bytes: number;
  after_bytes: number;
  freed_bytes: number;
  detail: Record<string, unknown>;
}

export type DatabaseMaintenanceAction =
  | "vacuum"
  | "wal-checkpoint"
  | "analyze"
  | "prune-logs"
  | "prune-telemetry"
  | "prune-resources";

/** Default retention windows the backend applies when keep_days is omitted. */
export const DEFAULT_KEEP_DAYS: Record<string, number> = {
  "prune-logs": 30,
  "prune-telemetry": 14,
  "prune-resources": 7,
};

/** Read a numeric value out of a maintenance result's free-form detail bag. */
export function maintenanceDetailNumber(
  detail: Record<string, unknown>,
  key: string,
): number | null {
  const value = detail[key];
  return typeof value === "number" ? value : null;
}

async function readError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body: unknown = await res.json();
    const envelope = body as {
      error?: { message?: string };
      detail?: string;
    };
    message = envelope.error?.message ?? envelope.detail ?? fallback;
  } catch {
    // Non-JSON error body; keep the fallback message.
  }
  throw new Error(message);
}

export async function getDatabaseOverview(): Promise<DatabaseOverview> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/database/overview`, { timeout: 30000 });
  if (!res.ok) return readError(res, "Failed to load database overview");
  return res.json();
}

export async function getDatabaseTable(
  name: string,
  options: { sizes?: boolean } = {},
): Promise<DatabaseTableDetail> {
  const base = getApiBase();
  const query = options.sizes ? "?sizes=true" : "";
  const res = await fetchWithTimeout(
    `${base}/api/database/tables/${encodeURIComponent(name)}${query}`,
    { timeout: 30000 },
  );
  if (!res.ok) return readError(res, `Failed to load table "${name}"`);
  return res.json();
}

export async function getDatabaseSchema(): Promise<DatabaseSchema> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/database/schema`, { timeout: 30000 });
  if (!res.ok) return readError(res, "Failed to load database schema");
  return res.json();
}

export async function checkDatabaseIntegrity(full = false): Promise<DatabaseIntegrityResult> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/database/integrity-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full }),
    // A full integrity_check walks every page of the file.
    timeout: full ? 120000 : 30000,
  });
  if (!res.ok) return readError(res, "Integrity check failed");
  return res.json();
}

export async function runDatabaseMaintenance(
  action: DatabaseMaintenanceAction,
  options: { keepDays?: number } = {},
): Promise<DatabaseMaintenanceResult> {
  const base = getApiBase();
  const body = options.keepDays ? { keep_days: options.keepDays } : {};
  const res = await fetchWithTimeout(`${base}/api/database/maintenance/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // VACUUM rewrites the whole file.
    timeout: 120000,
  });
  if (!res.ok) return readError(res, `Maintenance action "${action}" failed`);
  return res.json();
}
