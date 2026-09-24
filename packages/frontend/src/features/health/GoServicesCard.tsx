import { useState, useEffect, useCallback } from "react";
import { Card } from "../../components/common";
import { CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { getApiBase } from "../../services/api/core";

interface GoService {
  name: string;
  role: string;
  fallbackPort: number;
}

const GO_SERVICES: GoService[] = [
  { name: "Go Dashboard", fallbackPort: 3847, role: "SSE + service health" },
  { name: "Go Media", fallbackPort: 3848, role: "FFmpeg media processing" },
  { name: "Go Worker", fallbackPort: 3849, role: "Async job + sidecar I/O" },
  { name: "Go Gateway", fallbackPort: 3850, role: "MCP bridge proxy" },
  { name: "Go Ports", fallbackPort: 3851, role: "Port availability checks" },
];

interface ServiceStatus {
  name: string;
  running: boolean;
  port: number;
  url?: string;
  error?: string;
  role?: string;
  latency_ms?: number;
}

export function GoServicesCard() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  const check = useCallback(async (signal?: AbortSignal) => {
    const base = getApiBase();
    try {
      const response = await fetch(`${base}/api/health/diagnostics/services`, {
        headers: { Accept: "application/json" },
        signal: signal ?? AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error(`Service diagnostics returned HTTP ${response.status}`);
      type SidecarResponse = { status?: string; url?: string | null; port?: number; error?: string; role?: string; latency_ms?: number };

      const payload = await response.json() as { sidecars?: Record<string, SidecarResponse> };
      return GO_SERVICES.map((svc) => {
        const key = svc.name.toLowerCase().replaceAll(" ", "-");
        const result = payload.sidecars?.[key];
        return { name: svc.name, running: result?.status === "online", port: result?.port ?? svc.fallbackPort, url: result?.url ?? undefined, error: result?.error, role: result?.role ?? svc.role, latency_ms: result?.latency_ms };
      });
    } catch (error) {
      return GO_SERVICES.map((svc) => ({ name: svc.name, running: false, port: svc.fallbackPort, role: svc.role, error: error instanceof Error ? error.message : "Health check failed" }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const run = async () => {
      const list = await check(controller.signal);
      if (!cancelled) {
        setServices(list);
        setLoading(false);
        setLastChecked(Date.now());
      }
    };
    run();
    const interval = setInterval(run, 15000);
    return () => { cancelled = true; controller.abort(); clearInterval(interval); };
  }, [check]);

  const online = services.filter((s) => s.running).length;
  const total = services.length;
  const ago = lastChecked ? Math.max(0, Math.round((Date.now() - lastChecked) / 1000)) : null;

  const handleRefresh = async () => {
    setLoading(true);
    setServices(await check());
    setLoading(false);
    setLastChecked(Date.now());
  };

  return (
    <Card
      title={`Go Sidecars (${online}/${total} online)`}
      headerActions={
        <div className="flex items-center gap-2">
          {ago != null && ago >= 2 && (
            <span className="text-[11px] text-muted/60 tabular-nums">{ago}s ago</span>
          )}
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg bg-white/5 text-muted hover:text-white"
            title="Re-check Go services now"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="text-xs text-muted">Checking Go services...</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {services.map((svc) => (
            <div
              key={svc.name}
              className={`p-3 rounded-lg border ${
                svc.running
                  ? "border-green-500/20 bg-green-500/5"
                  : "border-red-500/20 bg-red-500/5"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {svc.running ? (
                  <CheckCircle size={14} className="text-green-400" />
                ) : (
                  <XCircle size={14} className="text-red-400" />
                )}
                <span className="text-xs font-medium text-white truncate">{svc.name}</span>
              </div>
              <p className="text-[11px] text-muted font-mono">:{svc.port}</p>
              <p className="text-[10px] text-muted/70 mt-1">{svc.role}</p>
              {svc.running && svc.latency_ms != null && (
                <p className="text-[10px] text-emerald-300/80 mt-1">{svc.latency_ms} ms response</p>
              )}
              {!svc.running && (
                <p className="text-[11px] text-red-300 mt-1" title={svc.error}>
                  {svc.error ? "Unavailable" : "Offline"}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted mt-3">
        Go sidecars provide high-concurrency infrastructure (SSE, media workers, MCP gateway, port checks).
      </p>
    </Card>
  );
}
