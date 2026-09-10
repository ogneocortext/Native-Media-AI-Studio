/**
 * Log Analytics — trend analysis and pattern detection for application logs.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  FileText,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  AlertTriangle,
  Activity,
  BarChart3,
  Trash2,
  Hash,
  Zap,
  Info,
  Clock,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card } from "../../components/common";
import {
  getLogAnalyticsSummary,
  getLogAnalyticsTrends,
  getLogAnalyticsPatterns,
  getLogAnalyticsErrors,
  getLogAnalyticsEvents,
  ingestLogsForAnalytics,
  cleanupLogAnalytics,
  type LogAnalyticsSummary,
  type LogAnalyticsTrendPoint,
  type LogAnalyticsPatterns,
  type LogAnalyticsErrorPattern,
  type LogAnalyticsEvent,
} from "../../services/api";

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: "#6b7280",
  INFO: "#3b82f6",
  WARNING: "#f59e0b",
  ERROR: "#ef4444",
  CRITICAL: "#dc2626",
};

const RANGES = [
  { label: "24h", ms: 86400 * 1000 },
  { label: "7d", ms: 7 * 86400 * 1000 },
  { label: "30d", ms: 30 * 86400 * 1000 },
  { label: "All", ms: null },
];

export function LogAnalytics() {
  const [summary, setSummary] = useState<LogAnalyticsSummary | null>(null);
  const [events, setEvents] = useState<LogAnalyticsEvent[]>([]);
  const [patterns, setPatterns] = useState<LogAnalyticsPatterns | null>(null);
  const [errorPatterns, setErrorPatterns] = useState<LogAnalyticsErrorPattern[]>([]);
  const [range, setRange] = useState<string>("All");
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<string>("app");
  const [eventLevelFilter, setEventLevelFilter] = useState<string>("ALL");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [summaryData, patternsData, errorsData, eventsData] = await Promise.all([
        getLogAnalyticsSummary(),
        getLogAnalyticsPatterns(20),
        getLogAnalyticsErrors(20),
        getLogAnalyticsEvents({
          level: eventLevelFilter === "ALL" ? undefined : eventLevelFilter,
          limit: 2000,
        }),
      ]);
      setSummary(summaryData);
      setPatterns(patternsData);
      setErrorPatterns(errorsData.errors || []);
      setEvents(eventsData.events || []);
      setLastRefreshed(new Date());
    } catch (e) {
      console.error("Failed to refresh log analytics:", e);
    }
  }, [eventLevelFilter]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refreshAll, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshAll]);

  const getRelativeTime = (iso?: string | null) => {
    if (!iso) return "No data";
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const handleIngest = async () => {
    setIngesting(true);
    setIngestResult(null);
    try {
      const result = await ingestLogsForAnalytics({ source: selectedLog, log_name: selectedLog, limit: 20000 });
      setIngestResult(`Ingested ${result.inserted} events from ${result.path}`);
      await refreshAll();
    } catch (e) {
      setIngestResult(`Ingest failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIngesting(false);
    }
  };

  const handleCleanup = async () => {
    if (!confirm("Delete log analytics data older than 30 days?")) return;
    try {
      const result = await cleanupLogAnalytics(30);
      setIngestResult(`Cleaned up ${result.deleted} old events`);
      await refreshAll();
    } catch (e) {
      setIngestResult(`Cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const timelineData = useMemo(() => {
    const buckets = new Map<string, { time: string; count: number; errors: number }>();
    for (const entry of events) {
      const minute = entry.ts_iso.slice(0, 16);
      const existing = buckets.get(minute) || { time: minute, count: 0, errors: 0 };
      existing.count += 1;
      if (entry.level === "ERROR" || entry.level === "CRITICAL") existing.errors += 1;
      buckets.set(minute, existing);
    }
    return Array.from(buckets.values()).slice(-60);
  }, [events]);

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of patterns?.levels || []) {
      counts[entry.level] = entry.count;
    }
    return counts;
  }, [patterns]);

  const pieData = useMemo(
    () =>
      Object.entries(levelCounts)
        .map(([name, value]) => ({ name, value, fill: LEVEL_COLORS[name] || "#6b7280" }))
        .filter((d) => d.value > 0),
    [levelCounts],
  );

  const topErrors = useMemo(
    () => (errorPatterns || []).slice(0, 10),
    [errorPatterns],
  );

  return (
    <div className="p-6 animate-fade-in h-full flex flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="text-accent" size={24} />
            Log Analytics
          </h1>
          <p className="text-muted mt-1">Trend analysis and pattern detection across application logs</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-sm btn-primary"
            onClick={handleIngest}
            disabled={ingesting}
          >
            {ingesting ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />}
            {ingesting ? "Ingesting..." : "Ingest Logs"}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={handleCleanup}>
            <Trash2 size={14} />
            Cleanup
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={refreshAll}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {ingestResult && (
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs">
          {ingestResult}
        </div>
      )}

      {summary && summary.last_cleanup_at && (
        <div className="mb-4 p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-[10px] flex items-center gap-2 text-emerald-300">
          <Activity size={12} className="shrink-0" />
          <span>
            Auto-cleanup ran on {new Date(summary.last_cleanup_at).toLocaleString()} — events older than 30 days removed.
          </span>
        </div>
      )}

      {summary && summary.total_events > 10000 && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-400 shrink-0" />
          <span>
            High event count ({summary.total_events.toLocaleString()}). Run Cleanup to remove events older than 30 days.
          </span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Card className="p-3">
          <div className="text-xs text-muted uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <Hash size={12} /> Total Events
          </div>
          <p className="text-2xl font-bold tabular-nums">{summary?.total_events?.toLocaleString() || 0}</p>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <AlertCircle size={12} className="text-error" /> Errors
          </div>
          <p className="text-2xl font-bold tabular-nums text-error">
            {(summary?.levels.find((l) => l.level === "ERROR")?.count || 0) +
              (summary?.levels.find((l) => l.level === "CRITICAL")?.count || 0)}
          </p>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <Zap size={12} className="text-warning" /> Warnings
          </div>
          <p className="text-2xl font-bold tabular-nums text-warning">
            {summary?.levels.find((l) => l.level === "WARNING")?.count || 0}
          </p>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <Info size={12} className="text-info" /> Info
          </div>
          <p className="text-2xl font-bold tabular-nums text-info">
            {summary?.levels.find((l) => l.level === "INFO")?.count || 0}
          </p>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <Clock size={12} /> Last Event
          </div>
          <p className="text-sm font-medium tabular-nums mt-1">
            {getRelativeTime(summary?.last_event_at)}
          </p>
        </Card>
      </div>

      {/* Source Breakdown */}
      {summary && summary.sources && summary.sources.length > 0 && (
        <div className="mb-4 p-3 bg-white/5 border border-border rounded-lg">
          <div className="text-[10px] text-muted uppercase tracking-wide mb-2">Sources</div>
          <div className="flex flex-wrap gap-2">
            {summary.sources.map((s) => (
              <span key={s.source} className="text-[10px] bg-white/5 border border-border rounded-full px-2 py-0.5 tabular-nums">
                {s.source}: {s.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <select
          value={selectedLog}
          onChange={(e) => setSelectedLog(e.target.value)}
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs"
        >
          <option value="app">app.log</option>
          <option value="error">error.log</option>
          <option value="queue">queue.log</option>
          <option value="comfyui">comfyui.log</option>
        </select>
        <button
          className="btn btn-sm btn-primary"
          onClick={handleIngest}
          disabled={ingesting}
        >
          {ingesting ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />}
          {ingesting ? "Ingesting..." : "Ingest Logs"}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={handleCleanup}>
          <Trash2 size={14} />
          Cleanup
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={refreshAll}
        >
          <RefreshCw size={14} />
        </button>
        <label className="flex items-center gap-1.5 text-[10px] text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="accent-primary"
          />
          Auto-refresh (30s)
        </label>
        {lastRefreshed && (
          <span className="text-[10px] text-muted tabular-nums">
            Updated {lastRefreshed.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Range controls */}
      <div className="mb-4 flex items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.label}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all font-medium ${
              range === r.label
                ? "bg-primary/15 text-primary border border-primary/40 shadow-sm shadow-primary/20"
                : "bg-background border border-border hover:border-border/80 hover:bg-white/5"
            }`}
            onClick={() => setRange(r.label)}
          >
            {r.label}
          </button>
        ))}
        <span className="text-[10px] text-muted ml-2">
          {timelineData.length > 0 && `${timelineData.length} data points`}
        </span>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Timeline */}
        <Card className="p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <TrendingUp size={14} className="text-accent" />
            Activity Timeline
          </h3>
          {timelineData.length > 0 ? (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <defs>
                    <linearGradient id="logTimelineGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10 }}
                    stroke="#6b7280"
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="#6b7280"
                    width={30}
                    tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--background)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(value: any, name: any) => {
                      if (name === "errors") return [`${value} errors`, "Errors"];
                      return [`${value} entries`, "Logs"];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    fill="url(#logTimelineGrad)"
                    animationDuration={500}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="errors"
                    stroke="#ef4444"
                    strokeWidth={2}
                    fill="none"
                    animationDuration={500}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-muted text-xs text-center py-6">No trend data yet. Click Ingest Logs to populate.</div>
          )}
        </Card>

        {/* Level Distribution */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <BarChart3 size={14} className="text-accent" />
            Level Distribution
          </h3>
          {pieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <div style={{ width: 112, height: 112 }} className="shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={25}
                      outerRadius={48}
                      paddingAngle={2}
                      dataKey="value"
                      animationBegin={0}
                      animationDuration={600}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "var(--background)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(value: any) => [`${value} entries`, ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {Object.entries(levelCounts).map(([level, count]) => {
                  const total = Object.values(levelCounts).reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={level} className="flex items-center gap-2 text-xs">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: LEVEL_COLORS[level] || "#6b7280" }}
                      />
                      <span className="text-muted w-14">{level}</span>
                      <span className="font-medium tabular-nums flex-1">{count}</span>
                      <span className="text-muted tabular-nums">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-muted text-xs text-center py-6">No data yet</div>
          )}
        </Card>
      </div>

      {/* Patterns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Top Loggers */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Activity size={14} className="text-accent" />
            Top Loggers
          </h3>
          {patterns?.loggers?.length ? (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={patterns.loggers.slice(0, 10)}
                  layout="vertical"
                  margin={{ top: 0, right: 40, bottom: 0, left: 10 }}
                >
                  <XAxis type="number" tick={{ fontSize: 10 }} stroke="#6b7280" width={35} />
                  <YAxis
                    type="category"
                    dataKey="logger"
                    tick={{ fontSize: 10 }}
                    stroke="#6b7280"
                    width={110}
                    tickFormatter={(v) => v.length > 14 ? v.slice(0, 12) + "…" : v}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--background)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(value: any) => [`${value} events`, "Count"]}
                  />
                  <Bar
                    dataKey="count"
                    fill="#3b82f6"
                    radius={[0, 3, 3, 0]}
                    animationDuration={400}
                    barSize={16}
                    label={{ position: "right", fontSize: 10, fill: "#9ca3af" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-muted text-xs text-center py-6">No data yet</div>
          )}
        </Card>

        {/* Top Errors */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <AlertCircle size={14} className="text-accent" />
            Recurring Errors
          </h3>
          {topErrors.length > 0 ? (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {topErrors.map((err, idx) => (
                <div
                  key={`${err.message}-${idx}`}
                  className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/10"
                >
                  <AlertTriangle size={12} className="text-error mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-red-300 break-all line-clamp-2">{err.message}</p>
                    <p className="text-[10px] text-muted mt-0.5 tabular-nums">
                      {err.count}x — last: {err.last_seen || "recent"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted">
              <AlertCircle size={28} className="mb-2 opacity-40" />
              <p className="text-xs">No recurring errors detected</p>
            </div>
          )}
        </Card>
      </div>

      {/* Raw trend table */}
      <Card className="p-4 flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText size={14} className="text-accent" />
            Recent Events
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={eventLevelFilter}
              onChange={(e) => setEventLevelFilter(e.target.value)}
              className="bg-background border border-border rounded-lg px-2 py-1 text-[10px]"
            >
              <option value="ALL">All Levels</option>
              <option value="DEBUG">Debug</option>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="ERROR">Error</option>
              <option value="CRITICAL">Critical</option>
            </select>
            <span className="text-[10px] text-muted bg-white/5 px-2 py-0.5 rounded-full">
              {events.length.toLocaleString()} total
            </span>
          </div>
        </div>
        <div className="overflow-y-auto max-h-96">
          {loading ? (
            <div className="text-muted text-xs text-center py-4">Loading...</div>
          ) : events.length === 0 ? (
            <div className="text-muted text-xs text-center py-4">No events. Click Ingest Logs to populate.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-1.5 pr-2 font-medium">Time</th>
                  <th className="py-1.5 pr-2 font-medium">Level</th>
                  <th className="py-1.5 pr-2 font-medium">Logger</th>
                  <th className="py-1.5 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {events
                  .slice(-200)
                  .map((entry, idx) => (
                    <tr key={idx} className="border-b border-border/50 hover:bg-white/5">
                      <td className="py-1.5 pr-2 text-muted tabular-nums whitespace-nowrap">
                        {entry.ts_iso.slice(5)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            color: LEVEL_COLORS[entry.level] || "#6b7280",
                            background: `${LEVEL_COLORS[entry.level] || "#6b7280"}20`,
                          }}
                        >
                          {entry.level}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-cyan-400 max-w-[140px] truncate" title={entry.logger}>
                        {entry.logger.split(".").pop()}
                      </td>
                      <td className="py-1.5 break-all">{entry.message}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
