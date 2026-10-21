/**
 * SuccessCard — the celebration on the 5-minute path.
 *
 * The output is the celebration (O1 pattern 6): the clip plays in place.
 * No confetti, no modal, no toast. Three next actions in order — keep it,
 * go deeper, or run the path again.
 *
 * See `docs/ux/5-minute-path.md` step 6.
 */

import { Download, ExternalLink, RotateCcw } from "lucide-react";

export interface SuccessCardProps {
  /** URL of the rendered clip (plays in place). */
  outputUrl: string;
  /** The track that was rendered. */
  filename: string;
  /** "Save to library" — the clip is already on disk; this confirms it. */
  onSave?: () => void;
  /** "Open in Visualizer" — the door into the full studio. */
  onOpenStudio?: () => void;
  /** "Make another" — run the path again with another track. */
  onMakeAnother?: () => void;
}

export function SuccessCard({
  outputUrl,
  filename,
  onSave,
  onOpenStudio,
  onMakeAnother,
}: SuccessCardProps) {
  return (
    <div
      className="flex flex-col items-center gap-4"
      data-testid="onboarding-success"
    >
      <h2 className="text-xl font-semibold text-white">Your first clip is ready.</h2>

      <video
        src={outputUrl}
        controls
        loop
        autoPlay
        muted
        playsInline
        data-testid="onboarding-success-video"
        className="w-full max-w-2xl rounded-xl border border-white/10 bg-black"
      />

      <p className="text-xs text-white/45">{filename}</p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            data-testid="onboarding-save"
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition flex items-center gap-2"
          >
            <Download size={15} />
            Save to library
          </button>
        )}
        {onOpenStudio && (
          <button
            type="button"
            onClick={onOpenStudio}
            data-testid="onboarding-open-studio"
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 text-sm font-medium transition flex items-center gap-2"
          >
            <ExternalLink size={15} />
            Open in Visualizer
          </button>
        )}
        {onMakeAnother && (
          <button
            type="button"
            onClick={onMakeAnother}
            data-testid="onboarding-another"
            className="px-4 py-2 rounded-lg text-white/50 hover:text-white/80 text-sm transition flex items-center gap-2"
          >
            <RotateCcw size={14} />
            Make another
          </button>
        )}
      </div>
    </div>
  );
}
