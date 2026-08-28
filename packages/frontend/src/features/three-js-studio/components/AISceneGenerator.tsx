import { useState, useCallback, useEffect } from "react";
import { Sparkles, Play, Square, Copy, Check, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { useTrackMetadata, generatePromptVariations, type PromptVariation } from "../hooks/useTrackMetadata";
import { useOllamaStream } from "../hooks/useOllamaStream";
import { getGuidelinesPrompt } from "../services/sceneGuidelines";
import { getOllamaModels, type OllamaModel } from "../../../services/api";

interface AISceneGeneratorProps {
  selectedTrack: string | null;
  onApplyCode: (code: string) => void;
  storyboard?: string | null;
  autoGenerate?: boolean;
  storyboardScene?: number | null;
}

export function AISceneGenerator({ selectedTrack, onApplyCode, storyboard, autoGenerate, storyboardScene }: AISceneGeneratorProps) {
  const { metadata, loading: metaLoading } = useTrackMetadata(selectedTrack || null);
  const { generate, cancel, generating, output } = useOllamaStream();
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [variations, setVariations] = useState<PromptVariation[]>(() => generatePromptVariations({
    filename: "default", bpm: 120, duration: 180, sections: [], energyCurve: [], confidence: 0,
  }));
  const [activeVariation, setActiveVariation] = useState(0);
  const [copied, setCopied] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [storyboardContent, setStoryboardContent] = useState<string>("");

  // Fetch storyboard content if specified
  useEffect(() => {
    if (!storyboard) return;
    const storyboardPaths: Record<string, string> = {
      "take-the-crown": "/docs/STORYBOARD_TakeTheCrown.md",
      "still-i-rise": "/docs/STORYBOARD_StillIRise.md",
    };
    const path = storyboardPaths[storyboard];
    if (path) {
      fetch(path).then((r) => r.text()).then(setStoryboardContent).catch(() => {});
    }
  }, [storyboard]);

  // Auto-generate when requested
  useEffect(() => {
    if (autoGenerate && selectedModel && metadata && !generating) {
      handleGenerate();
    }
  }, [autoGenerate, selectedModel, metadata]);

  const loadModels = useCallback(async () => {
    try {
      const m = await getOllamaModels();
      setModels(m);
      if (m.length > 0 && !selectedModel) setSelectedModel(m[0].name);
    } catch { /* ignore */ }
  }, [selectedModel]);

  // Update variations when metadata changes
  useEffect(() => {
    if (metadata) {
      const vars = generatePromptVariations(metadata);
      setVariations(vars);
      setActiveVariation(0);
    }
  }, [metadata, generatePromptVariations]);

  const handleGenerate = async () => {
    if (!selectedModel || !metadata) return;

    // Build scene context from storyboard if available
    let sceneContext = "";
    if (storyboard && storyboardContent) {
      // Extract relevant scene if storyboardScene index specified
      const scenes = parseStoryboardScenes(storyboardContent);
      if (storyboardScene !== null && storyboardScene !== undefined && scenes[storyboardScene]) {
        const scene = scenes[storyboardScene];
        sceneContext = `
Storyboard Scene ${scene.seq} (${scene.section}):
- Time: ${scene.timecode} (${scene.duration})
- Lyric: ${scene.lyric}
- Visual: ${scene.visual}
- Technique: ${scene.technique}
`;
      } else {
        // Include full storyboard overview
        sceneContext = `
Storyboard Overview:
${scenes.map((s) => `- ${s.seq} ${s.section}: ${s.visual} (${s.timecode})`).join("\n")}
`;
      }
    }

    await generate(
      variations[activeVariation].prompt,
      selectedModel,
      `You are a 3D scene designer for music video visualization. Use the available tools to build a scene that matches the storyboard.

Available tools:
- scene_clear: Reset the scene
- scene_add_environment: Set mood (studio, city, void, sunset, neon, forest, space)
- scene_add_storyboard_element: Add visual elements (crown, orb, ring, spiral, mountain, city, tree, stage, equalizer, vinyl, pillar, bar, wave, galaxy, neuron, fractal, lightning, fire, rain, snow, light_rays, lens_flare, particle_field)
- scene_add_light: Add lights (point, spot, directional)
- scene_set_camera_for_shot: Set camera (wide, close_up, macro, overhead, dolly, tracking, handheld, low_angle, birds_eye)
- scene_add_text: Add 3D text for lyrics/titles
- scene_add_keyframe: Add animation keyframes (time, position, rotation, scale)
- scene_set_bloom: Set glow intensity (0-1.5)
- scene_set_duration: Set animation length
- scene_get_state: Return final scene JSON

Track info: ${metadata.bpm} BPM, ${metadata.duration}s duration
Sections: ${metadata.sections.map((s: any) => s.type).join(", ")}
${sceneContext}
Start with scene_clear, then build the scene step by step. End with scene_get_state.

${getGuidelinesPrompt()}`,
      (msg) => {
        if (msg.type === "done") {
          fetch("/api/integrations/ollama/scene-state")
            .then((r) => r.json())
            .then((state) => {
              if (state && state.objects) {
                onApplyCode(JSON.stringify(state));
              }
            })
            .catch(() => {});
        }
      },
      true, // useTools
    );
  };

  const parseStoryboardScenes = (md: string) => {
    const lines = md.split("\n");
    const result: any[] = [];
    let inOverview = false;
    for (const line of lines) {
      if (line.includes("## Overview Map")) { inOverview = true; continue; }
      if (inOverview && line.startsWith("#") && !line.includes("Overview")) { inOverview = false; continue; }
      if (!inOverview || !line.startsWith("|")) continue;
      if (line.includes("SEQ") || line.includes("---")) continue;
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 7) {
        result.push({ seq: cells[0], section: cells[1], timecode: cells[2], duration: cells[3], lyric: cells[4], visual: cells[5], technique: cells[6] });
      }
    }
    return result;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-purple-500/30 rounded-lg bg-[#0e0e16] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-purple-900/20 hover:bg-purple-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-purple-400" />
          <span className="text-sm font-semibold text-purple-300">AI Scene Generator</span>
          {metadata && <span className="text-[10px] text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded">Track loaded</span>}
          <span className="text-[10px] text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded" title="Scene design guidelines active">Guidelines</span>
        </div>
        {panelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {panelOpen && (
        <div className="p-3 space-y-3">
          {/* Track Metadata */}
          {metaLoading && <div className="text-xs text-gray-400">Loading track metadata...</div>}
          {metadata && (
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div className="bg-gray-800/50 rounded p-1.5 text-center">
                <div className="text-gray-500">BPM</div>
                <div className="text-white font-mono font-bold">{metadata.bpm}</div>
              </div>
              <div className="bg-gray-800/50 rounded p-1.5 text-center">
                <div className="text-gray-500">Duration</div>
                <div className="text-white font-mono font-bold">{Math.round(metadata.duration)}s</div>
              </div>
              <div className="bg-gray-800/50 rounded p-1.5 text-center">
                <div className="text-gray-500">Sections</div>
                <div className="text-white font-mono font-bold">{metadata.sections.length}</div>
              </div>
            </div>
          )}

          {/* Model Selection */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 block">Model</label>
            <div className="flex gap-1.5">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                onClick={loadModels}
              >
                {models.length === 0 && <option value="">Click to load models...</option>}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>{m.name} ({m.size})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Prompt Variations */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 block">Prompt Strategy</label>
            <div className="grid grid-cols-2 gap-1">
              {variations.map((v, i) => (
                <button
                  key={v.id}
                  onClick={() => setActiveVariation(i)}
                  className={`px-2 py-1.5 rounded text-[10px] text-left transition-colors ${
                    activeVariation === i
                      ? "bg-purple-600/30 border border-purple-500/50 text-white"
                      : "bg-gray-800 hover:bg-gray-700 border border-transparent text-gray-300"
                  }`}
                >
                  <div className="font-medium">{v.name}</div>
                  <div className="text-gray-500 text-[9px]">{v.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Preview Prompt */}
          <details className="text-[10px]">
            <summary className="text-gray-500 cursor-pointer hover:text-gray-300">Preview prompt...</summary>
            <pre className="mt-1 bg-gray-900 rounded p-2 text-gray-400 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {variations[activeVariation]?.prompt}
            </pre>
          </details>

          {/* Generate Button */}
          <button
            onClick={generating ? cancel : handleGenerate}
            disabled={!selectedModel || !metadata}
            className={`w-full py-2 rounded font-medium text-xs flex items-center justify-center gap-2 transition-colors ${
              generating
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
          >
            {generating ? <><Square size={12} /> Stop</> : <><Play size={12} /> Generate Scene</>}
          </button>

          {/* Output */}
          {output && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">Generated Code</span>
                <div className="flex gap-1">
                  <button onClick={handleCopy} className="p-1 text-gray-400 hover:text-white" title="Copy">
                    {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
              <pre className="bg-gray-900 rounded p-2 text-[10px] text-green-300 max-h-48 overflow-y-auto font-mono whitespace-pre-wrap">
                {output}
              </pre>
              <button
                onClick={() => onApplyCode(output)}
                className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded text-xs font-medium flex items-center justify-center gap-1.5"
              >
                <Zap size={12} /> Apply to Scene
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
