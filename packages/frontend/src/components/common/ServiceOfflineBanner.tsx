import { WifiOff, Loader2, RefreshCw } from "lucide-react";

interface ServiceOfflineBannerProps {
  /** Service name shown in the title, e.g. "ComfyUI". */
  service: string;
  /** Why the page can't proceed, e.g. "Image generation requires ComfyUI". */
  detail?: string;
  /** Optional extra context, e.g. the expected port. */
  hint?: string;
  /** Start the service. When omitted, only Retry is shown. */
  onStart?: () => void;
  starting?: boolean;
  /** Re-check status (e.g. after the service came up). */
  onRetry?: () => void;
}

/**
 * Shared offline-service banner.
 *
 * Every generation page used to invent its own offline state — amber card
 * here, red card there, details card elsewhere — which read as inconsistent
 * and often buried the one action that unblocks the page. This is the single
 * implementation: status line, plain-language reason, primary Start action,
 * secondary Retry.
 */
export function ServiceOfflineBanner({
  service,
  detail,
  hint,
  onStart,
  starting = false,
  onRetry,
}: ServiceOfflineBannerProps) {
  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-center gap-3"
    >
      <WifiOff size={18} className="text-amber-400 shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-200">{service} is offline</p>
        <p className="text-xs text-amber-300/80">
          {detail ?? `${service} is required for this page.`}
          {hint ? ` ${hint}` : ""}
        </p>
      </div>
      {onStart && (
        <button
          onClick={onStart}
          disabled={starting}
          className="btn btn-primary btn-sm flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
        >
          {starting ? <Loader2 size={12} className="animate-spin" /> : null}
          {starting ? "Starting…" : `Start ${service}`}
        </button>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn btn-ghost btn-sm flex items-center gap-1.5 whitespace-nowrap"
          aria-label={`Re-check ${service} status`}
        >
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}
