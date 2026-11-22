/**
 * VizFooter — bottom metering strip (spectrum bars + beat pulse).
 *
 * Presentational only: renders live audio data passed in by Visualizer.
 * Keeps Visualizer.tsx small by isolating the bottom bar's markup.
 */
import type { AudioData } from "../types";
import { SpectrumBar } from "./SpectrumBar";

interface VizFooterProps {
  /** Latest frame-level audio data (bass/mid/treble/beat/energy). */
  audioData: AudioData;
}

export function VizFooter({ audioData }: VizFooterProps) {
  return (
    <footer className="viz-bottombar">
      <div className="viz-spectrum">
        <SpectrumBar label="Bass" value={audioData.bass} color="oklch(74% 0.14 215)" />
        <SpectrumBar label="Mid" value={audioData.mid} color="var(--viz-accent)" />
        <SpectrumBar label="Treble" value={audioData.treble} color="var(--viz-accent-2)" />
      </div>
      <div className="viz-beat">
        <div className={`viz-beat-dot ${audioData.beat ? "active" : ""}`} aria-hidden="true" />
      </div>
    </footer>
  );
}
