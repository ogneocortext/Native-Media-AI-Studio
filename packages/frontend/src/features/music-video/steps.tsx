import { useState } from "react";
import {
  Upload, Music, Wand2, Sparkles, Play, ChevronRight, Download,
  Loader2, Zap, Layers,
  Smartphone, Lightbulb, Target, Sliders, Eye, FileWarning,
  CheckCircle2,
} from "lucide-react";
import type { AudioAnalysis, GenerationConfig } from "./types";
import { VISUAL_TREATMENTS } from "./types";

export function UploadStep({ audioFile, audioUrl, onDrop, onFileSelect, onNext, analyzing }: {
  audioFile: File | null; audioUrl: string | null; onDrop: (e: React.DragEvent) => void;
  onFileSelect: (file: File) => void; onNext: () => void; analyzing: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="p-6 md:p-8">
      <div className="max-w-2xl mx-auto text-center">
        <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center mx-auto mb-3"><Music size={22} className="text-white" /></div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Upload Your Track</h2>
        <p className="text-sm text-gray-400 mt-2">We analyze tempo, beats, sections & mood <em>before</em> generating — SunoMV &ldquo;analyze first, generate second&rdquo;. Supports MP3, WAV, FLAC, OGG, M4A (max 500 MB).</p>
        <div onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} className={`mt-6 border-2 border-dashed rounded-xl p-8 md:p-10 transition-all cursor-pointer group ${dragOver ? "border-violet-500 bg-violet-500/5" : "border-gray-600 hover:border-violet-500 hover:bg-violet-500/5"}`} onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = "audio/*,.mp3,.wav,.flac,.ogg,.m4a"; input.onchange = (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (file) onFileSelect(file); }; input.click(); }}>
          <Upload size={40} className={`mx-auto mb-3 transition-transform group-hover:scale-110 ${audioFile ? "text-violet-400" : "text-gray-500"}`} />
          {audioFile ? (
            <div className="space-y-1">
              <p className="text-white font-semibold flex items-center justify-center gap-2"><CheckCircle2 size={16} className="text-emerald-400" />{audioFile.name}</p>
              <p className="text-gray-400 text-sm">{(audioFile.size / (1024 * 1024)).toFixed(2)} MB • {audioFile.type || "audio"}</p>
              <p className="text-xs text-emerald-400 mt-2">Ready — click Analyze to extract beats & structure</p>
            </div>
          ) : (
            <>
              <p className="text-white font-medium">Click or drop audio file here</p>
              <p className="text-xs text-gray-500 mt-1">or paste a track from <span className="text-violet-300">Media Library</span></p>
              <p className="text-[11px] text-gray-500 mt-3 inline-flex items-center gap-1"><Lightbulb size={12} /> Tip: Visualizer gets 2-5× more YouTube rec than static album art</p>
            </>
          )}
        </div>
        {audioUrl && <audio controls src={audioUrl} className="w-full mt-4 rounded-lg" />}
        {audioFile && (
          <button onClick={onNext} disabled={analyzing} className="mt-6 w-full md:w-auto px-8 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl flex items-center gap-2 mx-auto font-semibold shadow-lg shadow-violet-600/20">
            {analyzing ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />} {analyzing ? "Analyzing..." : "Analyze Track →"}
          </button>
        )}
        <p className="text-[11px] text-gray-500 mt-3">We also compute valence, energy curve & key for palette/mood mapping.</p>
      </div>
    </div>
  );
}

