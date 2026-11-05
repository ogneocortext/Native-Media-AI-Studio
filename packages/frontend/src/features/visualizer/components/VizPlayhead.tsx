/**
 * VizPlayhead — click-to-seek progress overlay on the stage: fill track,
 * A-B loop region/anchor markers, playhead marker and time readout.
 *
 * Extracted from Visualizer.tsx (T-VIZ-33). Position comes from the reactive
 * `elapsed` state (driven by the playback rAF loop), not refs, so the marker
 * tracks playback. The canvas paints over this div; only the marker and
 * readout are pointer-events: auto so seeking works through the playing
 * surface.
 */
import type { MouseEvent } from "react";
import { formatTime } from "../../../utils/format";

interface VizPlayheadProps {
  elapsed: number;
  audioDuration: number;
  loopRegion: { start: number; end: number } | null;
  loopAnchor: number | null;
  onSeek: (e: MouseEvent<HTMLDivElement>) => void;
}

export function VizPlayhead({
  elapsed,
  audioDuration,
  loopRegion,
  loopAnchor,
  onSeek,
}: VizPlayheadProps) {
  if (!(audioDuration > 0)) return null;
  const pct = Math.min(1, Math.max(0, elapsed / audioDuration));
  return (
    <div
      className="viz-playhead"
      onClick={onSeek}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={Math.round(audioDuration)}
      aria-valuenow={Math.min(elapsed, audioDuration)}
      aria-valuetext={`${formatTime(elapsed)} of ${formatTime(audioDuration)}`}
    >
      <div
        className="viz-playhead-track"
        aria-hidden="true"
        style={{ transform: `scaleX(${pct})` }}
      />
      {loopRegion && (
        <div
          className="viz-loop-region"
          aria-hidden="true"
          style={{
            left: `${(loopRegion.start / audioDuration) * 100}%`,
            width: `${((loopRegion.end - loopRegion.start) / audioDuration) * 100}%`,
          }}
        />
      )}
      {loopAnchor !== null && !loopRegion && (
        <div
          className="viz-loop-anchor"
          aria-hidden="true"
          style={{ left: `${(loopAnchor / audioDuration) * 100}%` }}
        />
      )}
      <div
        className="viz-playhead-marker"
        aria-hidden="true"
        style={{ left: `${Math.min(100, pct * 100)}%` }}
      />
      <div className="viz-playhead-readout" aria-hidden="true">
        {formatTime(elapsed)} / {formatTime(audioDuration)}
      </div>
    </div>
  );
}
