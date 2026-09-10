import { useState, useEffect, useCallback } from "react";
import { Card } from "../../components/common";
import { CheckCircle, XCircle, RefreshCw } from "lucide-react";

interface GoService {
  name: string;
  port: number;
  healthPath: string;
}

const GO_SERVICES: GoService[] = [
  { name: "Go Dashboard", port: 3847, healthPath: "/api/health" },
  { name: "Go Media", port: 3848, healthPath: "/api/health" },
  { name: "Go Worker", port: 3849, healthPath: "/health" },
  { name: "Go Gateway", port: 3850, healthPath: "/health" },
  { name: "Go Ports", port: 3851, healthPath: "/api/health" },
];

interface ServiceStatus {
  name: string;
  running: boolean;
  port: number;
}

export function GoServicesCard() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  const check = useCallback(async (signal?: AbortSignal) => {
    const results = await Promise.allSettled(
      GO_SERVICES.map(async (svc) => {
        try {
          const res = await fetch(`http://127.0.0.1:${svc.port}${svc.healthPath}`, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: signal ?? AbortSignal.timeout(2000),
          });
          return { name: svc.name, running: res.ok, port: svc.port };
        } catch {
          return { name: svc.name, running: false, port: svc.port };
        }
      }),
    );
    return results.map((r) => (r.status === "fulfilled" ? r.value : { name: "?", running: false, port: 0 }));
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
              {!svc.running && (
                <p className="text-[11px] text-red-300 mt-1">Offline</p>
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
