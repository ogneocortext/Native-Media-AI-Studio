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
import { JobStatus } from "@shared/types";
import { getOutputUrl } from "../../utils/url";
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
        <span className="text-primary ml-auto">{(step.progress * 100).toFixed(0)}%</span>
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

type OutputKind = "video" | "image" | "audio" | "file";

const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "avi"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"]);

function outputKind(filename: string): OutputKind {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "file";
}

/**
 * Job output paths arrive in several shapes: project-relative
 * ("output/video/x.mp4"), absolute ("D:\\...\\output\\video\\x.mp4"),
 * output-dir-relative ("video/x.mp4"), or already servable
 * ("/output/..." or a full URL). Reduce any of them to a URL the backend's
 * `/output` static mount can serve.
 */
function resolveJobOutput(
  raw: string,
): { url: string; filename: string; kind: OutputKind } | null {
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() ?? "";
  if (!filename) return null;

  let url: string;
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith("/output/")) {
    url = normalized;
  } else {
    const idx = normalized.toLowerCase().lastIndexOf("/output/");
    const rel =
      idx >= 0
        ? normalized.slice(idx + "/output/".length)
        : normalized.toLowerCase().startsWith("output/")
          ? normalized.slice("output/".length)
          : normalized;
    url = getOutputUrl(rel);
  }
  return { url, filename, kind: outputKind(filename) };
}

/**
 * Renders the completed job's output inline: a video player for video
 * files, an image thumbnail for images, an audio element for audio, and a
 * link for everything else. Falls back to the Open/Download row if the
 * media element fails to load.
 */
function JobOutputPreview({ job }: { job: Job }) {
  const raw = String(
    job.output_path ?? (job.result?.output_path as string | undefined) ?? "",
  );
  const out = resolveJobOutput(raw);
  if (!out) return null;
  const { url, filename, kind } = out;
  const isPreview = /preview/i.test(filename);
  const kindLabel =
    kind === "video" ? (isPreview ? "Preview" : "Video")
    : kind === "image" ? "Image"
    : kind === "audio" ? "Audio"
    : "File";

  return (
    <div className="mt-3">
      {kind === "video" && (
        <video
          controls
          preload="metadata"
          className="w-full h-auto max-h-[40vh] sm:max-h-[240px] rounded-lg border border-border bg-black object-contain"
          src={url}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          aria-label={`Video for job ${job.id.slice(0, 8)}`}
        />
      )}
      {kind === "image" && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={url}
            alt={`Output for job ${job.id.slice(0, 8)}`}
            loading="lazy"
            className="max-h-48 w-auto max-w-full rounded-lg border border-border object-contain bg-black/30"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </a>
      )}
      {kind === "audio" && (
        <audio
          controls
          preload="none"
          src={url}
          className="w-full h-9"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <div className="flex gap-2 mt-2">
        <a
          href={url}
          download={filename}
          className="btn btn-secondary p-2 text-xs flex items-center gap-1"
          title={`Download ${kindLabel.toLowerCase()}`}
        >
          <Download size={14} /> Download
        </a>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary p-2 text-xs flex items-center gap-1"
          title="Open in new tab"
        >
          <ExternalLink size={14} /> Open
        </a>
        <span className="text-xs text-muted flex items-center gap-1">
          {kind === "video" && <Play size={12} />}
          {kindLabel} · {filename}
        </span>
      </div>
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
  const isPending = job.status === JobStatus.PENDING || job.status === JobStatus.QUEUED;
  const isFailed = job.status === JobStatus.FAILED;
  // Manual retries always run: the backend resets an exhausted budget, because
  // the user pressing Retry declares the fault fixed. Automatic retries stay
  // bounded by max_retries.
  const showRetry = isFailed;
  const showCancel = isPending;
  const showDelete = !isPending;
  const isCompleted = job.status === JobStatus.COMPLETED;
  const tsLabel = isCompleted ? "Completed" : "Created";
  const tsValue = isCompleted
    ? job.completed_at
      ? new Date(job.completed_at).toLocaleString()
      : job.duration_seconds != null
        ? `~${job.duration_seconds.toFixed(0)}s duration`
        : "N/A"
    : new Date(job.created_at).toLocaleString();
  // Progress visibility: a running job shows its bar, ETA, and per-step
  // breakdown; a completed job shows a 100% bar; a failed job shows how many
  // attempts it has burned.
  const isRunning = job.status === JobStatus.RUNNING;
  const eta = isRunning ? calculateEta(job.started_at, job.progress, job.status) : null;
  const steps = job.steps && job.steps.length > 0 ? job.steps : null;
  // Completed jobs show a full 100% progress bar
  const completedProgress = isCompleted ? 1 : job.progress;

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
          <p className="text-xs text-muted" title={job.id}>
            ID: {job.id.slice(0, 8)}... | {tsLabel}: {tsValue}
          </p>
          {isPending && index !== undefined && total !== undefined && (
            <p className="text-xs text-primary/80 font-medium mt-0.5">
              Queued #{index + 1} of {total}
            </p>
          )}
          {/* Progress visibility: running and completed jobs get a live bar,
              an ETA, and their per-step breakdown. The model already carries
              these; the row just never rendered them for completed jobs. */}
          {(isRunning || isCompleted) && (
            <div className="mt-3 w-full max-w-md">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted">
                  {job.message || (isCompleted ? "Finished" : "Working…")}
                </span>
                <span className="text-primary font-medium">
                  {(completedProgress * 100).toFixed(0)}%
                </span>
              </div>
              {isAudioJob(job) ? (
                <AudioWaveform progress={completedProgress} />
              ) : (
                <ProgressBar progress={completedProgress} showPercentage={false} />
              )}
              <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                <span>Elapsed {formatElapsed(eta?.elapsedSeconds ?? 0)}</span>
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
          {(isFailed || job.status === JobStatus.RETRYING) && (
            <p className="text-xs text-muted mt-1">
              {job.status === JobStatus.RETRYING ? "Retrying" : "Retries"}: attempt{" "}
              {job.retry_count + 1} of {job.max_retries + 1}
              {job.status === JobStatus.RETRYING && job.message ? ` · ${job.message}` : ""}
            </p>
          )}
          {job.message && <p className="text-sm text-muted mt-1">{job.message}</p>}
          {job.output_path && (
            <p className="text-xs text-muted mt-1 truncate" title={job.output_path}>
              Output: {job.output_path.split(/[\\/]/).pop()}
            </p>
          )}
          {isCompleted && <JobOutputPreview job={job} />}
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
