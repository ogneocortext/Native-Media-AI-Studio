import { useState } from "react";
import { Activity, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Card } from "../../components/common";
import { checkService } from "../../services/api";

interface ServiceCheck {
  service: string;
  status: "online" | "offline" | "checking";
  lastChecked?: number;
}

const SERVICES = ["backend", "comfyui", "ollama", "blender", "unity"] as const;

export function ServiceChecksCard() {
  const [checks, setChecks] = useState<Record<string, ServiceCheck>>({});

  const handleCheck = async (service: string) => {
    setChecks((prev) => ({ ...prev, [service]: { service, status: "checking" } }));
    try {
      const result = await checkService(service);
      const serviceStatus = (result as { status?: string })?.status;
      const isOnline = serviceStatus === "healthy" || serviceStatus === "online";
      setChecks((prev) => ({ ...prev, [service]: { service, status: isOnline ? "online" : "offline", lastChecked: Date.now() } }));
    } catch {
      setChecks((prev) => ({ ...prev, [service]: { service, status: "offline", lastChecked: Date.now() } }));
    }
  };

  return (
    <Card className="service-checks-card" title="Service Checks" icon={<Activity size={16} className="text-emerald-400" />}>
      <div className="space-y-2">
        {SERVICES.map((service) => {
          const check = checks[service];
          return (
            <div key={service} className="flex items-center justify-between p-2 bg-white/[0.02] rounded-lg">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
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
              </div>
              {check?.status === "checking" ? (
                <Loader2 size={14} className="animate-spin text-amber-400" />
              ) : check?.status === "online" || check?.status === "offline" ? (
                <span className={`flex items-center gap-1 text-xs ${check.status === "online" ? "text-emerald-400" : "text-red-400"}`}>
                  {check.status === "online" ? <CheckCircle size={12} /> : <XCircle size={12} />}
                  {check.status}
                </span>
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
