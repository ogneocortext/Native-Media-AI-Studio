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
  Play,
  Download,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { StatusBadge, ProgressBar } from "../../components/common";
import type { Job, JobStep } from "@shared/types";
import { getApiBase } from "../../services/api";
import { calculateEta, formatElapsed } from "../../utils/eta";

/**
 * One line of a job's step list, with its status rendered as an icon.
 * Steps are optional in the Job model, so this is only rendered when the
 * backend sends them — a job with no steps shows just the flat progress bar.
 */
function StepRow({ step }: { step: JobStep }) {
  const icon =
    step.status === "completed" ? (
      <CheckCircle size={12} className="text-success-text shrink-0" />
    ) : step.status === "running" ? (
      <Loader2 size={12} className="text-primary animate-spin shrink-0" />
    ) : step.status === "failed" ? (
      <AlertCircle size={12} className="text-error-text shrink-0" />
    ) : (
      <Clock size={12} className="text-muted shrink-0" />
    );
  return (
    <div className="flex items-center gap-2 text-xs">
      {icon}
      <span className="text-muted truncate" title={step.name}>
        {step.name}
      </span>
      {step.status === "running" && step.progress > 0 && (
        <span className="text-primary ml-auto">
          {(step.progress * 100).toFixed(0)}%
        </span>
      )}
    </div>
  );
}

export const getStatusIcon = (status: string) => {
  switch (status) {
    case "running":
      return <Loader2 size={18} className="text-primary animate-spin" />;
    case "completed":
      return <CheckCircle size={18} className="text-success-text" />;
    case "failed":
      return <AlertCircle size={18} className="text-error-text" />;
    case "cancelled":
      return <XCircle size={18} className="text-muted" />;
    default:
      return <Clock size={18} className="text-muted" />;
  }
};

interface JobRowProps {
  job: Job;
  index?: number;
  /** Total pending jobs — renders honest "Queued #N of M" position. */
  total?: number;
  actionLoading: string | null;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  /** Drill-down: clicking a row opens the detail view. */
  onSelect?: (job: Job) => void;
}

const AUDIO_JOB_TYPES = new Set([
  "audio_analysis",
  "audio_feature_extraction",
  "audio_transcription",
]);

function isAudioJob(job: Job): boolean {
  return AUDIO_JOB_TYPES.has(job.job_type);
}

/**
 * Audio-specific progress visualization: a mini waveform whose bars light up
 * proportionally to `progress`. Gives audio jobs a distinct visual identity
 * compared to the flat progress bar used for everything else.
 */
