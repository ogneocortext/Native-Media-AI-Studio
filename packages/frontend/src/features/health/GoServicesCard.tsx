import { useState, useEffect } from "react";
import { Card } from "../../components/common";
import { CheckCircle, XCircle } from "lucide-react";

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

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const results = await Promise.allSettled(
        GO_SERVICES.map(async (svc) => {
          try {
            const res = await fetch(`http://127.0.0.1:${svc.port}${svc.healthPath}`, {
              method: "GET",
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(2000),
            });
            return { name: svc.name, running: res.ok, port: svc.port };
          } catch {
            return { name: svc.name, running: false, port: svc.port };
          }
        }),
      );
      if (!cancelled) {
        setServices(results.map((r) => (r.status === "fulfilled" ? r.value : { name: "?", running: false, port: 0 })));
        setLoading(false);
      }
    };
    check();
    const interval = setInterval(check, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const online = services.filter((s) => s.running).length;
  const total = services.length;

  return (
    <Card title={`Go Sidecars (${online}/${total} online)`}>
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
