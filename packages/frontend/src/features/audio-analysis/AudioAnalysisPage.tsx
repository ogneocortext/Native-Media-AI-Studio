import { useState, useEffect } from "react";
import {
  Upload, Music, Zap, Play, Loader2, AlertCircle, BarChart3,
  Database, RefreshCw, ChevronDown, ChevronRight, Activity,
  Clock, TrendingUp, Music2, Pencil,
} from "lucide-react";
import {
  analyzeAudio, analyzeAudioCuda, generateVideoSection,
  listAudioFiles, renameAudioFile, getAnalysis, getCudaStatus,
  getApiBase, type AudioAnalysisResult,
} from "../../services/api";
import { DS, SECTION_COLORS } from "../../styles/designSystem";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  ReferenceLine, BarChart, Bar, Cell,
} from "recharts";

interface BeatDensityPoint {
  bar: number;
  time: number;
  count: number;
  section: string;
  energy: number;
}

function buildBeatDensity(beatTimes: number[], sections: AudioAnalysisResult["sections"], energyCurve: number[], duration: number, tempoBpm: number): BeatDensityPoint[] {
  if (!beatTimes.length) return [];
  const beatInterval = 60 / tempoBpm;
  const barInterval = beatInterval * 4;
  const bars: Map<number, { count: number; beats: number[] }> = new Map();

  for (const t of beatTimes) {
    const barIdx = Math.floor(t / barInterval);
    if (!bars.has(barIdx)) bars.set(barIdx, { count: 0, beats: [] });
    const b = bars.get(barIdx)!;
    b.count++;
    b.beats.push(t);
  }

  const getSection = (t: number) => sections.find(s => t >= s.start && s.end)?.type ?? "full";

  const energyAtTime = (t: number) => {
    if (!energyCurve.length) return 0.5;
    const idx = Math.min(Math.floor((t / duration) * energyCurve.length), energyCurve.length - 1);
    return energyCurve[idx];
  };

  return Array.from(bars.entries()).map(([barIdx, { count, beats }]) => ({
    bar: barIdx,
    time: barIdx * barInterval,
    count,
    section: getSection(beats[0]),
    energy: energyAtTime(beats[0]),
  }));
}

const SECTION_HEX: Record<string, string> = {
  intro: "#3b82f6", verse: "#22c55e", chorus: "#8b5cf6",
  bridge: "#f97316", outro: "#ef4444", full: "#6b7280",
};

const BeatDensityTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <div className={DS.cardTight}>
        <p className="text-xs text-white font-medium capitalize">{d.section} · Bar {d.bar + 1}</p>
        <p className={DS.textXs}>{d.time.toFixed(1)}s · {d.count} beats · {Math.round(d.energy * 100)}% energy</p>
      </div>
    );
  }
  return null;
};

const EnergyBeatTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className={DS.cardTight}>
        <p className="text-xs text-white font-medium">Energy: {payload[0]?.value?.toFixed(0)}%</p>
        <p className={DS.textXs}>Time: {label}{payload[1] ? ` · Beat at ${payload[1].value.toFixed(1)}s` : ""}</p>
      </div>
    );
  }
  return null;
};


interface AudioFile {
  filename: string;
  path: string;
  size_bytes: number;
}

function getEnergyColor(energy: number): string {
  if (energy < 0.3) return "bg-blue-500";
  if (energy < 0.6) return "bg-amber-500";
  return "bg-red-500";
}

