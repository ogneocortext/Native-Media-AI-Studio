/**
 * AnalysisCards — displays analysis results in card format.
 *
 * All metrics come from the backend audio analysis pipeline. Tempo is in
 * beats per minute; duration in seconds; spectral centroid in Hz (brightness
 * of the sound — higher = brighter/more treble). The "Visual Style" card
 * shows the backend's suggested visual treatment for this track.
 */
import { Activity, Clock, Scale, TrendingUp } from "lucide-react";
import { DS } from "../../../styles/designSystem";
import type { AudioAnalysisResult } from "../../../services/api";

export function AnalysisCards({ analysis }: { analysis: AudioAnalysisResult }) {
  if (!analysis) return null;

  const centroid = analysis.spectral?.centroid_mean;
  const confidence = analysis.confidence ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className={DS.card}>
        <div className="flex items-center gap-2 mb-2">
          <Activity size={16} className="text-accent" />
          <span className="text-xs text-muted">Tempo</span>
        </div>
        <p className="text-xl font-bold text-foreground">
          {analysis.tempo_bpm.toFixed(0) || "--"} BPM
        </p>
        <p className="text-xs text-muted">
          {analysis.confidence != null
            ? `Confidence: ${(confidence * 100).toFixed(0)}%`
            : "No confidence data"}
        </p>
      </div>
      <div className={DS.card}>
        <div className="flex items-center gap-2 mb-2">
          <Clock size={16} className="text-accent" />
          <span className="text-xs text-muted">Duration</span>
        </div>
        <p className="text-xl font-bold text-foreground">
          {analysis.duration_seconds.toFixed(1) || "--"}s
        </p>
        <p className="text-xs text-muted">
          {analysis.beat_count != null ? `${analysis.beat_count} beats detected` : ""}
        </p>
      </div>
      <div className={DS.card}>
        <div className="flex items-center gap-2 mb-2">
          <Scale size={16} className="text-accent" />
          <span className="text-xs text-muted">Visual Style</span>
        </div>
        <p className="text-sm font-bold text-foreground truncate">
          {analysis.suggested_visualization ?? "--"}
        </p>
        <p className="text-xs text-muted">
          {analysis.suggested_visualization_confidence != null
            ? `Confidence: ${(analysis.suggested_visualization_confidence * 100).toFixed(0)}%`
            : ""}
        </p>
      </div>
      <div className={DS.card}>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={16} className="text-accent" />
          <span className="text-xs text-muted">Brightness (Hz)</span>
        </div>
        <p className="text-xl font-bold text-foreground">
          {centroid != null ? centroid.toFixed(0) : "--"} Hz
        </p>
        <p className="text-xs text-muted">
          {centroid != null
            ? centroid > 3000
              ? "Bright/treble-heavy"
              : centroid > 1500
                ? "Balanced"
                : "Dark/bass-heavy"
            : ""}
        </p>
      </div>
    </div>
  );
}
