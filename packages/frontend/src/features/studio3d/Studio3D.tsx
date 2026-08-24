import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Cpu,
  Box,
  Layers,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Loader2,
  Sparkles,
  Wand2,
  Lightbulb,
  BookOpen,
  Eye,
  ArrowRight,
  Image as ImageIcon,
  Video,
  Sliders,
  Target,
  Zap,
} from "lucide-react";

interface GpuStats {
  available: boolean;
  name?: string;
  memory_used_mb?: number;
  memory_free_mb?: number;
  memory_total_mb?: number;
  memory_percent?: number;
  gpu_utilization?: number;
  temperature_c?: number;
  processes?: Array<{ pid: number; name: string; used_mb: number | null; kind: string }>;
}
interface Gen3DStatus { available: boolean; model_exists: boolean; env_exists: boolean; generated_count: number; output_dir: string; }
interface GenerateResult { success: boolean; model_path?: string; error?: string; }

function StatusIndicator({ online, label }: { online: boolean; label: string }) {
  return <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${online ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} /><span className="text-xs text-gray-400">{label}</span></div>;
}

const PROMPT_EXAMPLES = [
  { label: "Robot", prompt: "a futuristic robot, chrome metallic, highly detailed, standing pose", tag: "character" },
  { label: "Neon Mic", prompt: "a neon microphone, cyberpunk style, glowing accents, floating", tag: "prop" },
  { label: "DJ Console", prompt: "a DJ console, modern minimalist, LED indicators, top-down view", tag: "prop" },
  { label: "Stage", prompt: "concert stage platform, LED walls, fog, cinematic volumetric lighting", tag: "environment" },
];

