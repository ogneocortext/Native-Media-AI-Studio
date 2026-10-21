/**
 * QuickExportButton — the render decision on the 5-minute path.
 *
 * One button, no settings. The spec is fixed: 10 seconds, the highest-energy
 * window of the track, the look chosen in step 3, platform-default encoding.
 * The caption says exactly what happens before the user presses it
 * ("We'll clip the biggest 10 seconds") — see `docs/ux/5-minute-path.md`.
 */

import { Loader2 } from "lucide-react";

export interface QuickExportButtonProps {
  /** Called when the user asks for the clip. */
  onExport: () => void;
  /** True while the render is in flight. */
  busy?: boolean;
  /** Disabled (e.g. the look was not accepted yet). */
  disabled?: boolean;
  /** The window that will be clipped, for the caption. */
  clipStart?: number | null;
}

export function QuickExportButton({
  onExport,
  busy = false,
  disabled = false,
  clipStart = null,
}: QuickExportButtonProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      {clipStart !== null && (
        <p className="text-xs text-white/50">
          We&apos;ll clip the biggest 10 seconds.
        </p>
      )}
      <button
        type="button"
        onClick={onExport}
        disabled={disabled || busy}
        data-testid="onboarding-export"
        className="px-6 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition flex items-center gap-2"
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        {busy ? "Making your clip…" : "Make my clip"}
      </button>
    </div>
  );
}
