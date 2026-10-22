/**
 * ETA (Estimated Time of Arrival) calculation utilities for job progress tracking.
 *
 * Computes remaining time based on elapsed time and current progress.
 * Handles cold-start (no progress yet), stalled jobs, and near-completion.
 */

export interface EtaResult {
  /** Estimated remaining seconds, or null if cannot be estimated */
  remainingSeconds: number | null;
  /** Human-readable remaining time string */
  remainingFormatted: string | null;
  /** Elapsed seconds since job started */
  elapsedSeconds: number;
  /** Progress as 0-1 (clamped) */
  progress: number;
  /** Whether ETA is calculable (progress > 0 and job is still running) */
  canEstimate: boolean;
}

/**
 * Format seconds into a human-readable duration string.
 * Examples: "30s", "2m 15s", "1h 5m 30s", "< 1s"
 */
function formatDuration(seconds: number): string {
  if (seconds < 1) return "< 1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 && hours === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

/**
 * Calculate ETA for a running job based on elapsed time and progress.
 *
 * @param startedAt - ISO timestamp when the job started (null if not started)
 * @param progress - Current progress as 0-1
 * @param status - Current job status
 * @param now - Optional reference time (defaults to Date.now())
 */
export function calculateEta(
  startedAt: string | null,
  progress: number,
  status: string,
  now: number = Date.now(),
): EtaResult {
  const clampedProgress = Math.min(Math.max(progress, 0), 1);

  // Cannot estimate if not started or not running
  if (!startedAt || status !== "running") {
    return {
      remainingSeconds: null,
      remainingFormatted: null,
      elapsedSeconds: 0,
      progress: clampedProgress,
      canEstimate: false,
    };
  }

  const startTime = new Date(startedAt).getTime();
  if (isNaN(startTime)) {
    return {
      remainingSeconds: null,
      remainingFormatted: null,
      elapsedSeconds: 0,
      progress: clampedProgress,
      canEstimate: false,
    };
  }

  const elapsedSeconds = (now - startTime) / 1000;

  // If progress is 0, we can't estimate yet
  if (clampedProgress <= 0) {
    return {
      remainingSeconds: null,
      remainingFormatted: null,
      elapsedSeconds,
      progress: clampedProgress,
      canEstimate: false,
    };
  }

  // If complete, no remaining time
  if (clampedProgress >= 1) {
    return {
      remainingSeconds: 0,
      remainingFormatted: "0s",
      elapsedSeconds,
      progress: clampedProgress,
      canEstimate: true,
    };
  }

  // Linear extrapolation: total = elapsed / progress, remaining = total - elapsed
  const totalEstimatedSeconds = elapsedSeconds / clampedProgress;
  const remainingSeconds = Math.max(0, totalEstimatedSeconds - elapsedSeconds);

  return {
    remainingSeconds,
    remainingFormatted: formatDuration(remainingSeconds),
    elapsedSeconds,
    progress: clampedProgress,
    canEstimate: true,
  };
}

/**
 * Format elapsed seconds into a display string.
 */
export function formatElapsed(seconds: number): string {
  return formatDuration(seconds);
}

export default { calculateEta, formatDuration, formatElapsed };