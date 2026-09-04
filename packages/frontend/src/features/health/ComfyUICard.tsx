import {
  Play,
  Square,
  RefreshCw,
  Download,
  Loader2,
  Wifi,
  WifiOff,
  CheckCircle,
} from "lucide-react";
import { Card } from "../../components/common";
import { parseVRAMStatus } from "./utils";
import type { ComfyUIStatus } from "../../services/api";

export interface ComfyUICardProps {
  status: ComfyUIStatus | null;
  loading: boolean;
  action: string | null;
  vramStatus: Record<string, unknown> | null;
  onAction: (action: "start" | "stop" | "update") => void;
}

export function ComfyUICard({ status, loading, action, vramStatus, onAction }: ComfyUICardProps) {
  if (!status?.installed) return null;

  return (
    <Card className="lg:col-span-1">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              status.running ? "bg-green-500/20" : "bg-red-500/20"
            }`}
          >
            {status.running ? (
              <Wifi size={20} className="text-green-400" />
            ) : (
              <WifiOff size={20} className="text-red-400" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-sm">ComfyUI</h3>
            <p className="text-xs text-muted">
              {status.running ? `Running on port ${status.port}` : "Not running"}
              {status.version?.version && ` • v${status.version.version}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!status.running ? (
            <button
              onClick={() => onAction("start")}
              disabled={loading}
              className="btn btn-primary btn-sm flex items-center gap-2"
            >
              {loading && action === "start" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Start
            </button>
          ) : (
            <button
              onClick={() => onAction("stop")}
              disabled={loading}
              className="btn btn-secondary btn-sm flex items-center gap-2"
            >
              {loading && action === "stop" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Square size={14} />
              )}
              Stop
            </button>
          )}
          <button
            onClick={() => onAction("update")}
            disabled={loading}
            className="btn btn-ghost btn-sm flex items-center gap-2"
            title="Update ComfyUI via git pull"
          >
            {loading && action === "update" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            Update
          </button>
        </div>
      </div>

      {status.version && (
        <div className="flex items-center justify-between text-xs text-muted pt-3 border-t border-border">
          <div className="flex items-center gap-4">
            {status.version.branch && (
              <span>Branch: {status.version.branch}</span>
            )}
            {status.version.commit && (
              <span className="font-mono">{status.version.commit.split(" ")[0]}</span>
            )}
          </div>
          {status.version.behind_remote !== undefined && status.version.behind_remote > 0 && (
            <span className="text-yellow-400 flex items-center gap-1">
              <RefreshCw size={12} />
              {status.version.behind_remote} update{status.version.behind_remote > 1 ? "s" : ""} available
            </span>
          )}
          {status.version.up_to_date && (
            <span className="text-green-400 flex items-center gap-1">
              <CheckCircle size={12} />
              Up to date
            </span>
          )}
        </div>
      )}

      {/* VRAM + uptime row */}
      {(() => {
        const vram = parseVRAMStatus(vramStatus);
        return (
          <div className="flex items-center justify-between text-xs text-muted mt-2">
            <div>
              {status.running && status.uptime_seconds && (
                <span>
                  Uptime: {Math.floor(status.uptime_seconds / 60)}m {Math.floor(status.uptime_seconds % 60)}s
                  {status.pid && ` • PID: ${status.pid}`}
                </span>
              )}
            </div>
            {vram && (
              <span className="flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    vram.percent > 80
                      ? "bg-red-400"
                      : vram.percent > 60
                        ? "bg-yellow-400"
                        : "bg-green-400"
                  }`}
                />
                VRAM: {vram.percent}% ({Math.round(vram.free_mb / 1024)}GB free)
              </span>
            )}
          </div>
        );
      })()}
    </Card>
  );
}
