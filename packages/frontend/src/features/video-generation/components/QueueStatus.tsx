import { FC } from "react";
import { RefreshCw, Clock } from "lucide-react";

export interface QueueInfo {
  running: number;
  pending: number;
}

interface QueueStatusProps {
  info: QueueInfo | null;
  compact?: boolean;
}

export const QueueStatus: FC<QueueStatusProps> = ({ info, compact }) => {
  if (!info) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-primary">●</span>
        <span className={info.running === 0 ? "text-green-400" : "text-yellow-400"}>
          {info.running} running · {info.pending} pending
        </span>
      </div>
    );
  }

  return (
    <div className="bg-black/40 border border-white/10 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-white">Queue</span>
        <span className="text-xs text-muted">
          <RefreshCw size={12} className="inline mr-1 animate-spin" />
          Auto-refresh
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-500 rounded-full" />
          <span className="text-xs text-muted">{info.running} running</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-yellow-500 rounded-full" />
          <span className="text-xs text-muted">{info.pending} pending</span>
        </div>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted">
        <span>{info.running + info.pending} total jobs</span>
        <span className="flex items-center gap-1">
          <Clock size={12} /> Last updated: just now
        </span>
      </div>
    </div>
  );
};