export function Studio3D() {
  const navigate = useNavigate();
  const [gpuStats, setGpuStats] = useState<GpuStats | null>(null);
  const [gen3dStatus, setGen3dStatus] = useState<Gen3DStatus | null>(null);
  const [prompt, setPrompt] = useState("a futuristic robot, chrome metallic, highly detailed, standing pose");
  const [steps, setSteps] = useState(15);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [showPromptHelp, setShowPromptHelp] = useState(false);

  const fetchGpuStats = useCallback(async () => {
    try { const res = await fetch("/api/health/gpu"); if (res.ok) { setGpuStats(await res.json()); setBackendOnline(true); } } catch { setBackendOnline(false); }
  }, []);
  const fetchGen3DStatus = useCallback(async () => {
    try { const res = await fetch("/api/health/3d/status"); if (res.ok) setGen3dStatus(await res.json()); } catch { /* offline */ }
  }, []);

  useEffect(() => {
    fetchGpuStats(); fetchGen3DStatus();
    const a = setInterval(fetchGpuStats, 5000), b = setInterval(fetchGen3DStatus, 10000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [fetchGpuStats, fetchGen3DStatus]);

  const handleGenerate = async () => {
    setGenerating(true); setGenerateResult(null);
    try {
      const res = await fetch("/api/health/3d/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, steps }) });
      if (res.ok) { const data: GenerateResult = await res.json(); setGenerateResult(data); if (data.success) fetchGen3DStatus(); }
      else setGenerateResult({ success: false, error: `HTTP ${res.status}` });
    } catch { setGenerateResult({ success: false, error: "Backend not available" }); }
    finally { setGenerating(false); }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Box size={22} className="text-violet-400" /> 3D Studio <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">8GB VRAM-safe</span></h1>
          <p className="text-sm text-gray-400 mt-1">Hunyuan3D-2mini geometry → Wan 2.2 5B 480p fits 8GB → Blender 5.2 EEVEE Next → beat-synced render</p>
        </div>
        <StatusIndicator online={backendOnline} label={backendOnline ? "Backend Online" : "Backend Offline"} />
      </div>

      {/* Knowledge banner */}
      <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-transparent to-transparent p-4 flex flex-col md:flex-row gap-3">
        <div className="flex-1">
          <p className="text-sm font-bold text-white flex items-center gap-2"><Sparkles size={14} className="text-violet-400" /> Connected to your video pipeline</p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">Every 3D asset here is built to be <b className="text-gray-200">used in the Wizard Phase 2</b>. Generate → preview → &ldquo;Use in Music Video&rdquo; bridges to wizard with prompt & model path attached. See vault <code className="text-violet-300">blender-mcp</code> + <code className="text-violet-300">3d-rendering</code>.</p>
        </div>
        <button onClick={() => navigate("/music-video-wizard")} className="shrink-0 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 self-start md:self-center"><Wand2 size={14} /> Open Wizard <ArrowRight size={14} /></button>
      </div>

      {/* GPU Monitor */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={16} className="text-sky-400" /><h2 className="text-sm font-bold text-white">GPU Monitor</h2>
          {gpuStats?.name && <span className="text-xs text-gray-500 ml-1 hidden md:inline">{gpuStats.name} • 8GB budget: usable ≈5.5GB</span>}
          <button onClick={fetchGpuStats} className="ml-auto p-1.5 hover:bg-gray-700 rounded-lg"><RefreshCw size={12} className="text-gray-400" /></button>
        </div>
        {gpuStats?.available ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "VRAM", value: `${gpuStats.memory_used_mb?.toLocaleString() ?? 0} / ${gpuStats.memory_total_mb?.toLocaleString() ?? 0} MB`, sub: `${gpuStats.memory_percent?.toFixed(1)}% used`, color: (gpuStats.memory_percent ?? 0) > 90 ? "text-red-400" : "text-emerald-400" },
              { label: "Utilization", value: `${gpuStats.gpu_utilization ?? 0}%`, sub: "GPU Compute", color: "text-sky-400" },
              { label: "Temperature", value: `${gpuStats.temperature_c ?? 0}°C`, sub: (gpuStats.temperature_c ?? 0) > 80 ? "Hot" : "Normal", color: (gpuStats.temperature_c ?? 0) > 80 ? "text-red-400" : "text-emerald-400" },
              { label: "Processes", value: `${gpuStats.processes?.length ?? 0}`, sub: "Active on GPU", color: "text-violet-400" },
            ].map(s => (
              <div key={s.label} className="bg-gray-900 rounded-xl p-3 border border-gray-700"><p className="text-xs text-gray-500">{s.label}</p><p className={`text-sm font-bold ${s.color}`}>{s.value}</p><p className="text-xs text-gray-500">{s.sub}</p></div>
            ))}
          </div>
        ) : (
          <div className="flex gap-2 text-sm text-gray-500 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3"><AlertCircle size={16} className="text-amber-400 shrink-0 mt-0.5" /><p>GPU data unavailable. {backendOnline ? "Install nvidia-ml-py3 in venv." : "Backend offline — checks resume when online."}</p></div>
        )}
        <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1"><Zap size={10} /> 5.1: +10% GPU • EEVEE Next: raytracing overhaul — enable ray-traced shadows/GI only when needed.</p>
      </div>

      {/* 3D Generation */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-violet-400" /><h2 className="text-sm font-bold text-white">3D Generation</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">Hunyuan3D-2mini • Wan 2.2 5B @ 480p</span>
          <button onClick={() => setShowPromptHelp(!showPromptHelp)} className="ml-auto text-xs text-violet-400 hover:underline flex items-center gap-1"><Lightbulb size={12} /> Prompt format</button>
        </div>

        {gen3dStatus ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Status", value: gen3dStatus.available ? "Ready" : "Unavailable", color: gen3dStatus.available ? "text-emerald-400" : "text-red-400" },
              { label: "Model", value: gen3dStatus.model_exists ? "Found" : "Missing", color: gen3dStatus.model_exists ? "text-emerald-400" : "text-red-400" },
              { label: "CUDA Env", value: gen3dStatus.env_exists ? "Ready" : "Missing", color: gen3dStatus.env_exists ? "text-emerald-400" : "text-red-400" },
              { label: "Generated", value: `${gen3dStatus.generated_count} models`, color: "text-violet-400" },
            ].map(s => <div key={s.label} className="bg-gray-900 rounded-xl p-3 border border-gray-700"><p className="text-xs text-gray-500">{s.label}</p><p className={`text-sm font-bold ${s.color}`}>{s.value}</p></div>)}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-gray-500 mb-4 text-sm"><Loader2 size={14} className="animate-spin" /> Loading service status…</div>
        )}

        {showPromptHelp && (
          <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
            <p className="text-xs font-bold text-violet-300 flex items-center gap-1"><BookOpen size={12} /> Prompt format — vault <code>prompt-engineering</code></p>
            <p className="text-xs text-gray-400 mt-1"><code className="text-gray-200">[object], [material], [style], [orientation], [detail]</code> — e.g. &ldquo;chrome metallic, standing pose&rdquo;. Negative: <code className="text-amber-300">blurry, low quality, deformed</code>. Keep &lt;75 words.</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PROMPT_EXAMPLES.map(ex => <button key={ex.label} onClick={() => setPrompt(ex.prompt)} className="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-gray-300">+ {ex.label}</button>)}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500 mb-2 flex items-center gap-1"><Target size={10} /> Text-to-3D → GLB. For textured output needs <code className="text-violet-300">custom_rasterizer</code> compile — geometry-only is 8GB-safe.</p>
        <div className="flex gap-2">
          <input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="a futuristic robot, chrome metallic, highly detailed" className="flex-1 px-3 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-sm text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none" onKeyDown={e => e.key === "Enter" && !generating && handleGenerate()} />
          <input type="number" value={steps} onChange={e => setSteps(Number(e.target.value))} min={5} max={50} className="w-20 px-3 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-sm text-white text-center" title="Diffusion steps" />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={handleGenerate} disabled={generating || !gen3dStatus?.available || !prompt.trim()} className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold flex items-center gap-2">
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Box size={14} />} {generating ? "Generating…" : "Generate 3D Model"}
          </button>
          <span className="text-xs text-gray-500 self-center">15 fast • 30 quality • <span className="text-violet-300">try &ldquo;neon microphone, cyberpunk&rdquo;</span></span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {PROMPT_EXAMPLES.map(ex => <button key={ex.prompt} onClick={() => setPrompt(ex.prompt)} className={`text-xs px-2.5 py-1 rounded-full border ${prompt === ex.prompt ? "bg-violet-600 border-violet-500 text-white" : "bg-gray-900 border-gray-700 text-gray-400 hover:border-violet-500/30 hover:text-gray-200"}`}>{ex.label} • {ex.tag}</button>)}
        </div>

        {generateResult && (
          <div className={`mt-3 p-3 rounded-xl text-sm flex gap-2 border ${generateResult.success ? "bg-emerald-900/20 border-emerald-700/50 text-emerald-200" : "bg-red-900/20 border-red-700/50 text-red-200"}`}>
            {generateResult.success ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
            <div className="min-w-0 flex-1">
              {generateResult.success ? (
                <>
                  <p className="font-bold">3D Model Generated</p>
                  <p className="text-xs mt-1 font-mono break-all opacity-80">{generateResult.model_path}</p>
                  <button onClick={() => navigate("/music-video-wizard")} className="mt-2 text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg inline-flex items-center gap-1"><Video size={12} /> Use in Music Video →</button>
                </>
              ) : (
                <>
                  <p className="font-bold">Generation Failed</p>
                  <p className="text-xs mt-1">{generateResult.error}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Troubleshoot: reduce steps to 15, resolution 512, check model at <code className="text-violet-300">diffusion_models/hunyuan3d-2mini</code>.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* EEVEE Next guidance */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><Eye size={14} className="text-sky-400" /> Rendering — EEVEE Next vs Cycles (8GB)</h3>
        <div className="grid md:grid-cols-2 gap-3 mt-3 text-xs">
          <div className="bg-gray-900 rounded-xl p-3 border border-gray-700">
            <p className="font-bold text-white flex items-center gap-1"><Zap size={12} className="text-amber-400" /> EEVEE Next (recommended preview)</p>
            <p className="text-gray-400 mt-1">Real-time 1080p ≈2s/frame • 240f ≈8 min. Enable ray-traced shadows/GI only when needed — each adds seconds. TAA 64 samples usually sufficient.</p>
            <p className="text-violet-300 mt-1">Use for: previz, stylized, fast iteration.</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-3 border border-gray-700">
            <p className="font-bold text-white flex items-center gap-1"><Sliders size={12} className="text-violet-400" /> Cycles CUDA (quality)</p>
            <p className="text-gray-400 mt-1">128 samples ≈30s/frame • 240f ≈120 min. GPU Compute, denoise + OpenImageDenoise, tile 256. +10% GPU in 5.1.</p>
            <p className="text-violet-300 mt-1">Use for: finals, photoreal.</p>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">Backend: <code className="text-violet-300">BlenderSceneBuilder(render_engine=&#39;CYCLES&#39;|&#39;EEVEE_NEXT&#39;)</code> → <code className="text-violet-300">blender_mcp</code> executes. See <code className="text-violet-300">3d-rendering.md</code>.</p>
      </div>

      {/* Pipeline */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex items-center gap-2 mb-3"><Layers size={16} className="text-orange-400" /><h2 className="text-sm font-bold text-white">Music Video Pipeline — where 3D fits</h2><span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400">v2 2026</span></div>
        <ol className="grid md:grid-cols-2 gap-3 text-sm">
          {[
            { n: 1, t: "Upload Audio", d: "Move to Wizard → Upload", c: "text-sky-400" },
            { n: 2, t: "Analyze Beats", d: "Tempo, beats, valence via librosa/CUDA", c: "text-sky-400" },
            { n: 3, t: "Generate 3D Assets", d: "You are here — Hunyuan3D / Wan 2.2 5B", c: "text-violet-400 font-bold" },
            { n: 4, t: "Blender Scene", d: "Stage via Blender MCP (concert / abstract / club)", c: "text-orange-400" },
            { n: 5, t: "Sync & Animate", d: "Beat-synced keyframes, cuts on strong beats", c: "text-amber-400" },
            { n: 6, t: "Render & Export", d: "EEVEE or Cycles → 16:9 + 9:16 + thumbs", c: "text-emerald-400" },
          ].map(s => (
            <li key={s.n} className={`flex gap-3 p-3 rounded-xl border ${s.n === 3 ? "bg-violet-500/10 border-violet-500/30" : "bg-gray-900 border-gray-700"}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 ${s.n === 3 ? "bg-violet-600 text-white" : "bg-gray-700 text-gray-300"}`}>{s.n}</span>
              <div><p className={`font-semibold ${s.c}`}>{s.t}</p><p className="text-xs text-gray-500">{s.d}</p></div>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex gap-2">
          <button onClick={() => navigate("/music-video-wizard")} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2"><Wand2 size={14} /> Continue in Wizard</button>
          <button onClick={() => navigate("/visualizer")} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm flex items-center gap-2"><ImageIcon size={14} /> Test in Visualizer</button>
        </div>
      </div>
    </div>
  );
}
