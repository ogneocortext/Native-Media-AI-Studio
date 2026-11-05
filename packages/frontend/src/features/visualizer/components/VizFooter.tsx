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
        <SpectrumBar label="Bass" value={audioData.bass} color="#6366f1" />
        <SpectrumBar label="Mid" value={audioData.mid} color="#a855f7" />
        <SpectrumBar label="Treble" value={audioData.treble} color="#ec4899" />
      </div>
      <div className="viz-beat">
        <div className={`viz-beat-dot ${audioData.beat ? "active" : ""}`} aria-hidden="true" />
      </div>
    </footer>
  );
}
