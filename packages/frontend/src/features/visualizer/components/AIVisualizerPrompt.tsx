import { useState, useCallback, useEffect } from "react";
import { Sparkles, Wand2, Check, Loader2, RefreshCw, ChevronDown, Music2, Shield, Eye, AlertCircle, Zap, Palette, Code2 } from "lucide-react";
import { generateVisualizerPreset, getOllamaModels, getBenchmarkResults } from "../../../services/api";
import type { AIGeneratedPreset, OllamaModel, OllamaBenchmarkResult } from "../../../services/api";
import type { VisualPreset } from "../visualPreset";
import { AIPresetGallery } from "./AIPresetGallery";

const TOOL_CAPABLE_MODELS = [
  "gemma4:e2b-it-qat",
  "gemma4-vision-optimized:latest",
  "qwen3.5:9b",
  "qwen3.5:4b",
];

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

export function AIVisualizerPrompt({
  onApplyPreset,
  trackMeta,
  trackName,
}: AIVisualizerPromptProps) {
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("gemma4:e2b-it-qat");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [benchmarks, setBenchmarks] = useState<Record<string, OllamaBenchmarkResult>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedPreset, setGeneratedPreset] = useState<AIGeneratedPreset | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    getOllamaModels(true)
      .then(async (data) => {
        if (data?.length) {
          setModels(data);
          
          // Fetch benchmarks in parallel
          let benchMap: Record<string, OllamaBenchmarkResult> = {};
          try {
            const benchData = await getBenchmarkResults();
            benchMap = benchData.results || {};
            setBenchmarks(benchMap);
          } catch {
            /* no benchmarks yet */
          }

          // Sort by benchmark score desc, then latency asc — best first
          // Verified models first
          const sorted = [...data].sort((a, b) => {
            if (a.verified !== b.verified) return a.verified ? -1 : 1;
            const sa = a.benchmark?.score ?? benchMap[a.name]?.validation?.score ?? -1;
            const sb = b.benchmark?.score ?? benchMap[b.name]?.validation?.score ?? -1;
            if (sa !== sb) return sb - sa;
            const la = a.benchmark?.latency_ms ?? benchMap[a.name]?.latency_ms ?? 999999;
            const lb = b.benchmark?.latency_ms ?? benchMap[b.name]?.latency_ms ?? 999999;
            return la - lb;
          });
          setModels(sorted);

          // Prefer verified model with visualizer support
          const visualizerModel = sorted.find((m) => m.verified_features?.includes("visualizer"));
          const toolModel = sorted.find((m) => TOOL_CAPABLE_MODELS.includes(m.name));
          if (visualizerModel) setModel(visualizerModel.name);
          else if (toolModel) setModel(toolModel.name);
          else if (sorted[0]) setModel(sorted[0].name);
        }
      })
      .catch(() => {});
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    setGeneratedPreset(null);
    try {
      const result = await generateVisualizerPreset(
        description,
        model,
        0.7,
        trackMeta ?? undefined,
      );
      setGeneratedPreset(result.preset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [description, model, trackMeta]);

  const handleApply = useCallback(() => {
    console.log("[AIVisualizerPrompt] handleApply called, generatedPreset:", !!generatedPreset);
    if (!generatedPreset) return;
    onApplyPreset(generatedPreset as unknown as VisualPreset);
    setRefreshKey((k) => k + 1);
    setGeneratedPreset(null);
    setDescription("");
  }, [generatedPreset, onApplyPreset]);

  const hasTrack = trackMeta && (trackMeta.bpm || trackMeta.energy !== undefined);

  const presetSummary = generatedPreset
    ? [
        { label: "Style", value: generatedPreset.visualizer?.style },
        {
          label: "Colors",
          value: `${generatedPreset.theme?.primary}, ${generatedPreset.theme?.secondary}`,
        },
        {
          label: "Intensity",
          value: `${Math.round((generatedPreset.visualizer?.intensity ?? 0.5) * 100)}%`,
        },
        { label: "Particles", value: generatedPreset.visualizer?.particleCount?.toString() },
        { label: "Lyrics", value: generatedPreset.lyrics?.style },
        { label: "Bass React", value: generatedPreset.audioReactivity?.bass },
      ].filter((v) => v.value)
    : [];

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
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
          }}
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
                <div className="viz-ai-model-empty">No verified models loaded</div>
              ) : (
                models.map((m) => {
                  const bench = benchmarks[m.name];
                  const score = bench?.validation?.score ?? m.benchmark?.score ?? null;
                  const latency = bench?.latency_ms ?? m.benchmark?.latency_ms ?? null;
                  const success = bench?.success ?? m.benchmark?.success ?? null;
                  let badge = "";
                  if (score !== null && score >= 0) {
                    const s = Math.round(score);
                    const ok = success === false ? "✗" : s >= 70 ? "✓" : s >= 40 ? "~" : "✗";
                    badge = ` [${ok} ${s}/100${latency ? ` ${(latency / 1000).toFixed(1)}s` : ""}]`;
                  } else if (score === null) {
                    badge = " [—]";
                  }
                  const isBest = models[0]?.name === m.name && score !== null && score >= 60;
                  return (
                    <button
                      key={m.name}
                      className={`viz-ai-model-option ${m.name === model ? "active" : ""}`}
                      onClick={() => {
                        setModel(m.name);
                        setShowModelPicker(false);
                      }}
                    >
                      <span>{m.name}{m.verified ? " ✅" : " ⚠️"}{badge}</span>
                      {isBest && <span className="viz-ai-badge" style={{color:"#fbbf24"}} title="Best">★ Best</span>}
                      {m.verified && <span className="viz-ai-badge" title="Verified"><Shield /></span>}
                      {!m.verified && m.broken_reason && <span className="viz-ai-badge" title={m.broken_reason}><AlertCircle /></span>}
                      {m.verified_features?.includes("visualizer") && <span className="viz-ai-badge" title="Visualizer"><Palette /></span>}
                      {m.verified_features?.includes("blender") && <span className="viz-ai-badge" title="Blender"><Code2 /></span>}
                      {m.supportsVision && <span className="viz-ai-badge" title="Vision"><Eye /></span>}
                      {m.supportsTools && <span className="viz-ai-badge" title="Tools"><Zap /></span>}
                      {m.performance?.vision_latency_sec && (
                        <span className="viz-ai-vram">👁 ~{m.performance.vision_latency_sec}s</span>
                      )}
                    </button>
                  );
                })
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
            {presetSummary.map((s) => (
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

      <div className="viz-ai-gallery-wrap">
        <AIPresetGallery onApplyPreset={onApplyPreset} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
