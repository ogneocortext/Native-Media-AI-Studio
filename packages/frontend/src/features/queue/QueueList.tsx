/**
 * Queue sub-components extracted from Queue.tsx.
 *
 * The Queue page previously inlined four near-identical status sections
 * (Pending / Failed / Completed / Cancelled), each repeating the same job-row
 * markup with tiny per-status variants. `JobRow` unifies all of them and
 * `JobListSection` composes a titled, count-aware section.
 */
import {
  CheckCircle,
  AlertCircle,
  XCircle,
  Clock,
  Loader2,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { StatusBadge } from "../../components/common";
import type { Job } from "../../services/api";

export const getStatusIcon = (status: string) => {
  switch (status) {
    case "running":
      return <Loader2 size={18} className="text-primary animate-spin" />;
    case "completed":
      return <CheckCircle size={18} className="text-success" />;
    case "failed":
      return <AlertCircle size={18} className="text-error" />;
    case "cancelled":
      return <XCircle size={18} className="text-muted" />;
    default:
      return <Clock size={18} className="text-muted" />;
  }
};

interface JobRowProps {
  job: Job;
  index?: number;
  actionLoading: string | null;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
}

export function JobRow({
  job,
  index,
  actionLoading,
  onCancel,
  onRetry,
  onDelete,
}: JobRowProps) {
  const loading = actionLoading === job.id;
  const isPending = job.status === "pending" || job.status === "queued";
  const isFailed = job.status === "failed";
  const canRetry = isFailed && job.retry_count < job.max_retries;
  const showCancel = isPending;
  const showRetry = canRetry;
  const showDelete = !isPending;
  const isCompleted = job.status === "completed";
  const tsLabel = isCompleted ? "Completed" : "Created";
  const tsValue = isCompleted
    ? job.completed_at
      ? new Date(job.completed_at).toLocaleString()
      : "N/A"
    : new Date(job.created_at).toLocaleString();

  return (
    <div className="flex items-center justify-between p-4 bg-background rounded-lg border border-border">
      <div className="flex items-center gap-4">
        {isPending && index !== undefined ? (
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted/20 text-xs font-medium text-muted">
            {index + 1}
          </div>
        ) : (
          getStatusIcon(job.status)
        )}
        <div>
          <p className="font-medium capitalize">
            {job.job_type.replace(/_/g, " ")}
          </p>
          <p className="text-xs text-muted">
            ID: {job.id.slice(0, 8)}... | {tsLabel}: {tsValue}
          </p>
          {isFailed && job.error && (
            <p className="text-sm text-error mt-1">
              Error: {job.error}
            </p>
          )}
          {isFailed && job.retry_count > 0 && (
            <p className="text-xs text-muted mt-1">
              Retry attempts: {job.retry_count}/{job.max_retries}
            </p>
          )}
          {job.message && (
            <p className="text-sm text-muted mt-1">
              {job.message}
            </p>
          )}
          {job.output_path && (
            <p className="text-xs text-muted mt-1">
              Output: {job.output_path}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <StatusBadge status={job.status} />
        <div className="flex items-center gap-2">
          {showCancel && (
            <button
              className="btn btn-secondary p-2"
              onClick={() => onCancel(job.id)}
              disabled={loading}
              title="Cancel"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <XCircle size={16} />
              )}
            </button>
          )}
          {showRetry && (
            <button
              className="btn btn-secondary p-2"
              onClick={() => onRetry(job.id)}
              disabled={loading}
              title="Retry"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RotateCcw size={16} />
              )}
            </button>
          )}
          {showDelete && (
            <button
              className="btn btn-secondary p-2"
              onClick={() => onDelete(job.id)}
              disabled={loading}
              title="Delete"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Trash2 size={16} />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface JobListSectionProps {
  heading: string;
  titleColor?: string;
  jobs: Job[];
  isPending?: boolean;
  actionLoading: string | null;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
}

export function JobListSection({
  heading,
  titleColor = "text-muted",
  jobs,
  isPending,
  actionLoading,
  onCancel,
  onRetry,
  onDelete,
}: JobListSectionProps) {
  if (jobs.length === 0) return null;
  return (
    <div className="mb-6">
      <h3
        className={`text-sm font-medium ${titleColor} mb-3 uppercase tracking-wide`}
      >
        {heading}
      </h3>
      <div className="space-y-2">
        {jobs.map((job, index) => (
          <JobRow
            key={job.id}
            job={job}
            index={isPending ? index : undefined}
            actionLoading={actionLoading}
            onCancel={onCancel}
            onRetry={onRetry}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