export function AudioAnalysisPage() {
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AudioAnalysisResult | null>(null);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedLibraryFile, setSelectedLibraryFile] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "size" | "date">("date");
  const [filterText, setFilterText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [selectedSections, setSelectedSections] = useState<Set<number>>(new Set());
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [pendingGenerateSection, setPendingGenerateSection] = useState<{ type: string; start: number; end: number } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<{ progress: number; message: string } | null>(null);
  const [cudaAvailable, setCudaAvailable] = useState(false);
  const [cudaGpuName, setCudaGpuName] = useState("");
  const [useCuda, setUseCuda] = useState(true);
  const [analysisStep, setAnalysisStep] = useState<string>("");

  useEffect(() => {
    getCudaStatus()
      .then(s => { setCudaAvailable(s.available ?? false); setCudaGpuName(s.gpu_name ?? ""); if (!s.available) setUseCuda(false); })
      .catch(() => { setCudaAvailable(false); setUseCuda(false); });
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    const poll = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/jobs/${activeJobId}`);
        if (res.ok) {
          const job = await res.json();
          setJobProgress({ progress: job.progress ?? 0, message: job.message ?? "" });
          if (job.is_terminal) { setActiveJobId(null); setGenerating(null); if (job.has_error) setError(job.error || "Job failed"); }
        }
      } catch { /* */ }
    };
    const iv = setInterval(poll, 2000);
    poll();
    return () => clearInterval(iv);
  }, [activeJobId]);

  useEffect(() => { loadAudioFiles(); }, []);

  const loadAudioFiles = async () => {
    try { setAudioFiles(await listAudioFiles()); } catch { /* */ }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true); setError(null); setAnalysis(null);
    setAnalysisStep("Uploading audio file...");
    try {
      setAnalysisStep(useCuda && cudaAvailable ? "Analyzing on GPU..." : "Analyzing tempo and beats...");
      const result = (useCuda && cudaAvailable) ? await analyzeAudioCuda(file) : await analyzeAudio(file);
      setAnalysisStep("Detecting song structure...");
      setAnalysis(result);
      setAnalysisStep("");
      loadAudioFiles();
    } catch (err: any) { setError(err.message || "Analysis failed"); setAnalysisStep(""); }
    finally { setAnalyzing(false); }
  };

  const handleAnalyzeLibraryFile = async (storedPath: string) => {
    if (!storedPath || editingFile) return;
    setSelectedLibraryFile(storedPath);
    setAnalyzing(true); setError(null); setAnalysis(null);
    setAnalysisStep("Loading audio file...");
    try {
      const filename = storedPath.split(/[/\\]/).pop() || "audio.mp3";
      const base = getApiBase();
      try {
        const cached = await getAnalysis(filename);
        setAnalysisStep("Retrieving cached analysis...");
        setAnalysis(cached);
        setAnalysisStep(""); setAnalyzing(false); setSelectedLibraryFile(null);
        return;
      } catch { /* no cache */ }
      setAnalysisStep("Analyzing tempo and beats...");
      const response = await fetch(`${base}/api/audio/file/${filename}`);
      if (!response.ok) throw new Error("Failed to load audio file");
      const blob = await response.blob();
      const file = new File([blob], filename, { type: blob.type });
      const result = await analyzeAudio(file);
      setAnalysisStep("Detecting song structure...");
      setAnalysis(result);
      setAnalysisStep("");
    } catch (err: any) { setError(err.message || "Analysis failed"); setAnalysisStep(""); }
    finally { setAnalyzing(false); setSelectedLibraryFile(null); }
  };

  const startEditing = (path: string, currentName: string) => {
    setEditingFile(path);
    setEditName(currentName);
  };

  const saveEdit = async (oldName: string) => {
    const newName = editName.trim();
    setEditingFile(null);
    if (newName && newName !== oldName) {
      try {
        const ext = oldName.includes(".") ? oldName.slice(oldName.lastIndexOf(".")) : "";
        const finalName = newName.includes(".") ? newName : newName + ext;
        await renameAudioFile(oldName, finalName);
        await loadAudioFiles();
      } catch (err) { console.error("Rename failed:", err); setError("Failed to rename file"); }
    }
  };

  const handleGenerateSection = (section: string, start: number, end: number) => {
    if (!analysis?.stored_path) { setError("No analyzed audio file available."); return; }
    setPendingGenerateSection({ type: section, start, end });
    setShowGenerateDialog(true);
  };

  const confirmGenerate = async (method: "comfyui" | "visualization") => {
    if (!pendingGenerateSection) return;
    const { type, start, end } = pendingGenerateSection;
    setShowGenerateDialog(false); setPendingGenerateSection(null);
    setGenerating(type); setError(null);
    try {
      const result = await generateVideoSection({
        prompt: `Music video for ${type} section`, section: type,
        duration: end - start, audio_path: analysis!.stored_path ?? "",
        audio_filename: file?.name || analysis!.stored_path?.split(/[/\\]/).pop() || "audio.mp3", method,
      });
      if (result.success) { setActiveJobId(result.job_id); setJobProgress({ progress: 0, message: `Queued ${type} via ${method === "comfyui" ? "ComfyUI" : "Visualization"}` }); }
      else setError(result.error || "Failed to generate");
    } catch (err: any) { setError(err.message || "Failed to generate"); }
    finally { setGenerating(null); }
  };

  const handleGenerateSelected = async () => {
    if (!analysis?.stored_path || selectedSections.size === 0) return;
    const sections = analysis.sections.filter((_, i) => selectedSections.has(i));
    setShowGenerateDialog(false); setGenerating("selected"); setError(null);
    try {
      for (const section of sections) {
        const result = await generateVideoSection({
          prompt: `Music video for ${section.type} section`, section: section.type,
          duration: section.end - section.start, audio_path: analysis.stored_path ?? "",
          audio_filename: file?.name || analysis.stored_path?.split(/[/\\]/).pop() || "audio.mp3",
        });
        if (!result.success) { setError(result.error || `Failed to generate ${section.type}`); break; }
        setActiveJobId(result.job_id); setJobProgress({ progress: 0, message: `Generating ${section.type}` });
      }
    } catch (err: any) { setError(err.message || "Failed to generate"); }
    finally { setGenerating(null); setSelectedSections(new Set()); }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  const formatFileSize = (b: number) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;

  return (
    <div className={DS.pageWide}>
      <div className={DS.pageTitle}><Music size={22} /> Audio Analysis</div>
      <p className={DS.pageSubtitle}>Upload audio or select from library to detect tempo, beats, and song structure.</p>

      {cudaAvailable && (
        <div className={DS.cardTight}>
          <div className={DS.flexBetween}>
            <div className={DS.flexCenter}><Zap size={16} className="text-green-400" /><span className="text-sm text-green-300 ml-2">CUDA Available</span><span className={DS.textXs + " ml-2"}>{cudaGpuName}</span></div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className={DS.textXs}>Use GPU</span>
              <input type="checkbox" checked={useCuda} onChange={(e) => setUseCuda(e.target.checked)} className="rounded border-gray-600 bg-gray-700 text-green-500 focus:ring-green-500" />
            </label>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setAnalysis(null); } }} onClick={() => (document.getElementById("audio-analysis-file-input") as HTMLInputElement)?.click()} className={`${DS.card} text-center cursor-pointer transition-colors ${dragOver ? "border-violet-500 bg-violet-500/10" : ""}`}>
            <Upload size={40} className="mx-auto mb-3 text-gray-500" />
            {file ? (<div><p className={DS.textBold}>{file.name}</p><p className={DS.textXs}>{(file.size / 1048576).toFixed(2)} MB</p></div>) : (<div><p className={DS.textSm}>Drop audio file here or click to browse</p><p className={DS.textXs}>Supports MP3, WAV, FLAC, OGG</p></div>)}
            <input id="audio-analysis-file-input" type="file" accept="audio/*" onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setAnalysis(null); } }} className="hidden" />
          </div>

          {file && <button onClick={handleAnalyze} disabled={analyzing} className={`${DS.btnPrimary} w-full`}>{analyzing ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}{analyzing ? "Analyzing..." : "Analyze Uploaded File"}</button>}

          {analyzing && analysisStep && (
            <div className={DS.cardTight} style={{ background: "rgba(139,92,246,0.08)", borderColor: "rgba(139,92,246,0.2)" }}>
              <div className={DS.flexCenter}><Loader2 size={16} className="animate-spin text-violet-400" /><span className="text-sm text-violet-300">{analysisStep}</span></div>
            </div>
          )}

          {jobProgress && !analyzing && (
            <div className={DS.cardTight} style={{ background: "rgba(139,92,246,0.08)", borderColor: "rgba(139,92,246,0.2)" }}>
              <div className={DS.flexCenter}><Loader2 size={16} className="animate-spin text-violet-400" /><span className="text-sm text-violet-300">{jobProgress.message}</span></div>
              <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${(jobProgress.progress ?? 0) * 100}%` }} /></div>
            </div>
          )}

          {error && <div className={DS.cardError}><AlertCircle size={20} /><span>{error}</span></div>}

          {analysis && (
            <div className={DS.section}>
              <div className={DS.grid4}>
                <div className={DS.card}><div className={DS.flexCenter}><div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center mr-2"><Music2 size={16} className="text-violet-400" /></div><span className={DS.textBold}>{analysis.tempo_bpm.toFixed(0)}</span></div><p className={DS.textXs}>BPM</p></div>
                <div className={DS.card}><div className={DS.flexCenter}><div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center mr-2"><Clock size={16} className="text-blue-400" /></div><span className={DS.textBold}>{formatTime(analysis.duration_seconds)}</span></div><p className={DS.textXs}>Duration</p></div>
                <div className={DS.card}><div className={DS.flexCenter}><div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center mr-2"><Zap size={16} className="text-amber-400" /></div><span className={DS.textBold}>{analysis.beat_count}</span></div><p className={DS.textXs}>Beats</p></div>
                <div className={DS.card}><div className={DS.flexCenter}><div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center mr-2"><TrendingUp size={16} className="text-emerald-400" /></div><span className={DS.textBold}>{(analysis.confidence * 100).toFixed(0)}%</span></div><p className={DS.textXs}>Confidence</p></div>
              </div>

              {/* Energy + Beats combined chart */}
              <div className={DS.card}>
                <h3 className={DS.sectionTitle}><Activity size={14} />Energy &amp; Beats</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart margin={{ top: 8, right: 5, left: -20, bottom: 5 }}>
                      <defs><linearGradient id="energyGradient2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.6} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                      <XAxis
                        type="number"
                        dataKey="time"
                        domain={[0, analysis.duration_seconds]}
                        tick={{ fontSize: 10, fill: "#9ca3af" }}
                        axisLine={{ stroke: "#374151" }}
                        tickLine={false}
                        tickFormatter={(v) => formatTime(v)}
                      />
                      <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} domain={[0, 100]} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip content={<EnergyBeatTooltip />} />
                      {analysis.sections.map((s, i) => (
                        <ReferenceLine key={i} x={(s.start + s.end) / 2} stroke="#4b5563" strokeDasharray="3 3" strokeWidth={1} />
                      ))}
                      <Area
                        type="monotone"
                        dataKey="energy"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        fill="url(#energyGradient2)"
                        animationDuration={600}
                        dot={false}
                        data={analysis.energy_curve.slice(0, 120).map((e, i) => ({
                          time: (i / analysis.energy_curve!.length) * analysis.duration_seconds,
                          energy: e * 100,
                        }))}
                      />
                      {analysis.beat_times.map((bt, i) => (
                        <ReferenceLine key={`b${i}`} x={bt} stroke="#fbbf24" strokeWidth={1} strokeOpacity={0.6} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {/* Section labels */}
                <div className="flex rounded-lg overflow-hidden h-6 mt-1">
                  {analysis.sections.map((s, i) => (
                    <div key={i} className={`${SECTION_COLORS[s.type] || SECTION_COLORS.full}`} style={{ width: `${((s.end - s.start) / analysis.duration_seconds) * 100}%` }}>
                      <span className="text-[10px] font-medium truncate px-1 leading-6">{s.type}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-1">
                  <span className={DS.textXs}>0:00</span>
                  <span className={DS.textXs}>Purple = energy · Amber lines = beats · Dashed lines = section boundaries</span>
                  <span className={DS.textXs}>{formatTime(analysis.duration_seconds)}</span>
                </div>
              </div>

              {/* Beat Density by Section */}
              {analysis.beat_times.length > 0 && (() => {
                const density = buildBeatDensity(analysis.beat_times, analysis.sections, analysis.energy_curve, analysis.duration_seconds, analysis.tempo_bpm);
                return density.length > 0 ? (
                  <div className={DS.card}>
                    <h3 className={DS.sectionTitle}><BarChart3 size={14} />Beat Density<span className={DS.textXs}>(beats per bar, opacity = energy)</span></h3>
                    <div className="h-28">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={density} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                          <XAxis dataKey="bar" tick={false} axisLine={{ stroke: "#374151" }} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={30} />
                          <Tooltip content={<BeatDensityTooltip />} cursor={{ fill: "rgba(139,92,246,0.1)" }} />
                          <Bar dataKey="count" radius={[2, 2, 0, 0]} animationDuration={400}>
                            {density.map((d, i) => (
                              <Cell key={i} fill={SECTION_HEX[d.section] ?? "#6b7280"} opacity={0.5 + d.energy * 0.5} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Detected Sections */}
              <div className={DS.card}>
                <div className={DS.flexBetween}>
                  <h3 className={DS.sectionTitle}><Activity size={14} />Detected Sections<span className={DS.textXs}>({analysis.sections.length})</span></h3>
                  {selectedSections.size > 0 && <button onClick={() => { setPendingGenerateSection(null); setShowGenerateDialog(true); }} className={DS.btnPrimarySm}>Generate Selected ({selectedSections.size})</button>}
                </div>
                <div className="space-y-2">
                  {analysis.sections.map((section, i) => (
                    <div key={i} className={`flex items-center gap-3 py-2 border-b border-gray-700 last:border-0 ${selectedSections.has(i) ? "bg-violet-500/10 rounded px-2 -mx-2" : ""}`}>
                      <input type="checkbox" checked={selectedSections.has(i)} onChange={e => { const n = new Set(selectedSections); if (e.target.checked) n.add(i); else n.delete(i); setSelectedSections(n); }} className="rounded border-gray-600 bg-gray-700 text-violet-500 focus:ring-violet-500" />
                      <span className={`px-2 py-1 rounded text-xs font-medium shrink-0 ${SECTION_COLORS[section.type] || SECTION_COLORS.full}`}>{section.type}</span>
                      <div className="flex-1 min-w-0">
                        <div className={DS.textXs}>{formatTime(section.start)} → {formatTime(section.end)}<span className="ml-2 text-gray-500">({formatTime(section.end - section.start)})</span></div>
                        <div className="flex items-center gap-2 mt-1"><div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden"><div className={`h-full rounded-full ${getEnergyColor(section.energy)}`} style={{ width: `${section.energy * 100}%` }} /></div><span className={DS.textXs}>{(section.energy * 100).toFixed(0)}%</span></div>
                      </div>
                      <button onClick={() => handleGenerateSection(section.type, section.start, section.end)} disabled={generating === section.type || !analysis?.stored_path} className={DS.btnSecondary} title="Generate video">
                        {generating === section.type ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1 space-y-4 min-w-0">
          <div className={DS.card} style={{ overflow: "hidden" }}>
            <div onClick={() => setShowLibrary(!showLibrary)} className={DS.flexBetween}>
              <span className={DS.sectionTitle}><Database size={14} />Audio Library ({audioFiles.length})</span>
              <div className="flex items-center gap-2">
                <button onClick={e => { e.stopPropagation(); loadAudioFiles(); }} className={DS.btnSecondary}><RefreshCw size={14} /></button>
                {showLibrary ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
            </div>
            {showLibrary && (
              <div className="mt-3">
                <div className="flex gap-2 mb-3">
                  <input type="text" placeholder="Filter files..." value={filterText} onChange={e => { setFilterText(e.target.value); setCurrentPage(1); }} className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500" />
                  <select value={sortBy} onChange={e => { setSortBy(e.target.value as any); setCurrentPage(1); }} className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500">
                    <option value="date">Newest</option><option value="name">Name</option><option value="size">Size</option>
                  </select>
                </div>
                {audioFiles.length > 0 ? (
                  <>
                    <div className="space-y-1">
                      {audioFiles.filter(f => !filterText || f.filename.toLowerCase().includes(filterText.toLowerCase())).sort((a, b) => { if (sortBy === "name") return a.filename.localeCompare(b.filename); if (sortBy === "size") return b.size_bytes - a.size_bytes; return 0; }).slice((currentPage - 1) * pageSize, currentPage * pageSize).map((f, i) => (
                        <div key={i} className={`p-2 rounded-lg cursor-pointer transition-colors ${selectedLibraryFile === f.path && !editingFile ? "bg-violet-500/20 border border-violet-500/30" : "hover:bg-gray-700"}`} onClick={() => handleAnalyzeLibraryFile(f.path)}>
                          <div className={DS.flexBetween}>
                            <div className={DS.flexCenter} style={{ minWidth: 0, flex: 1 }}>
                              <Music size={14} className="shrink-0" />
                              {editingFile === f.path ? (
                                <form onSubmit={async (e) => { e.preventDefault(); e.stopPropagation(); await saveEdit(f.filename); }} onClick={e => e.stopPropagation()} className="flex-1 min-w-0">
                                  <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} className="ml-2 px-1 py-0.5 bg-gray-700 border border-violet-500 rounded text-sm text-white w-full focus:outline-none" />
                                </form>
                              ) : (
                                <span className="text-sm truncate cursor-pointer hover:text-violet-300" onClick={e => { e.stopPropagation(); startEditing(f.path, f.filename); }} title="Click to rename">{f.filename}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={DS.textXs}>{formatFileSize(f.size_bytes)}</span>
                              <button onClick={e => { e.stopPropagation(); startEditing(f.path, f.filename); }} className={`${DS.btnSecondarySm} shrink-0`} title="Rename"><Pencil size={12} /><span className="text-xs ml-1">Rename</span></button>
                              {selectedLibraryFile === f.path && analyzing ? <Loader2 size={12} className="animate-spin text-violet-400" /> : <Play size={12} />}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {audioFiles.filter(f => !filterText || f.filename.toLowerCase().includes(filterText.toLowerCase())).length > pageSize && (
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={DS.btnSecondarySm}>Prev</button>
                        <span className={DS.textXs}>Page {currentPage} of {Math.ceil(audioFiles.filter(f => !filterText || f.filename.toLowerCase().includes(filterText.toLowerCase())).length / pageSize)}</span>
                        <button onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage >= Math.ceil(audioFiles.filter(f => !filterText || f.filename.toLowerCase().includes(filterText.toLowerCase())).length / pageSize)} className={DS.btnSecondarySm}>Next</button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className={DS.textXs}>No audio files in library.<br />Upload a file to add it.</p>
                )}
              </div>
            )}
          </div>
          <div className={DS.card}>
            <h3 className={DS.sectionTitle}>Tips</h3>
            <ul className={DS.textSm}><li>• Click a library file to analyze it</li><li>• Click filename or "Rename" to edit title</li><li>• Upload new files to add them to the library</li><li>• Analysis detects tempo, beats & sections</li></ul>
          </div>
        </div>
      </div>

      {showGenerateDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className={DS.card} style={{ maxWidth: 480, width: "90%" }}>
            <h3 className="text-lg font-bold text-white mb-2">Generate Video</h3>
            <p className="text-sm text-gray-400 mb-4">
              {pendingGenerateSection ? `Generate video for "${pendingGenerateSection.type}" section (${formatTime(pendingGenerateSection.end - pendingGenerateSection.start)})?` : `Generate video for ${selectedSections.size} selected sections?`}
            </p>
            <p className="text-xs text-gray-500 mb-6">ComfyUI creates AI-generated video. Visualization creates audio-reactive video with waveforms.</p>
            <div className="flex gap-3">
              <button onClick={() => pendingGenerateSection ? confirmGenerate("comfyui") : handleGenerateSelected()} className={DS.btnPrimary}>ComfyUI</button>
              <button onClick={() => pendingGenerateSection ? confirmGenerate("visualization") : handleGenerateSelected()} className={DS.btnSecondary}>Visualization</button>
              <button onClick={() => { setShowGenerateDialog(false); setPendingGenerateSection(null); }} className={DS.btnSecondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
