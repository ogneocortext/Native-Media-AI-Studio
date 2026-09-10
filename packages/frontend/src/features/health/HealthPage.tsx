
import { useState, useEffect } from "react";
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
  RefreshCw,
  Loader2,
  Clock3,
} from "lucide-react";
import { useHealth } from "../../hooks";
import { useHealthStore } from "../../state/healthStore";
import {
  startComfyUI,
  stopComfyUI,
  updateComfyUI,
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
  GoServicesCard,
} from "./components";

export function HealthPage() {
  const { health, serviceStatus, loading, error } = useHealth();
  const [comfyui, setComfyui] = useState<ComfyUIStatus | null>(null);
  const [comfyuiLoading, setComfyuiLoading] = useState(false);
  const [comfyuiAction, setComfyuiAction] = useState<string | null>(null);
  const [vramStatus, setVramStatus] = useState<Record<string, unknown> | null>(null);
  const [actionLog, setActionLog] = useState<Array<{ time: string; message: string; type: string }>>([]);
  const [pendingHighVram, setPendingHighVram] = useState<number | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const fetchComfyUI = useHealthStore((s) => s.fetchComfyUIStatus);
  const fetchVRAM = useHealthStore((s) => s.fetchVRAMStatus);
  const granular = useHealthStore((s) => s.granular);
  const lastUpdated = useHealthStore((s) => s.lastUpdated);
  const refreshAll = useHealthStore((s) => s.refreshAll);

  // ticking clock for "updated Xs ago"
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      await refreshAll();
      addLog("Refreshed all health data", "success");
    } catch (e) {
      addLog(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setRefreshingAll(false);
      setNowTick(Date.now());
    }
  };

  // Sync ComfyUI status from granular store
  useEffect(() => {
    if (granular.comfyui) setComfyui(granular.comfyui);
  }, [granular.comfyui]);

  // Sync VRAM status from granular store
  useEffect(() => {
    if (granular.vram) setVramStatus(granular.vram);
  }, [granular.vram]);

  // Add a log message
  const addLog = (message: string, type: string = "info") => {
    const time = new Date().toLocaleTimeString();
    setActionLog((prev) => [...prev.slice(-49), { time, message, type }]);
  };

  // Clear logs
  const clearLogs = () => setActionLog([]);

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
            const vramData = await fetchVRAM();
            const _vram = (vramData as unknown as { vram?: { percent: number } })?.vram;
            if (_vram && _vram.percent > 80 && pendingHighVram !== _vram.percent) {
              // Non-blocking two-step confirm: arm the inline banner, let the user decide.
              setPendingHighVram(_vram.percent);
              addLog(`Warning: VRAM is at ${_vram.percent}% — confirm Start below to proceed`, "warning");
              setComfyuiLoading(false);
              setComfyuiAction(null);
              return;
            }
            setPendingHighVram(null);
          }
          addLog("Starting ComfyUI...", "info");
          result = await startComfyUI();
          if (result.success) {
            addLog(`ComfyUI started: ${result.message}`, "success");
          } else {
            addLog(`Failed: ${result.message}`, "error");
            if (result.suggestion) {
              addLog(`Suggestion: ${result.suggestion}`, "warning");
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
      fetchComfyUI();
      fetchVRAM();
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

  // Banner reflects BOTH host resources and adapter services — previously it only
  // read health.status (host), so it said "Healthy" while ComfyUI was offline.
  const offlineAdapters = Object.entries(serviceStatus?.adapters || {})
    .filter(([, s]) => s !== "connected" && s !== "online" && s !== "healthy")
    .map(([name]) => name.replace(/_/g, " "));
  const hostStatus = health?.status || "unknown";
  const overallHealth =
    offlineAdapters.length > 0 ? "degraded" : hostStatus;
  const overallDetail =
    offlineAdapters.length > 0
      ? `${offlineAdapters.join(", ")} ${offlineAdapters.length === 1 ? "is" : "are"} unreachable`
      : hostStatus === "healthy"
        ? "All systems operational"
        : hostStatus === "degraded"
          ? "Some services experiencing issues"
          : hostStatus === "unknown"
            ? "Waiting for health data…"
            : "Critical issues detected";

  // Backend sends platform="Windows" + platform_version="Windows 11 ..." — dedupe the prefix.
  const platformLabel = (() => {
    const p = (health?.platform || "").trim();
    const v = (health?.platform_version || "").trim();
    if (!p) return v || "Unknown platform";
    if (!v) return p;
    return v.toLowerCase().startsWith(p.toLowerCase()) ? v : `${p} ${v}`;
  })();

  const updatedAgoSec =
    lastUpdated != null ? Math.max(0, Math.round((nowTick - lastUpdated.getTime()) / 1000)) : null;

  return (
    <div className="p-6 max-w-[1200px] mx-auto pb-24">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">System Health</h1>
          <p className="text-muted mt-1">System health and service status</p>
          {updatedAgoSec != null && (
            <p className="text-[11px] text-muted/60 mt-1 flex items-center gap-1.5">
              <Clock3 size={11} />
              {updatedAgoSec >= 2 ? `Updated ${updatedAgoSec}s ago` : "Updated just now"}
            </p>
          )}
        </div>
        <button
          onClick={handleRefreshAll}
          disabled={refreshingAll || loading}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {refreshingAll ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh all
        </button>
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
              <p className="text-sm text-muted">{overallDetail}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-muted" />
            <span className="text-sm text-muted">{platformLabel}</span>
          </div>
        </div>
      </Card>

      {/* High-VRAM start confirmation (non-blocking — replaces window.confirm) */}
      {pendingHighVram != null && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2.5 mb-6 flex flex-wrap items-center gap-2" role="alert">
          <AlertTriangle size={14} className="text-amber-400" />
          <span className="text-xs text-amber-200 flex-1 min-w-[220px]">
            VRAM is at {pendingHighVram}%. Starting ComfyUI may cause performance issues — close a heavy app first, or confirm below.
          </span>
          <button
            onClick={() => handleComfyUIAction("start")}
            disabled={comfyuiLoading}
            className="text-[11px] px-2.5 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50"
          >
            Start anyway
          </button>
          <button
            onClick={() => {
              setPendingHighVram(null);
              addLog("Start cancelled by user", "warning");
            }}
            className="text-[11px] px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-muted hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

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
                          Start ComfyUI from this page (Start button above), or run{" "}
                          <code className="bg-background px-1 rounded">scripts\start-services.ps1 -ComfyUI</code>
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

      {/* Go Sidecars */}
      <GoServicesCard />

      {/* Ollama Models */}
      <OllamaModelsCard />

      {/* Logs Viewer */}
      <LogsViewer />
    </div>
  );
}
