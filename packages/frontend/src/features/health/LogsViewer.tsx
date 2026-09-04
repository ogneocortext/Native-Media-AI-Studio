import React, { useState, useEffect, useMemo } from "react";
import {
  FileText,
  XCircle,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Server,
  Play,
  RefreshCw,
  Activity,
} from "lucide-react";
import { Card } from "../../components/common";
import {
  startComfyUI,
  getLogInfo,
  getLogContent,
  type LogInfo,
} from "../../services/api";

interface ParsedLogLine {
  timestamp: string;
  relativeTime: string;
  level: string;
  levelColor: string;
  levelIcon: React.ComponentType<{ size?: number; className?: string }>;
  module: string;
  function: string;
  message: string;
  isError: boolean;
  isWarning: boolean;
}

function parseLogLine(line: string): ParsedLogLine {
  // Format: 2026-08-22 08:47:43 | INFO    | app.queue.manager | reload_from_db | Loaded 13 jobs
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*\|\s*(\w+)\s*\|\s*([\w.]+)\s*\|\s*([\w.]+)\s*\|\s*(.+)$/,
  );
  if (!match) {
    return {
      timestamp: "",
      relativeTime: "",
      level: "INFO",
      levelColor: "text-gray-400",
      levelIcon: FileText,
      module: "",
      function: "",
      message: line,
      isError: false,
      isWarning: false,
    };
  }

  const [, timestamp, level, module, fn, message] = match;

  // Calculate relative time
  let relativeTime = "";
  try {
    const logDate = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - logDate.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) relativeTime = `${diffSec}s ago`;
    else if (diffSec < 3600) relativeTime = `${Math.floor(diffSec / 60)}m ago`;
    else if (diffSec < 86400) relativeTime = `${Math.floor(diffSec / 3600)}h ago`;
    else relativeTime = `${Math.floor(diffSec / 86400)}d ago`;
  } catch {
    // Ignore parse errors
  }

  const isError = level === "ERROR";
  const isWarning = level === "WARNING";

  let levelColor = "text-gray-400";
  let levelIcon: React.ComponentType<{ size?: number; className?: string }> = FileText;

  if (isError) {
    levelColor = "text-red-400";
    levelIcon = XCircle;
  } else if (isWarning) {
    levelColor = "text-yellow-400";
    levelIcon = AlertTriangle;
  } else if (level === "INFO") {
    levelColor = "text-sky-400";
    levelIcon = CheckCircle;
  } else if (level === "DEBUG") {
    levelColor = "text-gray-500";
    levelIcon = FileText;
  }

  // Simplify module name (remove "app." prefix)
  const shortModule = module.replace(/^app\./, "");

  return {
    timestamp,
    relativeTime,
    level,
    levelColor,
    levelIcon,
    module: shortModule,
    function: fn,
    message,
    isError,
    isWarning,
  };
}

