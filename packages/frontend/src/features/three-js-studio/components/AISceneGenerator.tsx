import { useState, useCallback, useEffect, useRef } from "react";
import { Sparkles, Play, Square, Copy, Check, ChevronDown, ChevronUp, Zap, Save, FileCode } from "lucide-react";
import { useTrackMetadata, generatePromptVariations, type PromptVariation } from "../hooks/useTrackMetadata";
import { useOllamaStream } from "../hooks/useOllamaStream";
import { getGuidelinesPrompt } from "../services/sceneGuidelines";
import { getOllamaModels, saveGeneratedScene, cleanupIncompleteScenes, getBenchmarkResults, runBenchmark, type OllamaModel, type OllamaBenchmarkResult } from "../../../services/api";
import { getGPUSnapshot } from "../../../services/api";

interface AISceneGeneratorProps {
  selectedTrack: string | null;
  onApplyCode: (code: string) => void;
  storyboard?: string | null;
  autoGenerate?: boolean;
  storyboardScene?: number | null;
}

export function AISceneGenerator({ selectedTrack, onApplyCode, storyboard, autoGenerate, storyboardScene }: AISceneGeneratorProps) {
  const { metadata, loading: metaLoading } = useTrackMetadata(selectedTrack || null);
   const { generate, cancel, generating, output, getOutput } = useOllamaStream();
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [variations, setVariations] = useState<PromptVariation[]>(() => generatePromptVariations({
    filename: "default", bpm: 120, duration: 180, sections: [], energyCurve: [], confidence: 0,
  }));
  const [activeVariation, setActiveVariation] = useState(0);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFile, setSavedFile] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [storyboardContent, setStoryboardContent] = useState<string>("");
  const [benchmarks, setBenchmarks] = useState<Record<string, OllamaBenchmarkResult>>({});
  const [benchLoading, setBenchLoading] = useState(false);
  const [benchError, setBenchError] = useState<string | null>(null);
  const [benchUpdatedAt, setBenchUpdatedAt] = useState<string | null>(null);
  const [showBenchDetails, setShowBenchDetails] = useState(false);

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

  const formatModelSize = (bytes: number) => {
    if (!bytes) return "";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)}GB`;
    return `${Math.round(bytes / (1024 * 1024))}MB`;
  };

  const loadModels = useCallback(async () => {
    try {
      const m = await getOllamaModels();
      // Fetch benchmarks in parallel and enrich sorting
      let benchMap: Record<string, OllamaBenchmarkResult> = {};
      try {
        const data = await getBenchmarkResults();
        benchMap = data.results || {};
        setBenchmarks(benchMap);
        setBenchUpdatedAt(data.updated_at || null);
      } catch { /* no benchmarks yet */ }

      // Sort by benchmark score desc, then latency asc — best first
      const sorted = [...m].sort((a, b) => {
        const sa = a.benchmark?.score ?? benchMap[a.name]?.validation?.score ?? -1;
        const sb = b.benchmark?.score ?? benchMap[b.name]?.validation?.score ?? -1;
        if (sa !== sb) return sb - sa;
        const la = a.benchmark?.latency_ms ?? benchMap[a.name]?.latency_ms ?? 999999;
        const lb = b.benchmark?.latency_ms ?? benchMap[b.name]?.latency_ms ?? 999999;
        return la - lb;
      });
      setModels(sorted);

      if (sorted.length > 0 && !selectedModel) {
        // Prefer highest benchmark score; fallback to qwen3.5:4b
        const best = sorted[0];
        const benchBest = best?.benchmark?.success !== false && (best?.benchmark?.score ?? benchMap[best.name]?.validation?.score ?? 0) >= 40 ? best : null;
        const fallback = sorted.find((x) => x.name === "qwen3.5:4b (3389983735)") || sorted.find((x) => x.name.includes("qwen3.5:4b"));
        const preferred = benchBest || fallback || sorted[0];
        setSelectedModel(preferred.name);
      }
    } catch { /* ignore */ }
  }, [selectedModel]);

  // Load models + benchmarks on mount
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleRunBenchmark = useCallback(async () => {
    setBenchLoading(true);
    setBenchError(null);
    try {
      const data = await runBenchmark(undefined, 8);
      setBenchmarks(data.results || {});
      setBenchUpdatedAt(data.updated_at || null);
      // Re-sort models by new scores
      setModels((prev) => {
        const sorted = [...prev].sort((a, b) => {
          const sa = data.results[a.name]?.validation?.score ?? -1;
          const sb = data.results[b.name]?.validation?.score ?? -1;
          if (sa !== sb) return sb - sa;
          return (data.results[a.name]?.latency_ms ?? 999999) - (data.results[b.name]?.latency_ms ?? 999999);
        });
        // Auto-switch to new best if current is not best
        const best = sorted[0];
        if (best && data.results[best.name]?.validation?.score >= 60) {
          setSelectedModel(best.name);
        }
        return sorted;
      });
    } catch (e: any) {
      setBenchError(e.message || "Benchmark failed");
    } finally {
      setBenchLoading(false);
    }
  }, []);

  // Auto-save only when generation completes (not during streaming)
  const generationIdRef = useRef<string>("");
  useEffect(() => {
    // Only save when we have complete code and generation just finished
    if (!generating && output && output.length > 50 && savedFile !== output.substring(0, 40)) {
      const id = `${selectedTrack}_${Date.now()}`;
      generationIdRef.current = id;
      saveGeneratedScene(output, selectedTrack || "unknown", selectedModel || "unknown")
        .then((result) => setSavedFile(result.filename))
        .catch(() => {});
    }
  }, [generating, output, selectedTrack, selectedModel, savedFile]);

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

    // Reset saved file tracking and cleanup old incomplete files
    setSavedFile(null);
    cleanupIncompleteScenes(selectedTrack || "unknown", 3).catch(() => {});

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

    const guidelines = getGuidelinesPrompt();
    const systemPrompt = `You are a Three.js code generator. Output RAW JavaScript ONLY - no markdown fences, no \`\`\`, no explanations.

CONTRACT - MUST OBEY (checked automatically, violations will be rejected):
1. Define exactly: function applyScene(scene, camera, renderer, THREE) { ... return update; }
2. Inside applyScene:
   - Cleanup previous: const old = scene.getObjectByName("__aiGenerated"); if(old){ old.traverse(c=>{c.geometry&&c.geometry.dispose(); c.material&&[].concat(c.material).forEach(m=>m.dispose())}); scene.remove(old); }
   - Create: const g = new THREE.Group(); g.name = "__aiGenerated"; scene.add(g); Add ALL meshes/lights to g (or tag lights with userData.__ai=true)
   - Camera: camera.position.set(x,y,z); camera.lookAt(0,1,0);
   - Scene: scene.background = new THREE.Color(hex); scene.fog = new THREE.FogExp2(hex, 0.015);
3. FORBIDDEN (will fail validation): requestAnimationFrame, renderer.setSize(window.innerWidth), renderer.setPixelRatio, window.addEventListener('resize'), document.getElementById, import, require, OrbitControls, EffectComposer, React hooks
4. Return: return (time, delta) => { /* per-frame, time=seconds since start, delta=frame time */ };
   Example body: m.rotation.y += delta*0.5; m.scale.setScalar(1+Math.sin(time*2)*0.04);
5. Keep 40-90 lines. Use only: THREE.Group, Mesh, MeshStandardMaterial, MeshPhysicalMaterial, Points, PointsMaterial, BufferGeometry, SphereGeometry, BoxGeometry, CylinderGeometry, TorusGeometry, TorusKnotGeometry, IcosahedronGeometry, Color, FogExp2, AmbientLight, DirectionalLight, PointLight, SpotLight, Clock (optional, but use time param instead).
6. Materials: clone if per-mesh opacity varies. No shared mutable opacity. Halo: geo.clone().scale(1.18,1.18,1.18).
7. Do not invent APIs: no scene.add.environment(), no scene.set_camera(), no custom loaders.

${guidelines}

FEW-SHOT EXAMPLE (copy structure, change geometry/colors):
function applyScene(scene,camera,renderer,THREE){
  const old=scene.getObjectByName("__aiGenerated"); if(old){ old.traverse(c=>{c.geometry&&c.geometry.dispose(); if(c.material) [].concat(c.material).forEach(m=>m.dispose())}); scene.remove(old); }
  scene.background=new THREE.Color(0x0a0a0f); scene.fog=new THREE.FogExp2(0x0a0a0f,0.015);
  const g=new THREE.Group(); g.name="__aiGenerated"; scene.add(g);
  const mat=new THREE.MeshStandardMaterial({color:0x88ccff, metalness:0.6, roughness:0.3, emissive:0x224466, emissiveIntensity:0.2});
  const m=new THREE.Mesh(new THREE.SphereGeometry(1.2,32,32), mat); g.add(m);
  camera.position.set(0,3,8); camera.lookAt(0,1,0);
  return (t,d)=>{ m.rotation.y+=d*0.4; m.position.y=Math.sin(t*1.2)*0.1; m.scale.setScalar(1+Math.sin(t*2.2)*0.05); };
}

Track: ${metadata.bpm} BPM, ${Math.round(metadata.duration)}s, sections: ${metadata.sections.map((s: any) => s.type).join(", ")}, avgEnergy ${Math.round(metadata.sections.reduce((a:any,c:any)=>a+c.energy,0)/(metadata.sections.length||1)*100)}%
${sceneContext}
User request: ${variations[activeVariation].prompt}
Return ONLY the function, no fences.`;

    // VRAM-aware num_ctx: keeps output usable for pro visuals while avoiding OOM/offload
    // 8GB card: 4096 ctx ~1.0GB KV for 4b, ~1.8GB for 9b; 8192 ~3GB. Choose conservatively.
    let num_ctx = 4096;
    try {
      const gpu = await getGPUSnapshot();
      const free = (gpu as any).memory_free_mb ?? (gpu as any).vram_free_mb ?? (gpu as any).memoryFreeMb ?? 2048;
      const isLarge = /9b|7b|13b|14b/i.test(selectedModel);
      if (free > 4000) num_ctx = isLarge ? 8192 : 6144;
      else if (free > 2000) num_ctx = 4096;
      else num_ctx = 3072; // low VRAM: still enough for pro prompt (~1800 tok) + 900 predict
      // safety cap via backend adapter (caps >16384 →16384)
    } catch {
      // fallback 4096 if GPU probe fails — still fits professional prompt
      num_ctx = 4096;
    }

    await generate(
      variations[activeVariation].prompt,
      selectedModel,
      systemPrompt,
      { temperature: 0.2, top_p: 0.9, num_predict: 900, repeat_penalty: 1.1, num_ctx },
      false,
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

  const handleSave = useCallback(async () => {
    const code = getOutput() || output;
    if (!code) return;
    setSaving(true);
    try {
      const result = await saveGeneratedScene(code, selectedTrack || "unknown", selectedModel || "unknown");
      setSavedFile(result.filename);
    } catch {
      // Silently fail — save is best-effort
    } finally {
      setSaving(false);
    }
  }, [output, getOutput, selectedTrack, selectedModel]);

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

          {/* Model Selection + Benchmark */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase tracking-wider text-gray-500">Model</label>
              <button
                onClick={handleRunBenchmark}
                disabled={benchLoading}
                className="text-[10px] px-2 py-0.5 rounded bg-amber-900/30 hover:bg-amber-800/50 text-amber-300 border border-amber-700/30 disabled:opacity-50 flex items-center gap-1"
                title="Benchmark all models on Three.js contract (takes ~1-2 min)"
              >
                {benchLoading ? <span className="inline-block w-3 h-3 border border-amber-300 border-t-transparent rounded-full animate-spin" /> : "⚡"}
                {benchLoading ? "Benchmarking…" : "Benchmark"}
              </button>
            </div>
            <div className="flex gap-1.5">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                onClick={loadModels}
              >
                {models.length === 0 && <option value="">Click to load models...</option>}
                {models.map((m) => {
                  const full = benchmarks[m.name] as any;
                  const bench = (full || m.benchmark) as any;
                  const score = bench?.validation?.score ?? bench?.score ?? null;
                  const latency = bench?.latency_ms ?? null;
                  const success = bench?.success;
                  let badge = "";
                  if (score !== null && score >= 0) {
                    const s = Math.round(score);
                    const ok = success === false ? "✗" : s >= 70 ? "✓" : s >= 40 ? "~" : "✗";
                    badge = ` [${ok} ${s}/100${latency ? ` ${Math.round(latency/1000*10)/10}s` : ""}]`;
                  } else if (score === null) {
                    badge = " [—]";
                  }
                  const isBest = models[0]?.name === m.name && score !== null && score >= 60;
                  return (
                    <option key={m.name} value={m.name}>
                      {m.name} ({formatModelSize(m.size)}){badge}{isBest ? " ★ Best" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            {(() => {
              const active = models.find((x) => x.name === selectedModel);
              const bFull = active ? (benchmarks[active.name] as any) : null;
              const bShallow = active?.benchmark as any;
              const b = (bFull || bShallow) as any;
              // Need full validation for details view; if only shallow, show summary and prompt to benchmark
              if (!b || !b.validation) {
                if (b && b.score !== undefined) {
                  const scShallow = b.score;
                  const colS = scShallow >= 80 ? "text-green-400" : scShallow >= 60 ? "text-amber-300" : "text-orange-400";
                  return (
                    <div className="mt-1.5 bg-gray-900/70 border border-gray-800 rounded p-1.5 text-[10px]">
                      <span className={`font-mono font-bold ${colS}`}>{Math.round(scShallow)}/100 {b.success ? "✓" : "✗"}</span>
                      <span className="text-gray-400 ml-2">{b.latency_ms}ms</span>
                      <div className="text-gray-500 mt-1">Details from models list only — run <span className="text-amber-400">Benchmark</span> for full report.</div>
                    </div>
                  );
                }
                return (
                  <div className="mt-1 text-[10px] text-gray-500">
                    No benchmark yet — click <span className="text-amber-400">Benchmark</span> to rank models. Best will be auto-selected.
                    {benchUpdatedAt && <span className="ml-1">Last: {new Date(benchUpdatedAt).toLocaleString()}</span>}
                  </div>
                );
              }
              const sc = b.validation.score;
              const col = sc >= 80 ? "text-green-400" : sc >= 60 ? "text-amber-300" : sc >= 40 ? "text-orange-400" : "text-red-400";
              return (
                <div className="mt-1.5 bg-gray-900/70 border border-gray-800 rounded p-1.5 text-[10px] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={`font-mono font-bold ${col}`}>{Math.round(sc)}/100 {b.success ? "✓ valid" : "✗ failed"}</span>
                    <span className="text-gray-400">{b.latency_ms}ms • {b.lines} lines • {b.chars} chars</span>
                  </div>
                  <div className="flex gap-1 text-[9px]">
                    <span className={b.validation.details.find((d:any)=>d.rule==="has_applyScene")?.passed ? "text-green-400" : "text-red-400"}>applyScene {b.validation.details.find((d:any)=>d.rule==="has_applyScene")?.passed ? "✓" : "✗"}</span>
                    <span className={b.validation.details.find((d:any)=>d.rule==="has_ai_group")?.passed ? "text-green-400" : "text-red-400"}>__aiGroup {b.validation.details.find((d:any)=>d.rule==="has_ai_group")?.passed ? "✓" : "✗"}</span>
                    <span className={b.validation.details.find((d:any)=>d.rule==="no_rAF")?.passed ? "text-green-400" : "text-red-400"}>no-rAF {b.validation.details.find((d:any)=>d.rule==="no_rAF")?.passed ? "✓" : "✗"}</span>
                    <span className={b.validation.details.find((d:any)=>d.rule==="no_markdown_fence")?.passed ? "text-green-400" : "text-red-400"}>no-fence {b.validation.details.find((d:any)=>d.rule==="no_markdown_fence")?.passed ? "✓" : "✗"}</span>
                  </div>
                  {showBenchDetails ? (
                    <div className="pt-1 border-t border-gray-800 space-y-0.5 max-h-32 overflow-y-auto">
                      {b.validation.details.map((d: any) => (
                        <div key={d.rule} className={`flex justify-between ${d.passed ? "text-gray-400" : "text-red-300"}`}>
                          <span>{d.description}</span><span>{d.passed ? "✓" : "✗"}</span>
                        </div>
                      ))}
                      {b.error && <div className="text-red-400 pt-1">Error: {b.error}</div>}
                      {b.preview && <pre className="mt-1 bg-black/30 p-1 rounded text-[9px] text-gray-500 max-h-20 overflow-y-auto whitespace-pre-wrap">{b.preview.slice(0,300)}…</pre>}
                    </div>
                  ) : null}
                  <button onClick={() => setShowBenchDetails(!showBenchDetails)} className="text-purple-400 hover:text-purple-300">
                    {showBenchDetails ? "Hide details" : "Show details"}
                  </button>
                  {benchUpdatedAt && <div className="text-[9px] text-gray-600">Benchmarked: {new Date(benchUpdatedAt).toLocaleString()}</div>}
                </div>
              );
            })()}
            {benchError && <div className="mt-1 text-[10px] text-red-400 bg-red-900/20 border border-red-700/30 rounded px-2 py-1">{benchError}</div>}
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
                  <button onClick={handleSave} disabled={saving} className="p-1 text-gray-400 hover:text-white" title="Save to file">
                    {saving ? <span className="inline-block w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" /> : <Save size={12} />}
                  </button>
                </div>
              </div>
              <pre className="bg-gray-900 rounded p-2 text-[10px] text-green-300 max-h-48 overflow-y-auto font-mono whitespace-pre-wrap">
                {output}
              </pre>
              {savedFile && (
                <div className="flex items-center gap-1 text-[10px] text-cyan-400">
                  <FileCode size={10} />
                  <span>Saved: {savedFile}</span>
                </div>
              )}
              <button
                onClick={() => onApplyCode(getOutput() || output)}
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