function AudioWaveform({ progress }: { progress: number }) {
  const bars = 24;
  const filled = Math.round(progress * bars);
  return (
    <div
      className="flex items-end gap-0.5 h-6"
      role="img"
      aria-label={`Audio progress ${(progress * 100).toFixed(0)}%`}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const height = 30 + 70 * Math.abs(Math.sin((i + 1) * 0.7));
        const active = i < filled;
        return (
          <span
            key={i}
            className={`w-1 rounded-sm transition-colors duration-200 ${
              active ? "bg-primary" : "bg-muted/30"
            }`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

export function JobRow({
  job,
  index,
  total,
  actionLoading,
  onSelect,
  onCancel,
  onRetry,
  onDelete,
}: JobRowProps) {
  const loading = actionLoading === job.id;
  const isPending = job.status === "pending" || job.status === "queued";
  const isFailed = job.status === "failed";
  // Manual retries always run: the backend resets an exhausted budget, because
  // the user pressing Retry declares the fault fixed. Automatic retries stay
  // bounded by max_retries.
  const showRetry = isFailed;
  const showCancel = isPending;
  const showDelete = !isPending;
  const isCompleted = job.status === "completed";
  const tsLabel = isCompleted ? "Completed" : "Created";
  const tsValue = isCompleted
    ? job.completed_at
      ? new Date(job.completed_at).toLocaleString()
      : "N/A"
    : new Date(job.created_at).toLocaleString();
  // Progress visibility: a running job shows its bar, ETA, and per-step
  // breakdown; a failed job shows how many attempts it has burned.
  const isRunning = job.status === "running";
  const eta = isRunning
    ? calculateEta(job.started_at, job.progress, job.status)
    : null;
  const steps = job.steps && job.steps.length > 0 ? job.steps : null;

  return (
    <div
      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-background rounded-lg border border-border transition-colors ${
        onSelect ? "cursor-pointer hover:border-primary/50 hover:bg-primary/5" : ""
      }`}
      onClick={() => onSelect?.(job)}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? `View details for ${job.job_type.replace(/_/g, " ")}` : undefined}
      onKeyDown={(e) => {
        if (onSelect && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect(job);
        }
      }}
    >
      <div className="flex items-start gap-4 min-w-0 flex-1">
        {isPending && index !== undefined ? (
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted/20 text-xs font-medium text-muted shrink-0">
            {index + 1}
          </div>
        ) : (
          getStatusIcon(job.status)
        )}
        <div>
          <p className="font-medium capitalize">{job.job_type.replace(/_/g, " ")}</p>
          <p className="text-xs text-muted">
            ID: {job.id.slice(0, 8)}... | {tsLabel}: {tsValue}
          </p>
          {isPending && index !== undefined && total !== undefined && (
            <p className="text-xs text-primary/80 font-medium mt-0.5">
              Queued #{index + 1} of {total}
            </p>
          )}
          {/* Progress visibility: running jobs get a live bar, an ETA, and
              their per-step breakdown. The model already carries these; the
              row just never rendered them. */}
          {isRunning && (
            <div className="mt-3 w-full max-w-md">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted">
                  {job.message || "Working…"}
                </span>
                <span className="text-primary font-medium">
                  {(job.progress * 100).toFixed(0)}%
                </span>
              </div>
              {isAudioJob(job) ? (
                <AudioWaveform progress={job.progress} />
              ) : (
                <ProgressBar progress={job.progress} showPercentage={false} />
              )}
              <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                <span>Elapsed {formatElapsed(eta?.elapsedSeconds || 0)}</span>
                {eta?.canEstimate && eta.remainingFormatted ? (
                  <span>~{eta.remainingFormatted} remaining</span>
                ) : (
                  <span>Calculating…</span>
                )}
                {job.duration_seconds ? (
                  <span className="ml-auto">{job.duration_seconds.toFixed(0)}s avg</span>
                ) : null}
              </div>
              {steps && (
                <div className="mt-2 space-y-1">
                  {steps.map((s, i) => (
                    <StepRow key={i} step={s} />
                  ))}
                </div>
              )}
            </div>
          )}
          {isFailed && job.error && (
            <p className="text-sm text-error-text mt-1">Error: {job.error}</p>
          )}
          {/* Attempt visibility: failed jobs show how many retries were
              burned; retrying jobs show the attempt in flight. Backoff
              countdown needs backend state the model doesn't carry, so it
              is shown only when the server reports a message. */}
          {(isFailed || job.status === "retrying") && (
            <p className="text-xs text-muted mt-1">
              {job.status === "retrying" ? "Retrying" : "Retries"}: attempt{" "}
              {job.retry_count + 1} of {job.max_retries + 1}
              {job.status === "retrying" && job.message
                ? ` · ${job.message}`
                : ""}
            </p>
          )}
          {job.message && <p className="text-sm text-muted mt-1">{job.message}</p>}
          {job.output_path && (
            <p className="text-xs text-muted mt-1 truncate" title={job.output_path}>
              Output: {job.output_path.split(/[\\/]/).pop()}
            </p>
          )}
          {isCompleted &&
            !!(
              job.output_path ||
              ((job.result as Record<string, unknown> | null)?.output_path as string) ||
              ""
            ) &&
            (() => {
              const raw = (job.output_path ||
                ((job.result as Record<string, unknown> | null)?.output_path as string) ||
                "") as string;
              // Extract filename from absolute Windows path or relative
              const filename = raw.split(/[\\/]/).pop() || "";
              if (!filename) return null;
              // Try to determine subfolder from path
              const isPreview = raw.includes("previews") || filename.includes("preview");
              const videoUrl = `${getApiBase()}/output/${isPreview ? "previews" : "video"}/${filename}`;
              const isMp4 = filename.toLowerCase().endsWith(".mp4");
              return (
                <div className="mt-3">
                  {isMp4 ? (
                    <video
                      controls
                      preload="metadata"
                      className="w-full max-w-full sm:max-w-md rounded-lg border border-border bg-black"
                      style={{ maxHeight: 240 }}
                      src={videoUrl}
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = "none";
                        const fallback = document.createElement("a");
                        fallback.href = videoUrl;
                        fallback.target = "_blank";
                        fallback.rel = "noopener noreferrer";
                        fallback.className = "text-xs text-link hover:underline flex items-center gap-1";
                        fallback.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Video unavailable — try downloading</span>`;
                        target.parentElement?.appendChild(fallback);
                      }}
                      aria-label={`Video for job ${job.id.slice(0, 8)}`}
                    />
                  ) : (
                    <a
                      href={videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-link hover:underline flex items-center gap-1"
                    >
                      <ExternalLink size={12} /> View output
                    </a>
                  )}
                  <div className="flex gap-2 mt-2">
                    <a
                      href={videoUrl}
                      download={filename}
                      className="btn btn-secondary p-2 text-xs flex items-center gap-1"
                      title="Download video"
                    >
                      <Download size={14} /> Download
                    </a>
                    <a
                      href={videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary p-2 text-xs flex items-center gap-1"
                      title="Open in new tab"
                    >
                      <ExternalLink size={14} /> Open
                    </a>
                    <span className="text-xs text-muted flex items-center gap-1">
                      <Play size={12} /> {isPreview ? "Preview" : "Video"} · {filename}
                    </span>
                  </div>
                </div>
              );
            })()}
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        {onSelect && <ChevronRight size={16} className="text-muted" />}
        <StatusBadge status={job.status} />
        <div className="flex flex-wrap items-center gap-2">
          {showCancel && (
            <button
              className="btn btn-secondary p-2"
              aria-label={`Cancel ${job.job_type.replace(/_/g, " ")} job`}
              onClick={() => onCancel(job.id)}
              disabled={loading}
              title="Cancel"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
            </button>
          )}
          {showRetry && (
            <button
              className="btn btn-secondary p-2"
              aria-label={`Retry ${job.job_type.replace(/_/g, " ")} job`}
              onClick={() => onRetry(job.id)}
              disabled={loading}
              title="Retry"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
            </button>
          )}
          {showDelete && (
            <button
              className="btn btn-secondary p-2"
              aria-label={`Delete ${job.job_type.replace(/_/g, " ")} job`}
              onClick={() => onDelete(job.id)}
              disabled={loading}
              title="Delete"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
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
  onSelect?: (job: Job) => void;
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
  onSelect,
  onCancel,
  onRetry,
  onDelete,
}: JobListSectionProps) {
  if (jobs.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className={`text-sm font-medium ${titleColor} mb-3 uppercase tracking-wide`}>
        {heading}
      </h3>
      <div className="space-y-2">
        {jobs.map((job, index) => (
          <JobRow
            key={job.id}
            job={job}
            index={isPending ? index : undefined}
            total={isPending ? jobs.length : undefined}
            actionLoading={actionLoading}
            onSelect={onSelect}
            onCancel={onCancel}
            onRetry={onRetry}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
