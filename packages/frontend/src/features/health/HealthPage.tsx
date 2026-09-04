
import { useState, useCallback, useEffect } from "react";
import { Card, StatusBadge, LoadingSpinner } from "../../components/common";
import {
  XCircle,
  CheckCircle,
  AlertTriangle,
  Monitor,
  Wifi,
  WifiOff,
  Server,
  Cpu,
  HardDrive,
  Database,
} from "lucide-react";
import { useHealth } from "../../hooks";
import {
  getComfyUIStatus,
  startComfyUI,
  stopComfyUI,
  updateComfyUI,
  getApiBase,
  cleanupSystemMemory,
  type ComfyUIStatus,
} from "../../services/api";
import {
  FFmpegStatus,
  ComfyUICard,
  ResourceCard,
  GPUCard,
  ActionLog,
  PerformanceHistoryCard,
  ServiceChecksCard,
  OllamaModelsCard,
  LogsViewer,
} from "./components";

export function HealthPage() {
  const { health, serviceStatus, loading, error } = useHealth();
  const [comfyui, setComfyui] = useState<ComfyUIStatus | null>(null);
  const [comfyuiLoading, setComfyuiLoading] = useState(false);
  const [comfyuiAction, setComfyuiAction] = useState<string | null>(null);
  const [vramStatus, setVramStatus] = useState<Record<string, unknown> | null>(null);
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

  // Fetch VRAM status — returns the data directly so callers don't rely on stale state
  const fetchVRAMStatus = useCallback(async () => {
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/integrations/vram/status`);
      if (res.ok) {
        const data = await res.json();
        setVramStatus(data as Record<string, unknown>);
        return data as Record<string, unknown>;
      }
    } catch {
      // Ignore errors
    }
    return null;
  }, []);

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
          {
            const vramData = await fetchVRAMStatus();
            const _vram = (vramData as unknown as { vram?: { percent: number } })?.vram;
            if (_vram && _vram.percent > 80) {
              addLog(`Warning: VRAM is at ${_vram.percent}%`, "warning");
              const proceed = window.confirm(
                `VRAM is at ${_vram.percent}%. Starting ComfyUI may cause performance issues. Continue?`,
              );
              if (!proceed) {
                addLog("Start cancelled by user", "warning");
                setComfyuiLoading(false);
                setComfyuiAction(null);
                return;
              }
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

  // Show a compact top-level spinner only while the first health slice is loading.
  // Once any data arrives we render the page immediately and let individual cards
  // show their own loading state instead of freezing the whole UI.
  const showTopSpinner = loading && !health && !serviceStatus;
  const hasPartialData = !!health || !!serviceStatus;

  if (showTopSpinner) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">System Health</h1>
        <Card>
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        </Card>
      </div>
    );
  }

  if (error && !hasPartialData) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">System Health</h1>
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
        <h1 className="text-2xl font-bold">System Health</h1>
        <p className="text-muted mt-1">System health and service status</p>
      </div>

      {/* Overall Status Banner */}
      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                overallHealth === "healthy"
                  ? "bg-green-500/20"
                  : overallHealth === "degraded"
                    ? "bg-yellow-500/20"
                    : "bg-red-500/20"
              }`}
            >
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
                {overallHealth === "healthy"
                  ? "All systems operational"
                  : overallHealth === "degraded"
                    ? "Some services experiencing issues"
                    : "Critical issues detected"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-muted" />
            <span className="text-sm text-muted">
              {health?.platform} {health?.platform_version}
            </span>
          </div>
        </div>
      </Card>

      {/* FFmpeg Status */}
      <FFmpegStatus />

      {/* ComfyUI + Resources - 2 column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* ComfyUI Management - sidebar */}
        <ComfyUICard
          status={comfyui}
          loading={comfyuiLoading}
          action={comfyuiAction}
          vramStatus={vramStatus}
          onAction={handleComfyUIAction}
        />

        {/* Resource Usage - main area */}
        <div
          className={`${comfyui?.installed ? "lg:col-span-2" : "lg:col-span-3"}`}
        >
          <div className="grid grid-cols-2 gap-4">
            <ResourceCard icon={Cpu} iconColor="blue" label="CPU" cores={health?.cpu?.count} usage={cpuUsage} />
            <div className="relative">
              <ResourceCard
                icon={HardDrive}
                iconColor="purple"
                label="Memory"
                cores={undefined}
                usage={memUsage}
                subtext={`${health?.memory?.used_gb?.toFixed(1)}GB / ${health?.memory?.total_gb?.toFixed(1)}GB`}
              />
              {memUsage >= 80 && (
                <button
                  onClick={async () => {
                    addLog("Cleaning system memory...", "info");
                    try {
                      const res = await cleanupSystemMemory();
                      addLog(
                        `Cleaned: ${res.actions.join(", ") || "no actions"} — ${res.before_percent}% → ${res.after_percent}% (freed ${res.freed_percent}%)`,
                        "success",
                      );
                    } catch (e: unknown) {
                      const msg = e instanceof Error ? e.message : String(e);
                      addLog(`Cleanup failed: ${msg}`, "error");
                    }
                  }}
                  className="absolute -top-2 -right-2 text-xs px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-full shadow"
                  title="Free RAM: GC + torch cache + old files + Ollama offload if needed"
                >
                  Clean RAM
                </button>
              )}
            </div>
            <ResourceCard icon={Database} iconColor="amber" label="Disk" cores={undefined} usage={diskUsage} subtext={`${health?.disk?.free_gb?.toFixed(1)}GB free`} />
            <GPUCard />
          </div>
          {memUsage >= 80 && (
            <p className="text-xs text-amber-400 mt-2">
              Memory high — queue will auto-clean before new jobs. Click Clean RAM for GC + Ollama offload.
            </p>
          )}
        </div>
      </div>

      {/* Action Log */}
      <ActionLog logs={actionLog} onClear={clearLogs} />

      {/* Performance History & Service Checks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <PerformanceHistoryCard />
        <ServiceChecksCard />
      </div>

      {/* Services Status */}
      <Card title="Services">
        {serviceStatus?.adapters && Object.keys(serviceStatus.adapters).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(serviceStatus.adapters).map(([name, status]) => {
              const adapter = serviceStatus?.adapter_details?.[name];
              const error = adapter?.error;
              const url = adapter?.url;
              const isHealthy =
                status === "connected" || status === "online" || status === "healthy";

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
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          isHealthy
                            ? "bg-green-500/20"
                            : status === "degraded" || status === "warning"
                              ? "bg-yellow-500/20"
                              : "bg-red-500/20"
                        }`}
                      >
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
                        <li>
                          Start ComfyUI:{" "}
                          <code className="bg-background px-1 rounded">cd third_party/ComfyUI && python main.py</code>
                        </li>
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

      {/* Ollama Models */}
      <OllamaModelsCard />

      {/* Logs Viewer */}
      <LogsViewer />
    </div>
  );
}