export function LogsViewer() {
  const [expanded, setExpanded] = useState(false);
  const [activeLog, setActiveLog] = useState<string>("app");
  const [logContent, setLogContent] = useState<string[]>([]);
  const [logInfo, setLogInfo] = useState<LogInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);

  const fetchLogInfo = async () => {
    try {
      const info = await getLogInfo();
      setLogInfo(info);
    } catch {
      // Ignore
    }
  };

  const fetchLogContent = async (logName: string = activeLog) => {
    setLoading(true);
    try {
      const content = await getLogContent(logName, 500);
      setLogContent(content.content);
    } catch {
      setLogContent(["Failed to load log"]);
    } finally {
      setLoading(false);
    }
  };

  const handleStartComfyUI = async () => {
    try {
      await startComfyUI();
      // Switch to comfyui log tab and refresh
      setActiveLog("comfyui");
      fetchLogContent("comfyui");
    } catch (err) {
      console.error("Failed to start ComfyUI:", err);
    }
  };

  useEffect(() => {
    if (expanded) {
      fetchLogInfo();
      fetchLogContent();
    }
  }, [expanded, activeLog]);

  // Auto-refresh logs when expanded
  useEffect(() => {
    if (!expanded || !autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogContent();
      fetchLogInfo();
    }, 3000);
    return () => clearInterval(interval);
  }, [expanded, autoRefresh, activeLog]);

  // Parse and filter log lines
  const parsedLines = useMemo(() => {
    return logContent
      .map((line) => parseLogLine(line))
      .filter((parsed): parsed is ParsedLogLine => parsed !== null)
      .filter((parsed) => {
        if (showOnlyErrors && !parsed.isError && !parsed.isWarning) return false;
        if (searchFilter) {
          const q = searchFilter.toLowerCase();
          return (
            parsed.message.toLowerCase().includes(q) ||
            parsed.module.toLowerCase().includes(q) ||
            parsed.level.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [logContent, showOnlyErrors, searchFilter]);

  const errorCount = logContent.filter(
    (l) => l.includes("ERROR") || l.includes("error"),
  ).length;
  const warnCount = logContent.filter((l) => l.includes("WARNING")).length;

  const logTabs = [
    { id: "app", label: "All Logs", icon: FileText },
    { id: "error", label: "Errors", icon: XCircle },
    { id: "queue", label: "Queue", icon: Activity },
    { id: "comfyui", label: "ComfyUI", icon: Server },
  ];

  return (
    <Card className="mt-6">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
            <FileText size={18} className="text-indigo-400" />
          </div>
          <div>
            <h3 className="font-semibold">Application Logs</h3>
            <p className="text-xs text-muted">
              {logInfo
                ? `${parsedLines.length} entries • ${logInfo.files?.app?.size_human || "0 B"}`
                : "View application logs"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Quick stats badges */}
          {errorCount > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400 font-medium">
              {errorCount} error{errorCount > 1 ? "s" : ""}
            </span>
          )}
          {warnCount > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 font-medium">
              {warnCount} warn
            </span>
          )}
          <div className="text-muted">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Log file tabs */}
          <div className="flex gap-2 flex-wrap">
            {logTabs.map(({ id, label, icon: Icon }) => {
              const isActive = activeLog === id;
              const fileSize = logInfo?.files[id]?.size_human;
              const hasContent = fileSize && fileSize !== "0.0 B";
              return (
                <button
                  key={id}
                  onClick={() => setActiveLog(id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "bg-background text-muted hover:text-foreground border border-transparent"
                  }`}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                  {hasContent && (
                    <span className="text-[10px] opacity-60">({fileSize})</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search and filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search logs..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={() => setShowOnlyErrors(!showOnlyErrors)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                showOnlyErrors
                  ? "bg-red-500/20 text-red-400 border border-red-500/30"
                  : "bg-background text-muted border border-border hover:text-foreground"
              }`}
            >
              <XCircle size={14} />
              Errors Only
            </button>
            <button
              onClick={() => fetchLogContent()}
              disabled={loading}
              className="btn btn-ghost btn-sm flex items-center gap-1.5"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Live
            </label>
          </div>

          {/* Log entries */}
          <div className="bg-black/50 rounded-xl border border-white/5 overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto">
              {parsedLines.length > 0 ? (
                <div className="divide-y divide-white/5">
                  {parsedLines.map((line, i) => {
                    const LevelIcon = line.levelIcon;
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors ${
                          line.isError
                            ? "bg-red-500/5"
                            : line.isWarning
                              ? "bg-yellow-500/5"
                              : ""
                        }`}
                      >
                        {/* Level icon */}
                        <div className={`mt-0.5 ${line.levelColor}`}>
                          <LevelIcon size={14} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Level badge */}
                            <span
                              className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                line.isError
                                  ? "bg-red-500/20 text-red-400"
                                  : line.isWarning
                                    ? "bg-yellow-500/20 text-yellow-400"
                                    : "bg-sky-500/20 text-sky-400"
                              }`}
                            >
                              {line.level}
                            </span>
                            {/* Module */}
                            {line.module && (
                              <span className="text-xs text-muted font-mono">
                                {line.module}
                                {line.function && `.${line.function}`}
                              </span>
                            )}
                          </div>
                          {/* Message */}
                          <p className="text-sm text-gray-300 mt-1 break-words">
                            {line.message}
                          </p>
                        </div>

                        {/* Timestamp */}
                        <div className="text-right shrink-0">
                          {line.relativeTime && (
                            <span className="text-[10px] text-muted whitespace-nowrap">
                              {line.relativeTime}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  {loading ? (
                    <div className="flex items-center justify-center gap-2 text-muted">
                      <Loader2 size={16} className="animate-spin" />
                      Loading logs...
                    </div>
                  ) : (
                    <div className="text-muted">
                      {activeLog === "comfyui" ? (
                        <>
                          <Server size={28} className="mx-auto mb-3 opacity-50" />
                          <p className="font-medium">No ComfyUI logs yet</p>
                          <p className="text-xs mt-1 mb-4 max-w-xs mx-auto">
                            Start ComfyUI to see logs here. Logs capture generation progress, errors, and connection status.
                          </p>
                          <button
                            onClick={handleStartComfyUI}
                            className="btn btn-primary btn-sm inline-flex items-center gap-2"
                          >
                            <Play size={14} />
                            Start ComfyUI
                          </button>
                        </>
                      ) : activeLog === "error" ? (
                        <>
                          <CheckCircle size={28} className="mx-auto mb-3 text-green-400 opacity-50" />
                          <p className="font-medium text-green-400">No errors!</p>
                          <p className="text-xs mt-1">
                            Your application is running smoothly.
                          </p>
                        </>
                      ) : (
                        <>
                          <FileText size={28} className="mx-auto mb-3 opacity-50" />
                          <p className="font-medium">No log entries</p>
                          {searchFilter && (
                            <p className="text-xs mt-1">
                              No results for &quot;{searchFilter}&quot;. Try adjusting your search.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer stats */}
            {parsedLines.length > 0 && (
              <div className="px-4 py-2 bg-white/5 border-t border-white/5 flex items-center justify-between text-xs text-muted">
                <span>
                  Showing {parsedLines.length} of {logContent.length} entries
                </span>
                <div className="flex items-center gap-3">
                  {errorCount > 0 && (
                    <span className="text-red-400">{errorCount} errors</span>
                  )}
                  {warnCount > 0 && (
                    <span className="text-yellow-400">{warnCount} warnings</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
