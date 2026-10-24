/**
 * AnalysisCards — displays analysis results in card format
 */
import { BarChart3, Activity, Clock, TrendingUp } from "lucide-react";
import { DS } from "../../../styles/designSystem";
import type { AudioAnalysisResult } from "../../../services/api";

export function AnalysisCards({ analysis }: { analysis: AudioAnalysisResult }) {
  if (!analysis) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className={DS.card}>
        <div className="flex items-center gap-2 mb-2">
          <Activity size={16} className="text-accent" />
          <span className="text-xs text-muted">Tempo</span>
        </div>
        <p className="text-xl font-bold text-foreground">{analysis.tempo_bpm?.toFixed(1) || "--"} BPM</p>
      </div>
      <div className={DS.card}>
        <div className="flex items-center gap-2 mb-2">
          <Clock size={16} className="text-accent" />
          <span className="text-xs text-muted">Duration</span>
        </div>
        <p className="text-xl font-bold text-foreground">{analysis.duration_seconds?.toFixed(1) || "--"}s</p>
      </div>
      <div className={DS.card}>
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 size={16} className="text-accent" />
          <span className="text-xs text-muted">Key</span>
        </div>
        <p className="text-xl font-bold text-foreground">{analysis.suggested_visualization || "--"}</p>
      </div>
      <div className={DS.card}>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={16} className="text-accent" />
          <span className="text-xs text-muted">Energy</span>
        </div>
        <p className="text-xl font-bold text-foreground">{analysis.spectral?.centroid_mean?.toFixed(2) || "--"}</p>
      </div>
    </div>
  );
}
