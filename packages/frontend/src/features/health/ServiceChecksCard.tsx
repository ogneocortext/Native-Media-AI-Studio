import { useState, useEffect, useCallback } from "react";
import { Activity, Loader2, CheckCircle, XCircle, Play, Pause, RefreshCw } from "lucide-react";
import { Card } from "../../components/common";
import { checkService } from "../../services/api";
import { useHealthStore } from "../../state/healthStore";

interface ServiceCheck {
  service: string;
  status: "online" | "offline" | "checking";
  lastChecked?: number;
}

// Only these two have a backend probe endpoint (POST /api/health/services/:id/check).
// "backend" is known live from the store (this page couldn't load without it), and
// Blender/Unity are editor MCP bridges with no HTTP check — probing them always
// returned "Unknown service" and rendered a permanent false "offline".
const PROBED_SERVICES = ["comfyui", "ollama"] as const;
const CHECK_INTERVAL_MS = 30000;

export function ServiceChecksCard() {
  const [checks, setChecks] = useState<Record<string, ServiceCheck>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const backend = useHealthStore((s) => s.backend);

  const handleCheck = useCallback(async (service: string) => {
    setChecks((prev) => ({ ...prev, [service]: { service, status: "checking" } }));
    try {
      const result = await checkService(service);
      const serviceStatus = (result as { status?: string })?.status;
      const isOnline = serviceStatus === "healthy" || serviceStatus === "online";
      setChecks((prev) => ({ ...prev, [service]: { service, status: isOnline ? "online" : "offline", lastChecked: Date.now() } }));
    } catch {
      setChecks((prev) => ({ ...prev, [service]: { service, status: "offline", lastChecked: Date.now() } }));
    }
  }, []);

  const checkAll = useCallback(async () => {
    await Promise.all(PROBED_SERVICES.map((service) => handleCheck(service)));
  }, [handleCheck]);

  useEffect(() => {
    checkAll();
    if (!autoRefresh) return;
    const interval = setInterval(checkAll, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkAll, autoRefresh]);

  return (
    <Card className="service-checks-card" title="Service Checks" icon={<Activity size={16} className="text-emerald-400" />} headerActions={
      <div className="flex items-center gap-2">
        <button
          onClick={checkAll}
          className="p-1.5 rounded-lg bg-white/5 text-muted hover:text-white"
          title="Check all services now"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`p-1.5 rounded-lg ${autoRefresh ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-700 text-gray-400"}`}
          title={autoRefresh ? "Auto-refresh ON (every 30s)" : "Auto-refresh OFF"}
        >
          {autoRefresh ? <Play size={12} /> : <Pause size={12} />}
        </button>
      </div>
    }>
      <div className="space-y-2">
        {/* Backend needs no probe — this page rendered, so it is reachable. */}
        <div className="flex items-center justify-between gap-2 p-2 bg-white/[0.02] rounded-lg">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 rounded-full shrink-0 ${backend === "online" ? "bg-emerald-400" : "bg-red-400"}`} />
            <span className="text-sm text-white capitalize">backend</span>
            <span className="text-[10px] text-muted/60">live</span>
          </div>
          <span className={`flex items-center gap-1 text-xs ${backend === "online" ? "text-emerald-400" : "text-red-400"}`}>
            {backend === "online" ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {backend}
          </span>
        </div>
        {PROBED_SERVICES.map((service) => {
          const check = checks[service];
          const ago = check?.lastChecked ? Math.max(0, Math.round((Date.now() - check.lastChecked) / 1000)) : null;
          return (
            <div key={service} className="flex items-center justify-between gap-2 p-2 bg-white/[0.02] rounded-lg">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    check?.status === "online"
                      ? "bg-emerald-400"
                      : check?.status === "offline"
                        ? "bg-red-400"
                        : check?.status === "checking"
                          ? "bg-amber-400 animate-pulse"
                          : "bg-gray-600"
                  }`}
                />
                <span className="text-sm text-white capitalize">{service}</span>
                {ago != null && ago >= 2 && (
                  <span className="text-[10px] text-muted/60 tabular-nums">{ago}s ago</span>
                )}
              </div>
              {check?.status === "checking" ? (
                <Loader2 size={14} className="animate-spin text-amber-400" />
              ) : check?.status === "online" || check?.status === "offline" ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`flex items-center gap-1 text-xs ${check.status === "online" ? "text-emerald-400" : "text-red-400"}`}>
                    {check.status === "online" ? <CheckCircle size={12} /> : <XCircle size={12} />}
                    {check.status}
                  </span>
                  <button
                    onClick={() => handleCheck(service)}
                    className="p-1 rounded text-muted hover:text-white hover:bg-white/10"
                    title={`Re-check ${service}`}
                  >
                    <RefreshCw size={11} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleCheck(service)}
                  className="text-xs px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 hover:bg-violet-500/30"
                >
                  Check
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
