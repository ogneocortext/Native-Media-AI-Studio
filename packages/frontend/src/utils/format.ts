/**
 * Shared formatting utilities.
 * Single source of truth for byte sizes, durations, dates, and output URLs.
 */

/** Format a byte count into a human-readable string (e.g. 1.5 MB). */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
  return `${value} ${sizes[i]}`;
}

/** Format seconds as mm:ss (or mm:ss.cc when showHundredths is true). */
export function formatTime(seconds: number, showHundredths = false): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  if (showHundredths) {
    const hundredths = Math.floor((safe % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${hundredths
      .toString()
      .padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Format an ISO date string as a short locale date. */
export function formatDate(dateString: string): string {
  try {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
}

/** Format an ISO date string as a full locale date-time. */
export function formatDateTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleString();
  } catch {
    return dateString;
  }
}

export { formatBytes as formatFileSize };

/** Format seconds as "42s", "5m 23s", or "2h 15m" for elapsed time display. */
export function formatElapsed(seconds: number): string {
  const total = Math.floor(seconds);
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}