export function AnalyzeStep({ analysis, audioUrl, onNext }: { analysis: AudioAnalysis; audioUrl: string | null; onNext: () => void }) {
  const maxEnergy = Math.max(...analysis.sections.map(s => s.energy), 1);
  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center"><Music size={16} className="text-sky-400" /></div>
        <div>
          <h2 className="text-xl font-bold text-white">Track Analysis — stem-native ready</h2>
          <p className="text-xs text-gray-400">Tempo, beats, sections + per-stem hooks for visuals (drums→pulse, bass→shake, vocals→kinetic).</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-gray-900 rounded-xl p-4 text-center border border-gray-700"><p className="text-gray-500 text-xs uppercase tracking-wide">Tempo</p><p className="text-2xl font-extrabold text-white mt-1">{analysis.tempo_bpm}</p><p className="text-gray-500 text-xs">BPM • {analysis.tempo_bpm < 90 ? "Ballad" : analysis.tempo_bpm < 120 ? "Groove" : "High-energy"}</p></div>
        <div className="bg-gray-900 rounded-xl p-4 text-center border border-gray-700"><p className="text-gray-500 text-xs uppercase tracking-wide">Duration</p><p className="text-2xl font-extrabold text-white mt-1">{(analysis.duration_seconds / 60).toFixed(1)}<span className="text-sm font-normal text-gray-500"> min</span></p><p className="text-gray-500 text-xs">{analysis.duration_seconds.toFixed(0)}s • {analysis.beat_count} beats</p></div>
        <div className="bg-gray-900 rounded-xl p-4 text-center border border-gray-700"><p className="text-gray-500 text-xs uppercase tracking-wide">Beats</p><p className="text-2xl font-extrabold text-white mt-1">{analysis.beat_count}</p><p className="text-gray-500 text-xs">≈ {(analysis.beat_count / (analysis.duration_seconds / 60)).toFixed(1)}/min</p></div>
        <div className="bg-gray-900 rounded-xl p-4 text-center border border-violet-500/30 bg-violet-500/5"><p className="text-violet-300 text-xs uppercase tracking-wide font-semibold">Sections</p><p className="text-2xl font-extrabold text-white mt-1">{analysis.sections.length}</p><p className="text-gray-500 text-xs">for per-section generation</p></div>
      </div>
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><Layers size={14} className="text-violet-400" /> Song Structure</h3>
        <div className="flex gap-0.5 h-14 rounded-xl overflow-hidden border border-gray-700">
          {analysis.sections.map((section, i) => {
            const width = ((section.end - section.start) / analysis.duration_seconds) * 100;
            const colors: Record<string, string> = { intro: "bg-sky-600", verse: "bg-emerald-600", chorus: "bg-violet-600", bridge: "bg-amber-600", outro: "bg-rose-600", "pre-chorus": "bg-teal-600" };
            const treatment = VISUAL_TREATMENTS[section.type] || "Custom treatment";
            return (
              <div key={i} className={`${colors[section.type] || "bg-gray-600"} flex flex-col items-center justify-center relative group cursor-help`} style={{ width: `${width}%` }}>
                <span className="text-xs text-white font-bold truncate px-1">{section.type}</span>
                <span className="text-[10px] text-white/80 hidden md:block">{(section.energy * 100).toFixed(0)}% energy</span>
                <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 border border-gray-700 text-white text-xs p-2.5 rounded-xl shadow-xl whitespace-nowrap z-10 min-w-[180px]">
                  <p className="font-bold">{section.type}</p>
                  <p className="text-gray-400">{section.start.toFixed(1)}s → {section.end.toFixed(1)}s • {(section.end - section.start).toFixed(1)}s</p>
                  <p className="text-violet-300 mt-1">{treatment}</p>
                  <div className="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${(section.energy / maxEnergy) * 100}%` }} /></div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-1.5 text-xs text-gray-500"><span>0:00</span><span className="inline-flex items-center gap-1"><Target size={10} /> Strong beats → hard cut • Chorus = most important anchor</span><span>{Math.floor(analysis.duration_seconds / 60)}:{String(Math.floor(analysis.duration_seconds % 60)).padStart(2, "0")}</span></div>
      </div>
      <div className="grid md:grid-cols-2 gap-3 mb-6">
        <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-3 flex gap-2.5">
          <Lightbulb size={16} className="text-sky-400 mt-0.5 shrink-0" />
          <div><p className="text-xs font-bold text-sky-300">Stem-native insight (new 2026)</p><p className="text-xs text-gray-400 mt-1 leading-relaxed">Split stems (Demucs 8 stems) → <b className="text-gray-300">drums→scale pulse, bass→camera shake, spectral centroid→palette temp, onset→cut</b>. Enabled in backend via <code className="text-violet-300">analyze_and_sync.py</code>.</p></div>
        </div>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex gap-2.5">
          <Eye size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div><p className="text-xs font-bold text-amber-300">Mindful layering</p><p className="text-xs text-gray-400 mt-1">Cap <b className="text-gray-300">total motion &lt;800ms</b>, 1 primary + 1 secondary per shot. Chorus = maximalist, bridge = intimate VHS.</p></div>
        </div>
      </div>
      {audioUrl && <audio controls src={audioUrl} className="w-full rounded-lg" />}
      <button onClick={onNext} className="mt-6 w-full md:w-auto px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl flex items-center gap-2 font-semibold shadow-lg shadow-violet-600/20"><Wand2 size={18} /> Configure Style →<ChevronRight size={16} /></button>
    </div>
  );
}

export function ConfigureStep({ config, composedPrompt, onConfigChange, onSuggestionClick, onNext }: {
  config: GenerationConfig; composedPrompt: string; onConfigChange: (c: GenerationConfig) => void;
  onSuggestionClick: (w: string) => void; onNext: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState("happy");
  const applyStructured = () => onConfigChange({ ...config, prompt: composedPrompt });
  const SHOT_SIZES = ["Extreme Wide", "Wide", "Medium", "Close-up", "Extreme Close-up"];
  const CAMERA_ANGLES = ["Eye Level", "Low Angle", "High Angle", "Bird's Eye", "Dutch Angle"];
  const PROMPT_SUGGESTIONS: Record<string, string[]> = {
    happy: ["upbeat", "bright", "colorful", "energetic", "joyful", "vibrant"],
    calm: ["peaceful", "serene", "soft", "gentle", "relaxing", "ambient"],
    dark: ["moody", "atmospheric", "cinematic", "dramatic", "intense", "mysterious"],
    electronic: ["neon", "futuristic", "cyberpunk", "glitch", "synth", "digital"],
    natural: ["organic", "earthy", "warm", "sunset", "nature", "flowing"],
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><Wand2 size={18} className="text-violet-400" /> Configure Generation — structured prompt format</h2>
          <p className="text-xs text-gray-400 mt-1">Formula: <code className="text-violet-300">[Shot] + [Angle] + [Subject] + [Action] + [Setting] + [Lighting] + [Mood]</code></p>
        </div>
        <span className="hidden md:inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 shrink-0"><Sliders size={12} /> Present tense • single paragraph • &lt;75 words</span>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-5">
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <p className="text-xs font-bold text-violet-300 flex items-center gap-1"><Sliders size={12} /> Structured Builder</p>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div><label className="text-xs text-gray-400">Shot size</label><select value={config.structuredPrompt.shotSize} onChange={e => onConfigChange({ ...config, structuredPrompt: { ...config.structuredPrompt, shotSize: e.target.value } })} className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white">{SHOT_SIZES.map(s => <option key={s}>{s}</option>)}</select></div>
              <div><label className="text-xs text-gray-400">Camera angle</label><select value={config.structuredPrompt.cameraAngle} onChange={e => onConfigChange({ ...config, structuredPrompt: { ...config.structuredPrompt, cameraAngle: e.target.value } })} className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white">{CAMERA_ANGLES.map(a => <option key={a}>{a}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-1 gap-2 mt-3">
              {([["Subject", "subject"], ["Action", "action"], ["Setting", "setting"], ["Lighting", "lighting"], ["Mood", "mood"]] as const).map(([label, key]) => (
                <div key={key}><label className="text-xs text-gray-400">{label}</label><input value={(config.structuredPrompt as Record<string,string>)[key]} onChange={e => onConfigChange({ ...config, structuredPrompt: { ...config.structuredPrompt, [key]: e.target.value } })} placeholder={`Enter ${label}...`} className="w-full mt-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500" /></div>
              ))}
            </div>
            <div className="mt-3 p-2.5 bg-gray-900 rounded-lg border border-gray-700">
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Composed</p>
              <p className="text-xs text-gray-300 mt-1 leading-relaxed">{composedPrompt}</p>
              <button onClick={applyStructured} className="mt-2 text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg">Use composed → prompt</button>
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-white">Style palette</label>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {Object.keys(PROMPT_SUGGESTIONS).map(cat => <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${activeCategory === cat ? "bg-violet-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}>{cat}</button>)}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {PROMPT_SUGGESTIONS[activeCategory].map(w => <button key={w} onClick={() => onSuggestionClick(w)} className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-full text-xs">+ {w}</button>)}
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-white">Positive Prompt</label>
            <textarea value={config.prompt} onChange={e => onConfigChange({ ...config, prompt: e.target.value })} rows={3} className="w-full mt-2 px-3 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-sm text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none resize-none" placeholder="Describe your video scene..." />
          </div>
          <div>
            <label className="text-sm font-semibold text-white flex items-center gap-1"><FileWarning size={12} /> Negative Prompt</label>
            <input value={config.negativePrompt} onChange={e => onConfigChange({ ...config, negativePrompt: e.target.value })} className="w-full mt-2 px-3 py-2 bg-gray-900 border border-gray-600 rounded-xl text-sm text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none" placeholder="blurry, low quality..." />
          </div>
        </div>
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-gray-400">Steps</label><input type="number" value={config.steps} onChange={e => onConfigChange({ ...config, steps: Number(e.target.value) })} min={5} max={50} className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white" /></div>
            <div><label className="text-xs text-gray-400">CFG</label><input type="number" value={config.cfgScale} onChange={e => onConfigChange({ ...config, cfgScale: Number(e.target.value) })} min={1} max={20} step={0.5} className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white" /></div>
            <div><label className="text-xs text-gray-400">Seed</label><input type="number" value={config.seed} onChange={e => onConfigChange({ ...config, seed: Number(e.target.value) })} className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white" /><p className="text-[10px] text-gray-500 mt-1">-1 = random</p></div>
          </div>
          <label className="flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors bg-gray-900 border-gray-600 hover:border-violet-500/50">
            <input type="checkbox" checked={config.verticalFirst} onChange={e => onConfigChange({ ...config, verticalFirst: e.target.checked })} className="accent-violet-600" />
            <span className="text-sm text-white flex items-center gap-1"><Smartphone size={14} className="text-violet-400" /> Vertical-first master (9:16)</span>
          </label>
          <button onClick={onNext} className="mt-6 w-full md:w-auto px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl flex items-center gap-2 font-semibold shadow-lg shadow-violet-600/20"><Sparkles size={18} /> Continue to Generate →</button>
        </div>
      </div>
    </div>
  );
}

export function GenerateStep({ generating, progress, analysis, config, onStart }: {
  generating: boolean; progress: number; analysis: AudioAnalysis | null; config: GenerationConfig; onStart: () => void;
}) {
  const sections = analysis?.sections ?? [];
  return (
    <div className="p-6 md:p-8">
      <div className="text-center max-w-2xl mx-auto">
        <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center mx-auto"><Sparkles size={18} className="text-white" /></div>
        <h2 className="text-xl font-bold text-white mt-3">Generate per Section — mindful, not wallpaper</h2>
        <p className="text-sm text-gray-400 mt-2">{generating ? "Generating visuals for each section — cuts land on strong beats." : "Each section gets its treatment. We generate sequentially (1 at a time = no 8GB OOM) with beat-synced cameras."}</p>
      </div>
      {!generating ? (
        <>
          <div className="mt-6 grid md:grid-cols-2 gap-3 max-w-3xl mx-auto">
            {sections.map((s, i) => (
              <div key={i} className="bg-gray-900 border border-gray-700 rounded-xl p-3 flex gap-3 items-center">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${s.type === "chorus" ? "bg-violet-600 text-white" : s.type === "intro" ? "bg-sky-600 text-white" : s.type === "verse" ? "bg-emerald-600 text-white" : "bg-amber-600 text-white"}`}>{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white capitalize flex items-center gap-2">{s.type} <span className="text-xs font-normal text-gray-500">{s.start.toFixed(1)}s → {s.end.toFixed(1)}s</span></p>
                  <p className="text-xs text-gray-500 truncate">{VISUAL_TREATMENTS[s.type] || "Custom"}</p>
                  <input placeholder="Override prompt for this section (optional)" value={config.sectionOverrides[`${s.type}-${i}`] || ""} onChange={e => { const v = e.target.value; config.sectionOverrides[`${s.type}-${i}`] = v; }} className="w-full mt-1.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500" />
                </div>
                <span className="text-xs text-gray-500 shrink-0">{(s.energy * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
          <button onClick={onStart} className="mt-6 mx-auto flex px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl items-center gap-2 font-semibold shadow-lg shadow-violet-600/20"><Play size={18} /> Generate Video — {sections.length} sections</button>
        </>
      ) : (
        <div className="mt-8 max-w-xl mx-auto">
          <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden"><div className="bg-gradient-to-r from-violet-600 to-fuchsia-500 h-3 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} /></div>
          <p className="text-sm text-gray-400 mt-2 text-center">{progress.toFixed(0)}% • generating on CUDA (serial queue) — do not close</p>
          <div className="mt-4 flex items-center justify-center gap-2 text-violet-400 text-sm"><Loader2 size={18} className="animate-spin" /> Beat-synced keyframes + EEVEE Next / Cycles</div>
        </div>
      )}
    </div>
  );
}

export function ReviewStep({ generatedSections, audioUrl, analysis }: {
  generatedSections: string[]; audioUrl: string | null; analysis: AudioAnalysis | null;
}) {
  const [showExport, setShowExport] = useState(false);
  return (
    <div className="p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><Download size={18} className="text-emerald-400" /> Review & Export</h2>
          <p className="text-xs text-gray-400 mt-1">Upload a track and get: MV + thumbs + social captions + platform edits.</p>
        </div>
        <span className="hidden md:inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 shrink-0"><CheckCircle2 size={12} /> {generatedSections.length || analysis?.sections.length || 0} sections</span>
      </div>
      <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        {(generatedSections.length ? generatedSections : (analysis?.sections.map((s, i) => `section_${i}_${s.type}.mp4`) ?? ["preview.mp4"])).map((p, i) => (
          <div key={i} className="bg-gray-900 rounded-xl p-3 border border-gray-700 hover:border-violet-500/30 transition-colors group">
            <div className="aspect-video bg-gray-800 rounded-lg flex items-center justify-center relative overflow-hidden">
              <Play size={22} className="text-gray-600 group-hover:text-violet-400 transition-colors" />
              <span className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white border border-white/10">{analysis?.sections[i]?.type ?? "clip"}</span>
            </div>
            <p className="text-xs text-gray-400 truncate mt-2" title={p}>{p}</p>
          </div>
        ))}
      </div>
      {audioUrl && <audio controls src={audioUrl} className="w-full mt-4 rounded-lg" />}
      <button onClick={() => setShowExport(true)} className="mt-3 w-full md:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl flex items-center gap-2 font-semibold mx-auto"><Download size={16} /> Open Export</button>
      {showExport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowExport(false)}>
          <div className="bg-gray-800 rounded-2xl p-5 w-full max-w-lg border border-gray-700 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white flex items-center gap-2"><Download size={16} className="text-emerald-400" /> Export — 2026 Deliverables</h3>
            <div className="mt-4 space-y-2.5">
              {[
                { title: "YouTube 16:9 Hero", spec: "1920×1080 • H.264 • 16 Mbps • 24fps", note: "Satisfaction > watch time" },
                { title: "YouTube Shorts 9:16", spec: "1080×1920 • safe top 100 / bottom 200 • 60s", note: "First frame decisive" },
                { title: "Thumbnails ×3 A/B", spec: "Hook moment + title • high contrast", note: "One improvement compounds" },
              ].map(e => (
                <div key={e.title} className="p-3 bg-gray-900 border border-gray-700 rounded-xl flex justify-between items-center">
                  <div><p className="text-sm font-semibold text-white">{e.title}</p><p className="text-xs text-gray-500">{e.spec}</p><p className="text-[11px] text-violet-300">{e.note}</p></div>
                  <button className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold">Export</button>
                </div>
              ))}
            </div>
            <button onClick={() => setShowExport(false)} className="mt-4 w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
