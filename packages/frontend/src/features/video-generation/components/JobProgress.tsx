import { Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";

export interface JobProgress {
  job_id: string;
  status: string;
  progress: number;
  current_step: number;
  total_steps: number;
  current_frame: number;
  total_frames: number;
  elapsed_seconds: number;
  estimated_seconds: number;
  remaining_seconds: number;
  estimated_end_time: string;
  error: string | null;
}

export const JobProgress = ({ progress, compact }: { progress: JobProgress | null; compact?: boolean }) => {
  if (!progress) return null;

  const StatusIcon =
    progress.status === "completed"
      ? CheckCircle
      : progress.status === "failed"
      ? XCircle
      : progress.status === "cancelled"
      ? AlertCircle
      : Loader2;

  const statusColor =
    progress.status === "completed"
      ? "text-green-400"
      : progress.status === "failed"
      ? "text-red-400"
      : progress.status === "cancelled"
      ? "text-yellow-400"
      : "text-white";

  if (compact) {
    return (
      <div className={`flex items-center gap-2 text-xs ${statusColor}`}>
        <StatusIcon size={14} />
        <span>{progress.status}</span>
        {progress.progress > 0 && (
          <span className="text-muted">
            {Math.round(progress.progress)}%
          </span>
        )}
        {progress.error && (
          <span className="text-red-400 truncate" title={progress.error}>
            {progress.error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-black/40 border border-white/10 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StatusIcon size={16} className={statusColor} />
          <span className={`font-medium ${statusColor}`}>
            {progress.status}
          </span>
        </div>
        {progress.estimated_end_time && (
          <span className="text-xs text-muted">
            ETA: {new Date(progress.estimated_end_time).toLocaleString()}
          </span>
        )}
      </div>

      <div className="w-full bg-white/10 rounded h-2 mt-2">
        <div
          className="bg-primary h-full rounded transition-all duration-300"
          style={{ width: `${progress.progress}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-muted mt-2">
        <span>
          Step {progress.current_step} / {progress.total_steps}
        </span>
        <span>
          Frame {progress.current_frame} / {progress.total_frames}
        </span>
        <span>
          {progress.remaining_seconds > 0
            ? `${Math.ceil(progress.remaining_seconds)}s remaining`
            : "Complete"}
        </span>
      </div>

      {progress.error && (
        <div className="mt-2 p-2 bg-red-900/30 border border-red-700 rounded text-xs text-red-300">
          {progress.error}
        </div>
      )}
    </div>
  );
};
