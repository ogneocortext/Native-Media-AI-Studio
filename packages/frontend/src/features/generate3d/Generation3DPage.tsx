import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Wand2,
  Loader2,
  AlertCircle,
  CheckCircle,
  Sparkles,
  Download,
  Cpu,
  Zap,
  ArrowRight,
  Eye,
  Sliders,
} from "lucide-react";
import {
  generate3D,
  get3DStatus,
} from "../../services/api";

const PROMPT_EXAMPLES = [
  { label: "Robot", prompt: "a futuristic robot, chrome metallic, highly detailed, standing pose", tag: "character" },
  { label: "Neon Mic", prompt: "a neon microphone, cyberpunk style, glowing accents, floating", tag: "prop" },
  { label: "DJ Console", prompt: "a DJ console, modern minimalist, LED indicators, top-down view", tag: "prop" },
  { label: "Stage", prompt: "concert stage platform, LED walls, fog, cinematic volumetric lighting", tag: "environment" },
];

const PIPELINE_STEPS = [
  { n: 1, t: "Upload Audio", c: "text-sky-400" },
  { n: 2, t: "Analyze Beats", c: "text-sky-400" },
  { n: 3, t: "Generate 3D Assets", c: "text-violet-400 font-bold" },
  { n: 4, t: "Blender Scene", c: "text-orange-400" },
  { n: 5, t: "Sync & Animate", c: "text-amber-400" },
  { n: 6, t: "Render & Export", c: "text-emerald-400" },
];

export function Generation3DPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("a futuristic robot, chrome metallic, highly detailed, standing pose");
  const [model, setModel] = useState("hunyuan3d-2mini");
  const [steps, setSteps] = useState(15);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [status3d, setStatus3d] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [showRenderGuide, setShowRenderGuide] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await get3DStatus();
      setStatus3d(data);
    } catch {
      // Backend may not be running
    }
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const data = await generate3D({ prompt, model, steps });
      setResult(data);
      loadStatus();
    } catch (err: any) {
      setError(err.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const models = [
    { id: "hunyuan3d-2mini", name: "Hunyuan3D-2mini (0.6B, fast)" },
    { id: "hunyuan3d-2", name: "Hunyuan3D-2 (full)" },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Box size={24} className="text-purple-400" />
            3D Model Generation
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">8GB VRAM-safe</span>
          </h1>
          <p className="text-gray-400 mt-1">
            Generate 3D models from text prompts using Hunyuan3D. Fits your 8GB GPU budget.
          </p>
        </div>
        <button
          onClick={() => navigate("/music-video-wizard")}
          className="shrink-0 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2"
        >
          <Wand2 size={14} /> Open Wizard <ArrowRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Model Selection */}
          <div className="bg-gray-800 rounded-lg p-4">
            <label className="text-sm font-medium text-gray-300 block mb-2">Model</label>
            <div className="flex gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-purple-500 focus:outline-none"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Steps</label>
                <input
                  type="number"
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  min={5}
                  max={50}
                  className="w-16 px-2 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-center text-sm"
                />
              </div>
            </div>
          </div>

          {/* Prompt */}
          <div className="bg-gray-800 rounded-lg p-4">
            <label className="text-sm font-medium text-gray-300 block mb-2">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:border-purple-500 focus:outline-none"
              rows={3}
              placeholder="Describe the 3D model you want to generate..."
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleGenerate(); }}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Format: <code className="text-violet-300">[object], [material], [style], [orientation]</code> • Keep {"<"}75 words
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PROMPT_EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => setPrompt(ex.prompt)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    prompt === ex.prompt
                      ? "bg-violet-600 border-violet-500 text-white"
                      : "bg-gray-900 border-gray-700 text-gray-400 hover:border-violet-500/30 hover:text-gray-200"
                  }`}
                >
                  + {ex.label} <span className="opacity-50">• {ex.tag}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
          >
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
            {generating ? "Generating 3D Model..." : "Generate 3D Model"}
          </button>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={16} className="text-green-400" />
                <span className="text-white font-medium">Generation Result</span>
              </div>
              <pre className="bg-gray-900 rounded-lg p-3 text-xs text-gray-400 overflow-auto max-h-48">
                {JSON.stringify(result, null, 2)}
              </pre>
              <div className="flex gap-2 mt-3">
                {result.model_path != null && (
                  <button className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-white text-sm flex items-center gap-2">
                    <Download size={14} />
                    Download Model
                  </button>
                )}
                <button
                  onClick={() => navigate("/music-video-wizard")}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-sm flex items-center gap-2"
                >
                  Use in Music Video <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* 3D Service Status */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              <Sparkles size={16} />
              Service Status
            </h3>
            {Object.keys(status3d).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(status3d).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between p-2 bg-gray-700/30 rounded">
                    <span className="text-gray-400 text-sm capitalize">{key.replace(/_/g, " ")}</span>
                    <span className={`text-sm ${typeof value === "boolean" ? (value ? "text-green-400" : "text-red-400") : "text-white"}`}>
                      {String(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <button
                onClick={loadStatus}
                className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
              >
                Check Status
              </button>
            )}
          </div>

          {/* Rendering Guide */}
          <div className="bg-gray-800 rounded-lg p-4">
            <button
              onClick={() => setShowRenderGuide(!showRenderGuide)}
              className="w-full text-white font-medium mb-3 flex items-center gap-2 text-left"
            >
              <Eye size={16} className="text-sky-400" />
              Rendering Guide (8GB)
              <span className="ml-auto text-xs text-gray-500">{showRenderGuide ? "▲" : "▼"}</span>
            </button>
            {showRenderGuide && (
              <div className="space-y-3 text-xs">
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-700">
                  <p className="font-bold text-white flex items-center gap-1"><Zap size={12} className="text-amber-400" /> EEVEE Next (recommended)</p>
                  <p className="text-gray-400 mt-1">Real-time 1080p ≈2s/frame • 240f ≈8 min. Enable ray-traced shadows/GI only when needed.</p>
                  <p className="text-violet-300 mt-1">Use for: previz, stylized, fast iteration.</p>
                </div>
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-700">
                  <p className="font-bold text-white flex items-center gap-1"><Sliders size={12} className="text-violet-400" /> Cycles CUDA (quality)</p>
                  <p className="text-gray-400 mt-1">128 samples ≈30s/frame • 240f ≈120 min. GPU Compute, denoise + OpenImageDenoise.</p>
                  <p className="text-violet-300 mt-1">Use for: finals, photoreal.</p>
                </div>
              </div>
            )}
          </div>

          {/* Pipeline */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              <Cpu size={16} className="text-orange-400" />
              Pipeline
            </h3>
            <div className="space-y-1.5">
              {PIPELINE_STEPS.map((s) => (
                <div key={s.n} className={`flex items-center gap-2 p-2 rounded-lg ${s.n === 3 ? "bg-violet-500/10 border border-violet-500/30" : "bg-gray-900/50"}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.n === 3 ? "bg-violet-600 text-white" : "bg-gray-700 text-gray-400"}`}>{s.n}</span>
                  <span className={`text-xs ${s.c}`}>{s.t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
