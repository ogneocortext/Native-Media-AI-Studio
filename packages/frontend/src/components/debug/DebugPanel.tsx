import { useState, useEffect, useMemo } from "react";
import { clearApiLogs, onApiLogsChange, type ApiLogEntry } from "../../services/debugApi";

function formatBytes(bytes?: number): string {
  if (bytes == null) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + units[i];
}

function statusColor(status?: number): string {
  if (status == null) return "text-gray-400";
  if (status < 300) return "text-green-400";
  if (status < 400) return "text-yellow-400";
  if (status < 500) return "text-orange-400";
  return "text-red-400";
}

function methodColor(method: string): string {
  switch (method) {
    case "GET": return "text-blue-400";
    case "POST": return "text-green-400";
    case "PUT": return "text-yellow-400";
    case "DELETE": return "text-red-400";
    case "PATCH": return "text-purple-400";
    default: return "text-gray-400";
  }
}

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const unsub = onApiLogsChange(setLogs);
    const handler = () => setOpen((prev) => !prev);
    window.addEventListener("debug-panel-toggle", handler);
    return () => {
      unsub();
      window.removeEventListener("debug-panel-toggle", handler);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return logs;
    const q = filter.toLowerCase();
    return logs.filter((l) => l.url.toLowerCase().includes(q) || l.method.toLowerCase().includes(q) || String(l.status ?? "").includes(q));
  }, [logs, filter]);

  const counts = useMemo(() => {
    let errors = 0;
    let totalMs = 0;
    let count = 0;
    for (const l of logs) {
      if (l.error || (l.status && l.status >= 400)) errors++;
      if (l.durationMs) { totalMs += l.durationMs; count++; }
    }
    return { errors, avgMs: count ? Math.round(totalMs / count) : 0, total: logs.length };
  }, [logs]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-2 rounded-lg border border-gray-700 shadow-lg font-mono"
        title="Open debug panel (Ctrl+Shift+D)"
      >
        DEBUG
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-sm font-semibold text-white">Debug Panel</h2>
            <p className="text-xs text-gray-400 mt-1">
              {counts.total} requests &middot; {counts.errors} errors &middot; avg {counts.avgMs}ms
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Filter..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 w-40"
            />
            <button
              onClick={() => clearApiLogs()}
              className="text-xs text-gray-400 hover:text-white px-2 py-1"
            >
              Clear
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-gray-400 hover:text-white px-2 py-1"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {filtered.length === 0 && (
            <p className="text-center text-gray-500 text-xs py-8">No API requests logged yet.</p>
          )}
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-3 py-2 hover:bg-gray-800/50 rounded text-xs border-b border-gray-800 last:border-0"
            >
              <span className={`font-mono font-bold ${methodColor(entry.method)}`}>{entry.method}</span>
              <span className="text-gray-300 truncate font-mono max-w-[300px]" title={entry.url}>{entry.url}</span>
              <span className={`font-mono w-12 text-right ${statusColor(entry.status)}`}>
                {entry.error ? "ERR" : entry.status ?? "-"}
              </span>
              <span className="text-gray-500 w-16 text-right">{entry.durationMs ? `${entry.durationMs}ms` : "-"}</span>
              <span className="text-gray-500 w-20 text-right font-mono">
                {formatBytes(entry.requestSize)} &rarr; {formatBytes(entry.responseSize)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
