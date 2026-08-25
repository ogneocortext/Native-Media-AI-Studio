import React, { useState, useEffect, useMemo } from "react";
import {
  Activity,
  Server,
  Cpu,
  HardDrive,
  Database,
  Wifi,
  WifiOff,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Monitor,
  Play,
  Square,
  RefreshCw,
  Download,
  Loader2,
  FileText,
  ChevronDown,
  ChevronUp,
  Trash2,
  Thermometer,
  Box,
  Zap,
  Terminal,
} from "lucide-react";
import { Card, StatusBadge, LoadingSpinner } from "../../components/common";
import { useHealth } from "../../hooks";
import {
  getComfyUIStatus,
  startComfyUI,
  stopComfyUI,
  updateComfyUI,
  getGPUSnapshot,
  get3DStatus,
  type ComfyUIStatus as ComfyUIStatusType,
  type GPUSnapshot,
} from "../../services/api";

function getUsageColor(percent: number): string {
  if (percent < 50) return "#22c55e";
  if (percent < 75) return "#f59e0b";
  return "#ef4444";
}

function getUsageLabel(percent: number): string {
  if (percent < 50) return "Good";
  if (percent < 75) return "Moderate";
  return "High";
}

export function HealthPage() {
  const { health, serviceStatus, loading, error } = useHealth();
  const [comfyui, setComfyui] = useState<ComfyUIStatusType | null>(null);
  const [comfyuiLoading, setComfyuiLoading] = useState(false);
  const [comfyuiAction, setComfyuiAction] = useState<string | null>(null);
  const [vramStatus, setVramStatus] = useState<any>(null);
  const [actionLog, setActionLog] = useState<Array<{ time: string; message: string; type: string }>>([]);

  // Add a log message
  const addLog = (message: string, type: string = "info") => {
    const time = new Date().toLocaleTimeString();
    setActionLog((prev) => [...prev.slice(-49), { time, message, type }]);
  };

  // Clear logs
  const clearLogs = () => setActionLog([]);

  // Fetch ComfyUI status
  const fetchComfyUIStatus = async () => {
    try {
      const status = await getComfyUIStatus();
      setComfyui(status);
    } catch {
      // Ignore errors
    }
  };

  // Fetch VRAM status
  const fetchVRAMStatus = async () => {
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/integrations/vram/status`);
      if (res.ok) {
        const data = await res.json();
        setVramStatus(data);
      }
    } catch {
      // Ignore errors
    }
  };

  useEffect(() => {
    fetchComfyUIStatus();
    fetchVRAMStatus();
    const interval = setInterval(() => {
      fetchComfyUIStatus();
      fetchVRAMStatus();
    }, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const handleComfyUIAction = async (action: "start" | "stop" | "update") => {
    setComfyuiLoading(true);
    setComfyuiAction(action);
    addLog(`Starting ${action}...`, "info");
    try {
      let result;
      switch (action) {
        case "start":
          addLog("Checking VRAM availability...", "info");
          await fetchVRAMStatus();
          if (vramStatus?.vram?.percent > 80) {
            addLog(`Warning: VRAM is at ${vramStatus.vram.percent}%`, "warning");
            const proceed = window.confirm(
              `VRAM is at ${vramStatus.vram.percent}%. Starting ComfyUI may cause performance issues. Continue?`
            );
            if (!proceed) {
              addLog("Start cancelled by user", "warning");
              setComfyuiLoading(false);
              setComfyuiAction(null);
              return;
            }
          }
          addLog("Starting ComfyUI...", "info");
          result = await startComfyUI();
          if (result.success) {
            addLog(`ComfyUI started: ${result.message}`, "success");
          } else {
            addLog(`Failed: ${result.message}`, "error");
            if (result.suggestion) {
              addLog(`Suggestion: ${result.suggestion}`, "warning");
              alert(`${result.message}\n\n${result.suggestion}`);
            }
          }
          break;
        case "stop":
          addLog("Stopping ComfyUI...", "info");
          result = await stopComfyUI();
          if (result.success) {
            addLog(`ComfyUI stopped: ${result.message}`, "success");
          } else {
            addLog(`Failed: ${result.message}`, "error");
          }
          break;
        case "update":
          addLog("Starting ComfyUI update...", "info");
          addLog("Running git pull...", "info");
          result = await updateComfyUI();
          if (result.success) {
            addLog(`Update successful: ${result.message}`, "success");
            if (result.output) {
              addLog(`Git output: ${result.output}`, "info");
            }
            if (result.was_running) {
              addLog("Restarting ComfyUI...", "info");
              if (result.restarted?.success) {
                addLog("ComfyUI restarted successfully", "success");
              } else {
                addLog(`Restart failed: ${result.restarted?.message}`, "error");
              }
            }
          } else {
            addLog(`Update failed: ${result.message}`, "error");
            if (result.errors) {
              addLog(`Errors: ${result.errors}`, "error");
            }
            if (result.hint) {
              addLog(`Hint: ${result.hint}`, "warning");
            }
          }
          break;
      }
      // Refresh status after action
      await fetchComfyUIStatus();
      await fetchVRAMStatus();
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      console.error(`ComfyUI ${action} failed:`, err);
    } finally {
      setComfyuiLoading(false);
      setComfyuiAction(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Diagnostics</h1>
        <Card>
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Diagnostics</h1>
        <Card>
          <div className="flex items-center gap-3 p-4 bg-error/10 border border-error/20 rounded-lg">
            <XCircle size={20} className="text-error" />
            <span className="text-error font-medium">{error}</span>
          </div>
        </Card>
      </div>
    );
  }

  const cpuUsage = health?.cpu?.usage_percent || 0;
  const memUsage = health?.memory?.percent || 0;
  const diskUsage = health?.disk?.percent || 0;
  const overallHealth = health?.status || "unknown";

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Diagnostics</h1>
        <p className="text-muted mt-1">System health and service status</p>
      </div>

      {/* Overall Status Banner */}
      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              overallHealth === "healthy" ? "bg-green-500/20" :
              overallHealth === "degraded" ? "bg-yellow-500/20" : "bg-red-500/20"
            }`}>
              {overallHealth === "healthy" ? (
                <CheckCircle size={24} className="text-green-400" />
              ) : overallHealth === "degraded" ? (
                <AlertTriangle size={24} className="text-yellow-400" />
              ) : (
                <XCircle size={24} className="text-red-400" />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-lg capitalize">{overallHealth}</h3>
              <p className="text-sm text-muted">
                {overallHealth === "healthy" ? "All systems operational" :
                 overallHealth === "degraded" ? "Some services experiencing issues" :
                 "Critical issues detected"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-muted" />
            <span className="text-sm text-muted">{health?.platform} {health?.platform_version}</span>
          </div>
        </div>
      </Card>

      {/* ComfyUI Management */}
      {comfyui && comfyui.installed && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                comfyui.running ? "bg-green-500/20" : "bg-red-500/20"
              }`}>
                {comfyui.running ? (
                  <Wifi size={20} className="text-green-400" />
                ) : (
                  <WifiOff size={20} className="text-red-400" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-sm">ComfyUI</h3>
                <p className="text-xs text-muted">
                  {comfyui.running ? `Running on port ${comfyui.port}` : "Not running"}
                  {comfyui.version?.version && ` • v${comfyui.version.version}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!comfyui.running ? (
                <button
                  onClick={() => handleComfyUIAction("start")}
                  disabled={comfyuiLoading}
                  className="btn btn-primary btn-sm flex items-center gap-2"
                >
                  {comfyuiLoading && comfyuiAction === "start" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  Start
                </button>
              ) : (
                <button
                  onClick={() => handleComfyUIAction("stop")}
                  disabled={comfyuiLoading}
                  className="btn btn-secondary btn-sm flex items-center gap-2"
                >
                  {comfyuiLoading && comfyuiAction === "stop" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Square size={14} />
                  )}
                  Stop
                </button>
              )}
              <button
                onClick={() => handleComfyUIAction("update")}
                disabled={comfyuiLoading}
                className="btn btn-ghost btn-sm flex items-center gap-2"
                title="Update ComfyUI via git pull"
              >
                {comfyuiLoading && comfyuiAction === "update" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                Update
              </button>
            </div>
          </div>

          {/* Version & Update Info */}
          {comfyui.version && (
            <div className="flex items-center justify-between text-xs text-muted pt-3 border-t border-border">
              <div className="flex items-center gap-4">
                {comfyui.version.branch && (
                  <span>Branch: {comfyui.version.branch}</span>
                )}
                {comfyui.version.commit && (
                  <span className="font-mono">{comfyui.version.commit.split(" ")[0]}</span>
                )}
              </div>
              {comfyui.version.behind_remote !== undefined && comfyui.version.behind_remote > 0 && (
                <span className="text-yellow-400 flex items-center gap-1">
                  <RefreshCw size={12} />
                  {comfyui.version.behind_remote} update{comfyui.version.behind_remote > 1 ? "s" : ""} available
                </span>
              )}
              {comfyui.version.up_to_date && (
                <span className="text-green-400 flex items-center gap-1">
                  <CheckCircle size={12} />
                  Up to date
                </span>
              )}
            </div>
          )}

          {/* Uptime & VRAM */}
          <div className="flex items-center justify-between text-xs text-muted mt-2">
            <div>
              {comfyui.running && comfyui.uptime_seconds && (
                <span>
                  Uptime: {Math.floor(comfyui.uptime_seconds / 60)}m {Math.floor(comfyui.uptime_seconds % 60)}s
                  {comfyui.pid && ` • PID: ${comfyui.pid}`}
                </span>
              )}
            </div>
            {vramStatus?.vram?.available && (
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${
                  vramStatus.vram.percent > 80 ? 'bg-red-400' :
                  vramStatus.vram.percent > 60 ? 'bg-yellow-400' : 'bg-green-400'
                }`} />
                VRAM: {vramStatus.vram.percent}% ({Math.round(vramStatus.vram.free_mb / 1024)}GB free)
              </span>
            )}
          </div>
        </Card>
      )}

      {/* Action Log Panel */}
      {actionLog.length > 0 && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-indigo-400" />
              <h3 className="font-semibold text-sm">Action Log</h3>
              <span className="text-xs text-muted">({actionLog.length} entries)</span>
            </div>
            <button
              onClick={clearLogs}
              className="text-xs text-muted hover:text-white transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs">
            {actionLog.map((log, i) => (
              <div key={i} className={`flex gap-2 ${
                log.type === 'error' ? 'text-red-400' :
                log.type === 'warning' ? 'text-yellow-400' :
                log.type === 'success' ? 'text-green-400' :
                'text-gray-400'
              }`}>
                <span className="text-gray-600 shrink-0">[{log.time}]</span>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Resource Usage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* CPU */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Cpu size={20} className="text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">CPU</h3>
                <p className="text-xs text-muted">{health?.cpu?.count} cores</p>
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded-full font-medium" style={{
              background: `${getUsageColor(cpuUsage)}20`,
              color: getUsageColor(cpuUsage),
            }}>
              {getUsageLabel(cpuUsage)}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Usage</span>
              <span className="font-bold">{cpuUsage.toFixed(1)}%</span>
            </div>
            <div className="h-2.5 bg-background rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${cpuUsage}%`, background: getUsageColor(cpuUsage) }}
              />
            </div>
          </div>
        </Card>

        {/* Memory */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <HardDrive size={20} className="text-purple-400" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Memory</h3>
                <p className="text-xs text-muted">{health?.memory?.used_gb?.toFixed(1)}GB / {health?.memory?.total_gb?.toFixed(1)}GB</p>
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded-full font-medium" style={{
              background: `${getUsageColor(memUsage)}20`,
              color: getUsageColor(memUsage),
            }}>
              {getUsageLabel(memUsage)}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Usage</span>
              <span className="font-bold">{memUsage.toFixed(1)}%</span>
            </div>
            <div className="h-2.5 bg-background rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${memUsage}%`, background: getUsageColor(memUsage) }}
              />
            </div>
          </div>
        </Card>

        {/* Disk */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Database size={20} className="text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Disk</h3>
                <p className="text-xs text-muted">{health?.disk?.free_gb?.toFixed(1)}GB free</p>
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded-full font-medium" style={{
              background: `${getUsageColor(diskUsage)}20`,
              color: getUsageColor(diskUsage),
            }}>
              {getUsageLabel(diskUsage)}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Usage</span>
              <span className="font-bold">{diskUsage.toFixed(1)}%</span>
            </div>
            <div className="h-2.5 bg-background rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${diskUsage}%`, background: getUsageColor(diskUsage) }}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Services Status */}
      <Card title="Services">
        {serviceStatus?.adapters && Object.keys(serviceStatus.adapters).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(serviceStatus.adapters).map(([name, status]) => {
              const adapter = serviceStatus?.adapter_details?.[name];
              const error = adapter?.error;
              const url = adapter?.url;
              const isHealthy = status === "connected" || status === "online" || status === "healthy";

              return (
                <div
                  key={name}
                  className={`p-4 rounded-lg border ${
                    isHealthy
                      ? "border-green-500/20 bg-green-500/5"
                      : status === "degraded" || status === "warning"
                        ? "border-yellow-500/20 bg-yellow-500/5"
                        : "border-red-500/20 bg-red-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isHealthy ? "bg-green-500/20" : status === "degraded" || status === "warning" ? "bg-yellow-500/20" : "bg-red-500/20"
                      }`}>
                        {isHealthy ? (
                          <Wifi size={16} className="text-green-400" />
                        ) : status === "degraded" || status === "warning" ? (
                          <AlertTriangle size={16} className="text-yellow-400" />
                        ) : (
                          <WifiOff size={16} className="text-red-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm capitalize">{name.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted capitalize">{status}</p>
                      </div>
                    </div>
                    <StatusBadge status={status} />
                  </div>

                  {/* Service URL */}
                  {url && (
                    <p className="text-xs text-muted mb-2 font-mono">{url}</p>
                  )}

                  {/* Error Message */}
                  {error && (
                    <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-300">
                      {error}
                    </div>
                  )}

                  {/* Helpful Actions */}
                  {!isHealthy && name === "comfyui" && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-muted">To fix:</p>
                      <ol className="text-xs text-muted list-decimal list-inside space-y-1">
                        <li>Start ComfyUI: <code className="bg-background px-1 rounded">cd third_party/ComfyUI && python main.py</code></li>
                        <li>Or update URL in Settings if using a different port</li>
                      </ol>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <Server size={32} className="mx-auto text-muted/50 mb-3" />
            <p className="text-muted">No services configured</p>
            <p className="text-xs text-muted mt-1">Configure integrations in Settings</p>
          </div>
        )}
      </Card>

      {/* Logs Viewer */}
      <LogsViewer />
    </div>
  );
}

// ============================================================================
// Logs Viewer Component (embedded in Health page)
// ============================================================================

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

function parseLogLine(line: string): ParsedLogLine | null {
  // Format: 2026-08-22 08:47:43 | INFO    | app.queue.manager | reload_from_db | Loaded 13 jobs
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*\|\s*(\w+)\s*\|\s*([\w.]+)\s*\|\s*([\w.]+)\s*\|\s*(.+)$/
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

function LogsViewer() {
  const [expanded, setExpanded] = useState(false);
  const [activeLog, setActiveLog] = useState<string>("app");
  const [logContent, setLogContent] = useState<string[]>([]);
  const [logInfo, setLogInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);

  const fetchLogInfo = async () => {
    try {
      const { getLogInfo } = await import("../../services/api");
      const info = await getLogInfo();
      setLogInfo(info);
    } catch {
      // Ignore
    }
  };

  const fetchLogContent = async (logName: string = activeLog) => {
    setLoading(true);
    try {
      const { getLogContent } = await import("../../services/api");
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
      const { startComfyUI } = await import("../../services/api");
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
    (l) => l.includes("ERROR") || l.includes("error")
  ).length;
  const warnCount = logContent.filter((l) => l.includes("WARNING")).length;

  const logNames = [
    { id: "app", label: "All Logs", icon: FileText, desc: "Everything" },
    { id: "error", label: "Errors", icon: XCircle, desc: "Errors only" },
    { id: "queue", label: "Queue", icon: Activity, desc: "Job processing" },
    { id: "comfyui", label: "ComfyUI", icon: Server, desc: "Image generation" },
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
            {logNames.map(({ id, label, icon: Icon, desc }) => {
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
