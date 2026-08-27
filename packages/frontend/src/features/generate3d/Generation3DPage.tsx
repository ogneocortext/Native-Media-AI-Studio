import { useState, useCallback, useEffect } from "react";
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
  Clock,
  HardDrive,
  RefreshCw,
    History,
  FileBox,
  Triangle,
} from "lucide-react";
import {
  generate3D,
  get3DStatus,
} from "../../services/api";
import { ModelPreview } from "./ModelPreview";

const PROMPT_EXAMPLES = [
  { label: "Robot", prompt: "a futuristic robot, chrome metallic, highly detailed, standing pose", tag: "character" },
  { label: "Neon Mic", prompt: "a neon microphone, cyberpunk style, glowing accents, floating", tag: "prop" },
  { label: "DJ Console", prompt: "a DJ console, modern minimalist, LED indicators, top-down view", tag: "prop" },
  { label: "Stage", prompt: "concert stage platform, LED walls, fog, cinematic volumetric lighting", tag: "environment" },
];

const PIPELINE_STEPS = [
  { n: 1, t: "Text Prompt", c: "text-sky-400" },
  { n: 2, t: "ComfyUI (Hunyuan3D)", c: "text-violet-400 font-bold" },
  { n: 3, t: "GLB Output", c: "text-emerald-400" },
  { n: 4, t: "Blender Refine", c: "text-orange-400" },
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
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRenderGuide, setShowRenderGuide] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [generatedList, setGeneratedList] = useState<Array<{ filename: string; path: string; servable_url?: string | null; size_bytes: number; modified: number }>>([]);
    const [historyLoading, setHistoryLoading] = useState(false);

  // Advanced generation params — wired to the Advanced sliders and sent to backend
  const [vizParams, setVizParams] = useState({
    cfg: 7.0,
    color: "#00ffff",
    metalness: 0.6,
    roughness: 0.4,
    scale: 1.0,
    resolution: 256,
  });

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await get3DStatus();
      setStatus3d(data);
    } catch {
      setStatus3d({ available: false, error: "Backend not reachable" });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      // Use relative paths so requests go through the Vite dev proxy
      // (same-origin). The full backend URL via getApiBase() hits CORS in
      // dev because the backend on 127.0.0.1:8000 doesn't whitelist the
      // Vite origin on localhost:5173+.
      const res = await fetch(`/api/health/3d/models`);
      if (res.ok) {
        const models = await res.json();
        if (Array.isArray(models) && models.length > 0) {
          const mapped = models
            .slice(0, 10)
            .map((m: { filename: string; path: string; size_bytes: number; servable_url?: string | null; modified?: number }) => ({
              filename: m.filename,
              path: m.path,
              servable_url: m.servable_url ?? null,
              size_bytes: m.size_bytes,
              modified: m.modified ?? 0,
            }));
          setGeneratedList(mapped);
          return;
        }
      }
      // Fallback: scan the generic outputs route for any .glb files.
      const res2 = await fetch(`/api/outputs`);
      if (res2.ok) {
        const d2 = await res2.json();
        const outs = d2.outputs || [];
        setGeneratedList(
          outs.filter((f: { filename: string }) => f.filename.endsWith(".glb")).slice(0, 10)
        );
      }
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Auto-load status and history on mount
  useEffect(() => {
    loadStatus();
    loadHistory();
  }, [loadStatus, loadHistory]);

  // Elapsed timer during generation
  useEffect(() => {
    if (!generating) {
      setElapsed(0);
      return;
    }
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, [generating]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (prompt.length > 500) {
      setError("Prompt too long (max 500 chars). Keep under 75 words.");
      return;
    }
    setGenerating(true);
    setError(null);
    setResult(null);
    const start = Date.now();
    try {
      const data = await generate3D({ prompt, model, steps, cfg: vizParams.cfg, params: vizParams });
      setResult(data);
      if ((data as { success?: boolean }).success === false) {
        setError((data as { error?: string }).error || "Generation failed — check ComfyUI and VRAM");
      }
      loadStatus();
      loadHistory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("timeout") || msg.includes("504")) {
        setError("Generation timed out — Hunyuan3D-2mini takes 2-4 min on 8GB. Check Queue or try fewer steps.");
      } else if (msg.includes("VRAM") || msg.includes("memory")) {
        setError("VRAM full — close ComfyUI/Blender, reduce steps to 10, or use 2mini. See /health.");
      } else {
        setError(msg || "Generation failed");
      }
    } finally {
      setGenerating(false);
      const dur = Math.round((Date.now() - start) / 1000);
      if (dur > 5) console.log(`3D generation took ${dur}s`);
    }
  };

  const models = [
    { id: "hunyuan3d-2mini", name: "Hunyuan3D-2mini", vram: "5GB", time: "3-5 min", desc: "0.6B • Installed & 8GB-safe", color: "text-emerald-400", available: true },
    { id: "hunyuan3d-2", name: "Hunyuan3D-2", vram: "9GB+", time: "6-8 min", desc: "1.2B • Not installed on this system", color: "text-amber-400", available: false },
  ];
  const selectedModel = models.find((m) => m.id === model) ?? models[0];
  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  const isAvailable = (status3d.available as boolean) ?? false;
  const comfyRunning = (status3d.comfyui_running as boolean) ?? false;
  const estimatedSec = steps <= 10 ? 90 : steps <= 15 ? 150 : steps <= 20 ? 210 : 300;

  // Derive a servable URL for the freshly generated model (backend copies it to output/generated_3d).
  const resultModelPath = (result as { model_path?: string } | null)?.model_path;
  const glbFilename = resultModelPath ? String(resultModelPath).split(/[\\/]/).pop() : null;
  // Relative URL — goes through the Vite dev proxy (same-origin) so we avoid
  // the CORS block the backend imposes on cross-origin requests in dev.
  const glbUrl = glbFilename && (result as { success?: boolean } | null)?.success
    ? `/output/generated_3d/${glbFilename}`
    : null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header with live status */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Box size={24} className="text-purple-400" />
            3D Model Generation
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">8GB VRAM-safe</span>
                                    <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-gray-500/15 border border-gray-500/30 text-gray-300">Backend</span>
            {comfyRunning ? (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Ready</span>
            ) : (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 flex items-center gap-1"><Triangle size={10} /> ComfyUI Offline</span>
            )}
          </h1>
          <p className="text-gray-400 mt-1">
            Generate 3D models from text prompts using Hunyuan3D. Fits your 8GB GPU budget.
          </p>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><HardDrive size={12} /> {String(status3d.model_path as string || "hunyuan3d-2mini")}</span>
            <span className="flex items-center gap-1"><FileBox size={12} /> {String((status3d.generated_count as number) ?? 0)} generated</span>
            {statusLoading && <Loader2 size={12} className="animate-spin" />}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadStatus}
            disabled={statusLoading}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm text-gray-300 flex items-center gap-2"
            title="Refresh status"
          >
            <RefreshCw size={14} className={statusLoading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            onClick={() => navigate("/music-video-wizard")}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2"
          >
            <Wand2 size={14} /> Open Wizard <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Model Selection - Cards */}
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <label className="text-sm font-medium text-gray-300 block mb-3 flex items-center gap-2"><Cpu size={14} /> Model & Quality</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => m.available && setModel(m.id)}
                  disabled={!m.available}
                  title={m.available ? m.desc : "Hunyuan3D-2 full is not installed — use Hunyuan3D-2mini"}
                  className={`text-left p-3 rounded-xl border-2 transition-all ${
                    model === m.id ? "bg-violet-500/10 border-violet-500" : m.available ? "bg-gray-900 border-gray-700 hover:border-gray-600" : "bg-gray-900 border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${model === m.id ? "text-white" : "text-gray-300"}`}>{m.name}</span>
                    {model === m.id && <CheckCircle size={14} className="text-violet-400" />}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{m.desc}</p>
                  <div className="flex gap-2 mt-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${m.id === "hunyuan3d-2mini" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>{m.vram}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 flex items-center gap-1"><Clock size={10} /> {m.time}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <label className="text-xs text-gray-400 flex items-center justify-between">
                <span className="flex items-center gap-1"><Sliders size={12} /> Steps: {steps} <span className="text-gray-500">({steps <= 10 ? "fast" : steps <= 18 ? "balanced" : "quality"})</span></span>
                <span className="text-gray-500">~{Math.round(estimatedSec / 60)} min</span>
              </label>
              <input
                type="range"
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                min={5}
                max={50}
                step={1}
                className="w-full mt-1 accent-violet-500"
              />
              <div className="flex justify-between text-[10px] text-gray-500">
                <span>5 (fast)</span><span>15 (balanced)</span><span>50 (max)</span>
              </div>
                        </div>

            {/* Advanced Params — only useful when ComfyUI is connected */}
            <div className={`mt-3 space-y-3 ${!comfyRunning ? "opacity-50 pointer-events-none" : ""}`}>
              <details className="group">
                <summary className="text-xs text-gray-400 flex items-center justify-between cursor-pointer hover:text-gray-300">
                  <span className="flex items-center gap-1"><Sliders size={12} /> Advanced Generation</span>
                  <span className="text-gray-500 group-open:rotate-90 transition-transform">▸</span>
                </summary>
                <div className="mt-2 space-y-3 text-xs">
                  <div>
                    <label className="flex justify-between text-gray-400">
                      <span>CFG Guidance: {vizParams.cfg.toFixed(1)}</span><span className="text-gray-500">1.0–20.0</span>
                    </label>
                    <input
                      type="range" value={vizParams.cfg} min={1.0} max={20.0} step={0.1}
                      onChange={(e) => setVizParams({...vizParams, cfg: Number(e.target.value)})}
                      className="w-full mt-1 accent-violet-500"
                    />
                  </div>
                  <div>
                    <label className="flex justify-between text-gray-400">
                      <span>Color: {vizParams.color}</span>
                    </label>
                    <input
                      type="color" value={vizParams.color}
                      onChange={(e) => setVizParams({...vizParams, color: e.target.value})}
                      className="w-full h-6 mt-1 rounded cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="flex justify-between text-gray-400">
                      <span>Metalness: {vizParams.metalness.toFixed(1)}</span><span className="text-gray-500">0–1</span>
                    </label>
                    <input
                      type="range" value={vizParams.metalness} min={0} max={1} step={0.1}
                      onChange={(e) => setVizParams({...vizParams, metalness: Number(e.target.value)})}
                      className="w-full mt-1 accent-violet-500"
                    />
                  </div>
                  <div>
                    <label className="flex justify-between text-gray-400">
                      <span>Roughness: {vizParams.roughness.toFixed(1)}</span><span className="text-gray-500">0–1</span>
                    </label>
                    <input
                      type="range" value={vizParams.roughness} min={0} max={1} step={0.1}
                      onChange={(e) => setVizParams({...vizParams, roughness: Number(e.target.value)})}
                      className="w-full mt-1 accent-violet-500"
                    />
                  </div>
                  <div>
                    <label className="flex justify-between text-gray-400">
                      <span>Scale: {vizParams.scale.toFixed(1)}</span><span className="text-gray-500">0.1–2.0</span>
                    </label>
                    <input
                      type="range" value={vizParams.scale} min={0.1} max={2.0} step={0.1}
                      onChange={(e) => setVizParams({...vizParams, scale: Number(e.target.value)})}
                      className="w-full mt-1 accent-violet-500"
                    />
                  </div>
                  <div>
                    <label className="flex justify-between text-gray-400">
                      <span>Resolution: {vizParams.resolution}</span><span className="text-gray-500">128–512</span>
                    </label>
                    <input
                      type="range" value={vizParams.resolution} min={128} max={512} step={64}
                      onChange={(e) => setVizParams({...vizParams, resolution: Number(e.target.value)})}
                      className="w-full mt-1 accent-violet-500"
                    />
                  </div>
                  {!comfyRunning && (
                    <p className="text-amber-300 text-[10px] flex items-center gap-1">
                      <Triangle size={10} /> Advanced params require ComfyUI running
                    </p>
                  )}
                </div>
              </details>
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-300">Prompt</label>
              <span className={`text-xs ${wordCount > 75 ? "text-red-400" : wordCount > 60 ? "text-amber-400" : "text-gray-500"}`}>{wordCount}/75 words • {prompt.length}/500 chars</span>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className={`w-full px-3 py-2 bg-gray-900 border rounded-lg text-white resize-none focus:outline-none ${wordCount > 75 ? "border-red-500 focus:border-red-500" : "border-gray-700 focus:border-violet-500"}`}
              rows={3}
              placeholder="Describe the 3D model you want to generate..."
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleGenerate(); }}
              aria-label="3D prompt"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Format: <code className="text-violet-300">[object], [material], [style], [orientation]</code> • <span className="text-gray-400">Ctrl+Enter to generate</span>
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
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

          {/* Generate Button with progress */}
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim() || wordCount > 75 || !comfyRunning}
            className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-400 text-white rounded-xl font-medium flex items-center justify-center gap-2"
          >
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
            {generating ? `Generating... ${elapsed}s / ~${estimatedSec}s` : `Generate 3D Model • ${selectedModel.vram} • ~${Math.round(estimatedSec / 60)} min`}
          </button>
          {generating && (
            <div className="bg-gray-800 rounded-xl p-3 border border-violet-500/20">
              <div className="flex items-center gap-2 text-sm text-violet-300">
                <Loader2 size={14} className="animate-spin" />
                Generating on {selectedModel.name} • {elapsed}s elapsed • ~{Math.max(0, estimatedSec - elapsed)}s left
              </div>
              <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${Math.min(95, (elapsed / estimatedSec) * 100)}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">VRAM will offload Ollama, then reload. Do not close tab.</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-900/20 border border-red-700 rounded-xl flex items-start gap-3 text-red-300">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">{error}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={handleGenerate} className="text-xs px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-white">Retry</button>
                  <button onClick={() => setError(null)} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-white">Dismiss</button>
                </div>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-gray-800 rounded-xl p-4 border border-green-500/20">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={16} className="text-green-400" />
                <span className="text-white font-medium">Generation Result</span>
                {(result as { success?: boolean }).success ? (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">Success</span>
                ) : (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">Failed</span>
                )}
              </div>
              {(result as { model_path?: string }).model_path ? (
                <div className="space-y-3">
                  <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                    <p className="text-xs text-gray-400">Model</p>
                    <p className="text-sm text-white font-mono truncate" title={String((result as { model_path?: string }).model_path)}>{String((result as { model_path?: string }).model_path).split(/[\\/]/).pop()}</p>
                    <p className="text-xs text-gray-500 mt-1">{String((result as { model_path?: string }).model_path)}</p>
                  </div>
{glbUrl && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-400 flex items-center gap-1"><Box size={12} className="text-violet-400" /> Live 3D preview</p>
                      <ModelPreview url={glbUrl} />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <a
                      href={`/output/generated_3d/${String((result as { model_path?: string }).model_path).split(/[\\/]/).pop()}`}
                      download
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-white text-sm flex items-center gap-2"
                    >
                      <Download size={14} />
                      Download .glb
                    </a>
                    <button
                      onClick={() => navigate("/music-video-wizard")}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-sm flex items-center gap-2"
                    >
                      Use in Music Video <ArrowRight size={14} />
                    </button>
                  </div>
                  <details className="text-xs">
                    <summary className="text-gray-400 cursor-pointer">Raw JSON</summary>
                    <pre className="bg-gray-900 rounded-lg p-3 text-xs text-gray-400 overflow-auto max-h-48 mt-2">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : (
                <>
                  <pre className="bg-gray-900 rounded-lg p-3 text-xs text-gray-400 overflow-auto max-h-48">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => navigate("/music-video-wizard")}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-sm flex items-center gap-2"
                    >
                      Use in Music Video <ArrowRight size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* 3D Service Status */}
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-medium flex items-center gap-2">
                <Sparkles size={16} className={status3d.available ? "text-emerald-400" : "text-red-400"} />
                Service Status
              </h3>
              <button onClick={loadStatus} disabled={statusLoading} className="p-1 hover:bg-gray-700 rounded">
                <RefreshCw size={14} className={statusLoading ? "animate-spin text-gray-400" : "text-gray-400"} />
              </button>
            </div>
            {statusLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" /> Checking...</div>
            ) : Object.keys(status3d).length > 0 ? (
              <div className="space-y-2">
                <div className={`flex items-center justify-between p-2 rounded-lg border ${isAvailable && comfyRunning ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                  <span className="text-sm text-gray-300">Service</span>
                  <span className={`text-sm font-medium ${isAvailable && comfyRunning ? "text-emerald-400" : "text-red-400"}`}>{isAvailable && comfyRunning ? "● Ready" : "● Offline"}</span>
                </div>
                {Object.entries(status3d).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between p-2 bg-gray-900 rounded-lg">
                    <span className="text-gray-400 text-xs capitalize">{key.replace(/_/g, " ")}</span>
                    <span className={`text-xs truncate max-w-[150px] ${typeof value === "boolean" ? (value ? "text-emerald-400" : "text-red-400") : "text-white"}`} title={String(value)}>
                      {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value).split(/[\\/]/).pop() || String(value)}
                    </span>
                  </div>
                ))}
                {!isAvailable && <p className="text-xs text-amber-400 p-2 bg-amber-500/10 rounded">Check ComfyUI at {String(status3d.model_path as string || "D:\\ComfyUI")} and model exists</p>}
              </div>
            ) : (
              <button
                onClick={loadStatus}
                className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300"
              >
                Check Status
              </button>
            )}
          </div>

          {/* Generated History */}
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-medium flex items-center gap-2"><History size={16} /> Recent Models</h3>
              <button onClick={loadHistory} disabled={historyLoading} className="p-1 hover:bg-gray-700 rounded">
                <RefreshCw size={14} className={historyLoading ? "animate-spin" : ""} />
              </button>
            </div>
            {historyLoading ? (
              <div className="text-xs text-gray-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading...</div>
            ) : generatedList.length > 0 ? (
              <div className="divide-y divide-gray-800 max-h-72 overflow-auto rounded-lg border border-gray-800 bg-gray-900/30">
                {generatedList.map((f) => {
                  // Show a friendly date label from the modified timestamp
                  // (seconds since epoch) so the user can see how recent
                  // each model is without reading the full filename.
                  const ageMs = f.modified ? Date.now() - f.modified * 1000 : 0;
                  const ageLabel = ageMs < 60_000
                    ? "just now"
                    : ageMs < 3_600_000
                      ? `${Math.round(ageMs / 60_000)}m ago`
                      : ageMs < 86_400_000
                        ? `${Math.round(ageMs / 3_600_000)}h ago`
                        : `${Math.round(ageMs / 86_400_000)}d ago`;
                  return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => {
                      // Populate the result/preview pane with the chosen model
                      // so the user can rotate it without re-running generation.
                      setResult({ success: true, model_path: f.path, filename: f.filename });
                    }}
                    className="w-full text-left flex items-center gap-2 px-2.5 py-2 hover:bg-gray-800/60 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white truncate font-mono" title={f.filename}>{f.filename}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{ageLabel}</div>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0 tabular-nums">{(f.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                    <a
                      href={f.servable_url ?? `/output/generated_3d/${f.filename}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-gray-500 hover:text-violet-300 shrink-0"
                      title="Download .glb"
                    >
                      <Download size={12} />
                    </a>
                  </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No models yet. Generate one to see it here.</p>
            )}
          </div>

          {/* Rendering Guide */}
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
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
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
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
