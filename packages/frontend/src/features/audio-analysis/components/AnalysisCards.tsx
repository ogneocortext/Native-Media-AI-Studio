/**
 * AnalysisCards — displays analysis results in card format.
 *
 * All metrics come from the backend audio analysis pipeline. Tempo is in
 * beats per minute; duration in seconds; spectral centroid in Hz (brightness
 * of the sound — higher = brighter/more treble). The "Visual Style" card
 * shows the backend's suggested visual treatment for this track.
 *
 * Row 2 surfaces the rest of the analysis payload that used to be invisible:
 * detected musical key (+ runner-up), loudness/dynamics from the sonara
 * metadata block, the remaining spectral means, and the backend's preset /
 * theme / visualization suggestions. Every card renders only when its data
 * exists so pre-v2 cached analyses still look clean.
 */
import {
  Activity,
  AudioWaveform,
  Clock,
  Cpu,
  Music,
  Scale,
  Sparkles,
  TrendingUp,
  Volume2,
} from "lucide-react";
import { DS } from "../../../styles/designSystem";
import type { AudioAnalysisResult } from "../../../services/api";

function pct(v: number | null | undefined): string {
  return v != null ? `${(v * 100).toFixed(0)}%` : "";
}

export function AnalysisCards({ analysis }: { analysis: AudioAnalysisResult }) {
  const centroid = analysis.spectral?.centroid_mean;
  const confidence = analysis.confidence;
  const sonara = analysis.metadata?.sonara;
  const lufs = sonara?.loudness_lufs;
  const dynDb = sonara?.dynamic_range_db;
  const hasKey = analysis.estimated_key != null;
  const hasSuggestions =
    analysis.suggested_kinetic_preset != null ||
    analysis.suggested_theme_seed != null ||
    (analysis.suggested_visualization_candidates?.length ?? 0) > 0;
  const spectralExtras = [
    analysis.spectral?.rolloff_mean != null
      ? `rolloff ${Math.round(analysis.spectral.rolloff_mean)} Hz`
      : null,
    analysis.spectral?.bandwidth_mean != null
      ? `bw ${Math.round(analysis.spectral.bandwidth_mean)} Hz`
      : null,
    analysis.spectral?.zcr_mean != null
      ? `zcr ${analysis.spectral.zcr_mean.toFixed(3)}`
      : null,
  ].filter(Boolean);
  const provenance = [
    analysis.metadata?.backend,
    analysis.computed_on,
    analysis.schema_version ? `schema v${analysis.schema_version}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
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
            {`Confidence: ${(confidence * 100).toFixed(0)}%`}
            {analysis.beats_truncated ? " · beat grid capped" : ""}
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
            {`${analysis.beat_count} beats detected`}
            {analysis.downbeat_times?.length
              ? ` · ${analysis.downbeat_times.length} downbeats`
              : ""}
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

      {(hasKey || lufs != null || spectralExtras.length > 0 || hasSuggestions) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {hasKey && (
            <div className={DS.card}>
              <div className="flex items-center gap-2 mb-2">
                <Music size={16} className="text-accent" />
                <span className="text-xs text-muted">Key</span>
              </div>
              <p className="text-xl font-bold text-foreground truncate">
                {analysis.estimated_key}
              </p>
              <p className="text-xs text-muted">
                {analysis.key_confidence != null
                  ? `Confidence: ${pct(analysis.key_confidence)}`
                  : ""}
                {analysis.key_runner_up
                  ? `${analysis.key_confidence != null ? " · " : ""}alt: ${analysis.key_runner_up}`
                  : ""}
                {analysis.chroma_frames ? " · chroma tracked" : ""}
              </p>
            </div>
          )}
          {lufs != null && (
            <div className={DS.card}>
              <div className="flex items-center gap-2 mb-2">
                <Volume2 size={16} className="text-accent" />
                <span className="text-xs text-muted">Loudness</span>
              </div>
              <p className="text-xl font-bold text-foreground">
                {lufs.toFixed(1)} LUFS
              </p>
              <p className="text-xs text-muted">
                {dynDb != null ? `Dynamic range: ${dynDb.toFixed(1)} dB` : ""}
              </p>
            </div>
          )}
          {spectralExtras.length > 0 && (
            <div className={DS.card}>
              <div className="flex items-center gap-2 mb-2">
                <AudioWaveform size={16} className="text-accent" />
                <span className="text-xs text-muted">Spectrum</span>
              </div>
              <p className="text-xs font-bold text-foreground leading-relaxed">
                {spectralExtras.join(" · ")}
              </p>
              <p className="text-xs text-muted">rolloff / bandwidth / zcr means</p>
            </div>
          )}
          {hasSuggestions && (
            <div className={DS.card}>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={16} className="text-accent" />
                <span className="text-xs text-muted">Suggestions</span>
              </div>
              <div className="text-xs text-foreground space-y-0.5">
                {analysis.suggested_kinetic_preset && (
                  <p>
                    Motion:{" "}
                    <span className="font-bold">{analysis.suggested_kinetic_preset}</span>
                    {analysis.suggested_kinetic_preset_confidence != null &&
                      ` (${pct(analysis.suggested_kinetic_preset_confidence)})`}
                  </p>
                )}
                {analysis.suggested_theme_seed && (
                  <p>
                    Theme: <span className="font-bold">{analysis.suggested_theme_seed}</span>
                    {analysis.suggested_theme_seed_confidence != null &&
                      ` (${pct(analysis.suggested_theme_seed_confidence)})`}
                  </p>
                )}
                {analysis.suggested_visualization_candidates
                  ?.slice(0, 2)
                  .map((c) => (
                    <p key={c.value} className="text-muted">
                      alt style: {c.value} ({pct(c.confidence)})
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {provenance.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Cpu size={12} />
          <span>{provenance.join(" · ")}</span>
        </div>
      )}
    </div>
  );
}
