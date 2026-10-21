/**
 * DatabasePage — SQLite storage inspector and maintenance console.
 *
 * Purpose: show what is actually on disk (file/WAL/SHM bytes, page counts,
 * schema version, per-table row counts) and expose the maintenance operations
 * the backend supports — integrity check, VACUUM, WAL checkpoint, ANALYZE and
 * the retention pruners. Every number comes from app/api/database_admin.py;
 * this page only renders and triggers.
 *
 * Routing note: /data-management is the saved-data dashboard (prompts,
 * visuals, sessions). This page is the storage/schema view. They were briefly
 * merged onto one route, which made the storage view unfindable.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, ErrorState, LoadingSpinner } from "../../components/common";
import { formatBytes } from "../../utils/format";
import { showToast } from "../../utils/toast";
import {
  DEFAULT_KEEP_DAYS,
  checkDatabaseIntegrity,
  getDatabaseOverview,
  getDatabaseSchema,
  getDatabaseTable,
  maintenanceDetailNumber,
  runDatabaseMaintenance,
  type DatabaseIntegrityResult,
  type DatabaseMaintenanceAction,
  type DatabaseMaintenanceResult,
  type DatabaseOverview,
  type DatabaseSchema,
  type DatabaseTableDetail,
} from "../../services/api/database";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Table2,
  Wrench,
  X,
} from "lucide-react";

const ACTIONS: DatabaseMaintenanceAction[] = [
  "vacuum",
  "wal-checkpoint",
  "analyze",
  "prune-logs",
  "prune-telemetry",
  "prune-resources",
];

const ACTION_LABELS: Record<DatabaseMaintenanceAction, string> = {
  vacuum: "VACUUM",
  "wal-checkpoint": "Checkpoint WAL",
  analyze: "ANALYZE",
  "prune-logs": "Prune logs",
  "prune-telemetry": "Prune telemetry",
  "prune-resources": "Prune resources",
};

const ACTION_HINTS: Record<DatabaseMaintenanceAction, string> = {
  vacuum: "Rewrite the file and return free pages to the filesystem",
  "wal-checkpoint": "Fold the -wal file back into the main database",
  analyze: "Refresh the query planner's statistics",
  "prune-logs": "Delete log rows older than the retention window",
  "prune-telemetry": "Delete telemetry rows older than the retention window",
  "prune-resources": "Delete stale resource samples",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-black/20 p-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-1">{value}</div>
      {hint && <div className="text-xs text-muted/70 mt-0.5">{hint}</div>}
    </div>
  );
}

export function DatabasePage() {
  const [overview, setOverview] = useState<DatabaseOverview | null>(null);
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<"quick" | "full" | null>(null);
  const [integrity, setIntegrity] = useState<DatabaseIntegrityResult | null>(null);
  const [running, setRunning] = useState<DatabaseMaintenanceAction | null>(null);
  const [lastRun, setLastRun] = useState<DatabaseMaintenanceResult | null>(null);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [detail, setDetail] = useState<DatabaseTableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const pendingTable = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextSchema] = await Promise.all([
        getDatabaseOverview(),
        getDatabaseSchema(),
      ]);
      setOverview(nextOverview);
      setSchema(nextSchema);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = async (full: boolean) => {
    setChecking(full ? "full" : "quick");
    try {
      const result = await checkDatabaseIntegrity(full);
      setIntegrity(result);
      showToast(
        result.ok ? "Integrity check passed" : "Integrity check found problems",
        result.ok ? "success" : "error",
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Integrity check failed", "error");
    } finally {
      setChecking(null);
    }
  };

  const runMaintenance = async (action: DatabaseMaintenanceAction) => {
    setRunning(action);
    try {
      const keepDays = DEFAULT_KEEP_DAYS[action];
      const result = await runDatabaseMaintenance(action, keepDays ? { keepDays } : {});
      setLastRun(result);
      const label = ACTION_LABELS[action];
      showToast(
        result.freed_bytes > 0
          ? `${label} freed ${formatBytes(result.freed_bytes)}`
          : `${label} completed`,
        "success",
      );
      // VACUUM and the pruners change the numbers on screen.
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : `${ACTION_LABELS[action]} failed`, "error");
    } finally {
      setRunning(null);
    }
  };

  const toggleTable = async (name: string) => {
    if (openTable === name) {
      pendingTable.current = null;
      setOpenTable(null);
      setDetail(null);
      return;
    }
    pendingTable.current = name;
    setOpenTable(name);
    setDetail(null);
    setDetailLoading(true);
    try {
      const nextDetail = await getDatabaseTable(name, { sizes: true });
      if (pendingTable.current === name) setDetail(nextDetail);
    } catch (e) {
      if (pendingTable.current === name) {
        showToast(e instanceof Error ? e.message : `Failed to load table "${name}"`, "error");
        setOpenTable(null);
      }
    } finally {
      if (pendingTable.current === name) setDetailLoading(false);
    }
  };

  if (loading && !overview && !error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-muted">Loading database overview…</p>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <ErrorState
        title="Database overview unavailable"
        description={error}
        retry={{ label: "Retry", onClick: () => void load() }}
      />
    );
  }

  const pruned = lastRun
    ? (maintenanceDetailNumber(lastRun.detail, "deleted") ??
      maintenanceDetailNumber(lastRun.detail, "deleted_rows") ??
      maintenanceDetailNumber(lastRun.detail, "pruned"))
    : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="text-accent" size={24} />
            Database
          </h1>
          <p className="text-muted mt-1">
            SQLite storage, schema state and maintenance for the studio database
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <Card className="border-red-500/40 bg-red-500/10">
          <div className="text-sm text-red-300">{error}</div>
        </Card>
      )}

      <Card title="Storage" icon={<HardDrive size={18} />}>
        {overview ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="File" value={formatBytes(overview.file_bytes)} />
              <Stat
                label="WAL"
                value={formatBytes(overview.wal_bytes)}
                hint="Uncheckpointed writes"
              />
              <Stat label="SHM" value={formatBytes(overview.shm_bytes)} hint="WAL index" />
              <Stat
                label="Reclaimable"
                value={formatBytes(overview.reclaimable_bytes)}
                hint="What VACUUM returns"
              />
              <Stat label="Page size" value={`${overview.page_size} B`} />
              <Stat
                label="Pages"
                value={overview.page_count.toLocaleString()}
                hint={`${overview.freelist_count.toLocaleString()} free`}
              />
              <Stat label="Journal mode" value={overview.journal_mode.toUpperCase()} />
              <Stat
                label="Objects"
                value={`${overview.table_count} tables`}
                hint={`${overview.view_count} views · ${overview.index_count} indexes`}
              />
            </div>
            <div className="mt-3 text-xs text-muted font-mono break-all">{overview.path}</div>
          </>
        ) : (
          <div className="text-sm text-muted">No overview loaded</div>
        )}
      </Card>

      <Card title="Schema" icon={<Layers size={18} />}>
        {schema ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1">
                {schema.up_to_date ? (
                  <Check size={14} className="text-green-400" />
                ) : (
                  <X size={14} className="text-amber-400" />
                )}
                Schema v{schema.schema_version} of v{schema.target_schema_version}
              </span>
              <span className="text-muted">
                {schema.up_to_date ? "Up to date" : "Migrations pending"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5" role="list" aria-label="Schema migrations">
              {schema.migrations.map((migration) => (
                <span
                  key={migration.version}
                  role="listitem"
                  title={migration.applied ? "Applied" : "Not applied"}
                  className={`rounded px-1.5 py-0.5 text-xs tabular-nums border ${
                    migration.applied
                      ? "border-green-500/30 bg-green-500/10 text-green-300"
                      : "border-border/60 text-muted"
                  }`}
                >
                  {migration.version}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted">No schema information loaded</div>
        )}
      </Card>

      <Card
        title="Integrity"
        icon={<ShieldCheck size={18} />}
        headerActions={
          <>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void runCheck(false)}
              disabled={checking !== null}
            >
              {checking === "quick" && <Loader2 size={14} className="animate-spin" />}
              Quick check
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void runCheck(true)}
              disabled={checking !== null}
            >
              {checking === "full" && <Loader2 size={14} className="animate-spin" />}
              Full check
            </button>
          </>
        }
      >
        {integrity ? (
          <div className="space-y-2">
            <div
              className={`flex items-center gap-2 text-sm font-medium ${
                integrity.ok ? "text-green-400" : "text-red-400"
              }`}
            >
              {integrity.ok ? <Check size={16} /> : <X size={16} />}
              {integrity.ok ? "No problems found" : "Problems found"}
              <span className="text-muted font-normal">
                ({integrity.mode}, {integrity.duration_ms} ms)
              </span>
            </div>
            {integrity.messages.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded border border-border/60 bg-black/30 p-2 font-mono text-xs text-muted">
                {integrity.messages.map((message, index) => (
                  <div key={index}>{message}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">
            Quick check scans the schema and b-tree structure; the full check walks every page
            and can take considerably longer on a large file.
          </p>
        )}
      </Card>

      <Card title="Maintenance" icon={<Wrench size={18} />}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((action) => {
              const keepDays = DEFAULT_KEEP_DAYS[action];
              return (
                <button
                  key={action}
                  className={`btn btn-sm ${action === "vacuum" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => void runMaintenance(action)}
                  disabled={running !== null}
                  title={
                    keepDays
                      ? `${ACTION_HINTS[action]} (keeps ${keepDays} days)`
                      : ACTION_HINTS[action]
                  }
                >
                  {running === action && <Loader2 size={14} className="animate-spin" />}
                  {ACTION_LABELS[action]}
                </button>
              );
            })}
          </div>
          {lastRun ? (
            <div className="text-xs text-muted">
              Last run: <span className="text-white">{ACTION_LABELS[lastRun.action as DatabaseMaintenanceAction] ?? lastRun.action}</span>{" "}
              in {lastRun.duration_ms} ms
              {lastRun.freed_bytes > 0 && <> · freed {formatBytes(lastRun.freed_bytes)}</>}
              {pruned !== null && <> · removed {pruned.toLocaleString()} rows</>}
              {" · "}
              {formatBytes(lastRun.before_bytes)} → {formatBytes(lastRun.after_bytes)}
            </div>
          ) : (
            <p className="text-xs text-muted">
              VACUUM rewrites the database file; the pruners delete rows outside their
              retention window. Every action is safe to re-run.
            </p>
          )}
        </div>
      </Card>

      <Card title="Tables" icon={<Table2 size={18} />}>
        {overview ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-1.5 pr-2 font-medium">Name</th>
                  <th className="py-1.5 pr-2 font-medium">Type</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Rows</th>
                </tr>
              </thead>
              <tbody>
                {overview.tables.map((table) => {
                  const isOpen = openTable === table.name;
                  return (
                    <tr
                      key={table.name}
                      className="border-b border-border/50 hover:bg-white/5 cursor-pointer"
                      onClick={() => void toggleTable(table.name)}
                      aria-expanded={isOpen}
                    >
                      <td className="py-1.5 pr-2 font-mono">
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {table.name}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-muted">{table.type}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {table.rows < 0 ? "—" : table.rows.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {openTable && (
              <div className="mt-3 rounded-lg border border-border/60 bg-black/20 p-3">
                {detailLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 size={14} className="animate-spin" /> Loading {openTable}…
                  </div>
                ) : detail ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span className="font-mono text-white">{detail.name}</span>
                      <span>{detail.rows.toLocaleString()} rows</span>
                      <span>{detail.columns.length} columns</span>
                      <span>{detail.indexes.length} indexes</span>
                      {detail.indexes_bytes !== null && (
                        <span>{formatBytes(detail.indexes_bytes)} on disk</span>
                      )}
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted border-b border-border">
                          <th className="py-1 pr-2 font-medium">Column</th>
                          <th className="py-1 pr-2 font-medium">Type</th>
                          <th className="py-1 pr-2 font-medium">Not null</th>
                          <th className="py-1 pr-2 font-medium">Default</th>
                          <th className="py-1 pr-2 font-medium">PK</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.columns.map((column) => (
                          <tr key={column.name} className="border-b border-border/30">
                            <td className="py-1 pr-2 font-mono">{column.name}</td>
                            <td className="py-1 pr-2 text-muted">{column.type || "—"}</td>
                            <td className="py-1 pr-2">{column.notnull ? "yes" : ""}</td>
                            <td className="py-1 pr-2 font-mono text-muted">
                              {column.default ?? "—"}
                            </td>
                            <td className="py-1 pr-2">{column.primary_key ? "yes" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {detail.indexes.length > 0 && (
                      <div className="space-y-1">
                        {detail.indexes.map((index) => (
                          <div key={index.name} className="text-xs text-muted">
                            <span className="font-mono text-white">{index.name}</span>
                            {index.unique && <span className="ml-1 text-accent">unique</span>}
                            <span className="ml-1">({index.columns.join(", ")})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted">No detail available</div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted">No tables loaded</div>
        )}
      </Card>

      <div className="text-xs text-muted">
        These numbers come straight from SQLite: file, WAL and SHM sizes are read from disk, row
        counts are exact <span className="font-mono">COUNT(*)</span> queries.
      </div>
    </div>
  );
}

export default DatabasePage;
