import { useState, useCallback, useEffect } from "react";
import { Sparkles, Wand2, Check, Loader2, RefreshCw, ChevronDown, Music2 } from "lucide-react";
import { generateVisualizerPreset, getOllamaModels } from "../../../services/api";
import type { AIGeneratedPreset, OllamaModel } from "../../../services/api";
import type { VisualPreset } from "../visualPreset";

const TOOL_CAPABLE_MODELS = ["qwen3.5:9b", "qwen3.5:4b", "qwen3-vl:4b", "qwen3-vl:2b"];

interface TrackMeta {
  bpm?: number;
  energy?: number;
  duration_seconds?: number;
  genre?: string;
}

interface AIVisualizerPromptProps {
  onApplyPreset: (preset: VisualPreset) => void;
  trackMeta?: TrackMeta | null;
  trackName?: string;
}

export function AIVisualizerPrompt({ onApplyPreset, trackMeta, trackName }: AIVisualizerPromptProps) {
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("qwen3.5:9b");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedPreset, setGeneratedPreset] = useState<AIGeneratedPreset | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);

  useEffect(() => {
    getOllamaModels().then(data => {
      if (data?.length) {
        setModels(data);
        const toolModel = data.find(m => TOOL_CAPABLE_MODELS.includes(m.name));
        if (toolModel) setModel(toolModel.name);
      }
    }).catch(() => {});
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    setGeneratedPreset(null);
    try {
      const result = await generateVisualizerPreset(description, model, 0.7, trackMeta ?? undefined);
      setGeneratedPreset(result.preset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [description, model, trackMeta]);

  const handleApply = useCallback(() => {
    if (!generatedPreset) return;
    onApplyPreset(generatedPreset as unknown as VisualPreset);
    setGeneratedPreset(null);
    setDescription("");
  }, [generatedPreset, onApplyPreset]);

  const hasTrack = trackMeta && (trackMeta.bpm || trackMeta.energy !== undefined);

  const presetSummary = generatedPreset ? [
    { label: "Style", value: generatedPreset.visualizer?.style },
    { label: "Colors", value: `${generatedPreset.theme?.primary}, ${generatedPreset.theme?.secondary}` },
    { label: "Intensity", value: `${Math.round((generatedPreset.visualizer?.intensity ?? 0.5) * 100)}%` },
    { label: "Particles", value: generatedPreset.visualizer?.particleCount?.toString() },
    { label: "Lyrics", value: generatedPreset.lyrics?.style },
    { label: "Bass React", value: generatedPreset.audioReactivity?.bass },
  ].filter(v => v.value) : [];

  return (
    <div className="viz-ai-panel">
      <div className="viz-ai-header">
        <Sparkles size={16} />
        <span>AI Visualizer</span>
      </div>

      {hasTrack && (
        <div className="viz-ai-track-context">
          <Music2 size={12} />
          <span>{trackName || "Loaded track"}</span>
          {trackMeta.bpm && <span className="viz-ai-track-stat">{trackMeta.bpm} BPM</span>}
          {trackMeta.energy !== undefined && (
            <span className="viz-ai-track-stat">
              {trackMeta.energy > 0.6 ? "high" : trackMeta.energy < 0.35 ? "low" : "med"} energy
            </span>
          )}
        </div>
      )}

      <div className="viz-ai-input-row">
        <textarea
          className="viz-ai-input"
          placeholder="Describe your visual style... e.g. 'dark phonk with aggressive red glitch and screen shake on the beat'"
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
          rows={3}
        />
      </div>

      <div className="viz-ai-controls">
        <div className="viz-ai-model-wrap">
          <button
            className="viz-ai-model-btn"
            onClick={() => setShowModelPicker(!showModelPicker)}
            title="Select model"
          >
            <Wand2 size={12} />
            <span>{model}</span>
            <ChevronDown size={10} />
          </button>
          {showModelPicker && (
            <div className="viz-ai-model-dropdown">
              {models.length === 0 ? (
                <div className="viz-ai-model-empty">No models loaded</div>
              ) : (
                models.map(m => (
                  <button
                    key={m.name}
                    className={`viz-ai-model-option ${m.name === model ? "active" : ""}`}
                    onClick={() => { setModel(m.name); setShowModelPicker(false); }}
                  >
                    <span>{m.name}</span>
                    {TOOL_CAPABLE_MODELS.includes(m.name) && <span className="viz-ai-badge">tool</span>}
                    {m.benchmark && <span className="viz-ai-vram">score {Math.round(m.benchmark.score)}</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <button
          className="viz-ai-generate-btn"
          onClick={handleGenerate}
          disabled={loading || !description.trim()}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
          <span>{loading ? "Generating..." : "Generate"}</span>
        </button>
      </div>

      {error && <div className="viz-ai-error">{error}</div>}

      {generatedPreset && (
        <div className="viz-ai-preview">
          <div className="viz-ai-preview-header">
            <span className="viz-ai-preview-name">{generatedPreset.name}</span>
            <span className="viz-ai-preview-desc">{generatedPreset.description}</span>
          </div>
          <div className="viz-ai-summary">
            {presetSummary.map(s => (
              <div key={s.label} className="viz-ai-summary-item">
                <span className="viz-ai-summary-label">{s.label}</span>
                <span className="viz-ai-summary-value">{s.value}</span>
              </div>
            ))}
          </div>
          <div className="viz-ai-preview-actions">
            <button className="viz-ai-apply-btn" onClick={handleApply}>
              <Check size={14} />
              <span>Apply</span>
            </button>
            <button className="viz-ai-regen-btn" onClick={handleGenerate} disabled={loading}>
              <RefreshCw size={12} />
              <span>Regenerate</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
