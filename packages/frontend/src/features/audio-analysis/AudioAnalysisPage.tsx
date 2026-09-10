import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Upload, Music, Zap, Play, Loader2, AlertCircle, BarChart3,
  Database, RefreshCw, ChevronDown, ChevronRight, Activity,
  Clock, TrendingUp, Music2, Pencil, Download, SkipForward, ListMusic,
  Sparkles, Type,
} from "lucide-react";
import { getApiBase, getCudaStatus, listAudioFiles, separateAudioStems, renameAudioFile, generateVideoSection } from "../../services/api";
import { isAudioFile } from "../../utils/audioProbe";
import { useAudioAnalysis } from "../../hooks/useAudioAnalysis";
import { DS } from "../../styles/designSystem";
import { useNavigate } from "react-router-dom";
import { setPendingTrack } from "../../utils/pendingTrack";
import {
  ResponsiveContainer,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Area,
  BarChart,
  Bar,
  Cell,
} from "recharts";

interface AudioFile {
  filename: string;
  path: string;
  size_bytes: number;
  modified?: number;
}

interface BeatDensityPoint {
  bar: number;
  time: number;
  count: number;
  section: string;
  energy: number;
}

const SECTION_HEX: Record<string, string> = {
  intro: "#3b82f6", verse: "#22c55e", chorus: "#8b5cf6",
  bridge: "#f97316", outro: "#ef4444", full: "#6b7280",
  "pre-chorus": "#06b6d4", drop: "#ec4899", interlude: "#84cc16", solo: "#f59e0b",
};

function buildBeatDensity(
  beats: number[], sections: { type: string; start: number; end: number; energy: number }[],
  energyCurve: number[], duration: number, bpm: number
): BeatDensityPoint[] {
  const barInterval = 60 / bpm;
  if (!beats.length || !duration) return [];
  const totalBars = Math.floor(duration / barInterval);
  const bars = new Map<number, { count: number; beatTimes: number[] }>();
  for (const bt of beats) {
    const b = Math.min(Math.floor(bt / barInterval), totalBars - 1);
    const prev = bars.get(b);
    if (prev) { prev.count++; prev.beatTimes.push(bt); }
    else bars.set(b, { count: 1, beatTimes: [bt] });
  }
  function getSection(t: number) { const s = sections.find(s => t >= s.start && t <= s.end); return s ? s.type : "full"; }
  function energyAtTime(t: number) {
    if (!energyCurve.length) return 0;
    const idx = Math.round((t / duration) * (energyCurve.length - 1));
    return energyCurve[Math.max(0, Math.min(idx, energyCurve.length - 1))];
  }
  return Array.from(bars.entries()).map(([barIdx, { count, beatTimes: _beatTimes }]) => ({
    bar: barIdx,
    time: barIdx * barInterval,
    count,
    section: getSection(barIdx * barInterval),
    energy: energyAtTime(barIdx * barInterval),
  }));
}

function getEnergyColor(energy: number): string {
  if (energy < 0.3) return "#3b82f6";
  if (energy < 0.6) return "#f59e0b";
  return "#ef4444";
}

interface DisplaySection {
  type: string;
  start: number;
  end: number;
  energy: number;
  parts: number;
  confidence: number;
}

/**
 * Merge adjacent same-type sections (gap < 1s) into blocks.
 * Real analyses often emit chorus ×5 in a row — showing five identical rows
 * (and generating five overlapping clips) is noise. Energy is part-averaged.
 */
function coalesceSections(
  sections: { type: string; start: number; end: number; energy: number; confidence?: number }[],
): DisplaySection[] {
  const out: DisplaySection[] = [];
  for (const s of sections) {
    const last = out[out.length - 1];
    if (last && last.type === s.type && s.start - last.end < 1.0) {
      last.energy = (last.energy * last.parts + s.energy) / (last.parts + 1);
      last.end = s.end;
      last.parts += 1;
      last.confidence = (last.confidence * (last.parts - 1) + (s.confidence ?? 0.7)) / last.parts;
    } else {
      out.push({ ...s, parts: 1, confidence: s.confidence ?? 0.7 });
    }
  }
  return out;
}

const BeatDensityTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: BeatDensityPoint }> }) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload as BeatDensityPoint & Record<string, unknown>;
    return (
      <div className={DS.cardTight}>
        <p className="text-xs text-white font-medium capitalize">{String(d.section)} · Bar {Number(d.bar) + 1}</p>
        <p className={DS.textXs}>{Number(d.time).toFixed(1)}s · {Number(d.count)} beats · {Math.round(Number(d.energy) * 100)}% energy</p>
      </div>
    );
  }
  return null;
};

const EnergyBeatTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className={DS.cardTight}>
        <p className="text-xs text-white font-medium">Energy: {payload[0]?.value?.toFixed(0)}%</p>
        <p className={DS.textXs}>Time: {label}{payload[1] ? ` · Beat at ${payload[1].value?.toFixed(1)}s` : ""}</p>
      </div>
    );
  }
  return null;
};

export function AudioAnalysisPage() {
  const audio = useAudioAnalysis();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [separating, setSeparating] = useState(false);
  const [stemsNote, setStemsNote] = useState<string[] | null>(null);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
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
  const [cudaFallback, setCudaFallback] = useState(false);
  const [useCuda, setUseCuda] = useState(true);
  const [analysisStep, setAnalysisStep] = useState<string>("");
  const [gpuVram, setGpuVram] = useState<{ used: number; total: number; percent: number } | null>(null);

  // Keep local aliases for compatibility with the rest of this component
  const analyzing = audio.analyzing;
  const analysis = audio.analysis;
  const error = audio.error;
  const { setAnalysis, setError } = audio;
  const navigate = useNavigate();

  // Playback of the analyzed track (upload object-URL or library stream) + section seeking
  const uploadAudioRef = useRef<HTMLAudioElement | null>(null);
  const libraryAudioRef = useRef<HTMLAudioElement | null>(null);
  const analyzedFilename = analysis?.stored_path?.split(/[/\\]/).pop() ?? file?.name ?? null;
  const libraryStreamUrl = analyzedFilename && !file
    ? `${getApiBase()}/api/audio/file/${encodeURIComponent(analyzedFilename)}`
    : null;

  const goToKineticTypography = useCallback(() => {
    const filename = analyzedFilename || file?.name;
    if (!filename) return;
    setPendingTrack(filename);
    navigate("/kinetic-typography");
  }, [analyzedFilename, file?.name, navigate]);
  const seekTo = useCallback((t: number) => {
    const el = uploadAudioRef.current || libraryAudioRef.current;
    if (!el) return;
    try {
      el.currentTime = Math.max(0, t);
      void el.play().catch(() => {});
    } catch { /* seek unsupported */ }
  }, []);

  // Coalesced section blocks for display + generation (see coalesceSections)
  const displaySections = useMemo(
    () => (analysis ? coalesceSections(analysis.sections) : []),
    [analysis],
  );

  // Stale selection carried across analyses pointed at wrong rows — reset per track
  const analysisKey = analysis?.stored_path ?? null;
  useEffect(() => { setSelectedSections(new Set()); }, [analysisKey]);

  // One-line insights derived from the real data
  const insights = useMemo(() => {
    if (!analysis || analysis.duration_seconds <= 0) return null;
    const bps = analysis.beat_count / analysis.duration_seconds;
    let peak = displaySections[0];
    for (const s of displaySections) if (!peak || s.energy > peak.energy) peak = s;
    const structure = displaySections
      .map((s) => `${s.type}${s.parts > 1 ? ` ×${s.parts}` : ""}`)
      .join(" → ");
    return { bps, peak, structure };
  }, [analysis, displaySections]);

  useEffect(() => {
    getCudaStatus()
      .then(s => {
        setCudaAvailable(s.available ?? false);
        setCudaGpuName(s.gpu_name ?? "");
        setCudaFallback((s as unknown as Record<string, unknown>).fallback === "torch.cuda");
        if (!s.available) setUseCuda(false);
        fetch(`${getApiBase()}/api/health/gpu`).then(r => r.json()).then(g => {
          if (g.available) setGpuVram({ used: g.memory_used_mb ?? 0, total: g.memory_total_mb ?? 8192, percent: g.memory_percent ?? 0 });
        }).catch((e) => console.warn("GPU health check failed:", e));
      })
      .catch(() => { setCudaAvailable(false); setUseCuda(false); });
  }, []);

  // Manage preview URL lifecycle
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Close the generate dialog with Escape
  useEffect(() => {
    if (!showGenerateDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setShowGenerateDialog(false); setPendingGenerateSection(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showGenerateDialog]);

  const validateFile = (f: File): string | null => {
    // Shared probe util (MIME may be empty/unreliable on Windows) + explicit
    // extension check covering everything the backend accepts.
    const extOk = /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|wma|mp4)$/i.test(f.name);
    if (!isAudioFile(f) && !extOk) return `Unsupported format: ${f.name.split(".").pop()}. Use MP3, WAV, FLAC, OGG, OPUS, M4A, AAC, WMA.`;
    if (f.size > 500 * 1024 * 1024) return `File too large (${(f.size / 1048576).toFixed(1)} MB). Max 500 MB.`;
    if (f.size === 0) return `File is empty.`;
    return null;
  };

  const handleFileSelect = (f: File) => {
    const err = validateFile(f);
    if (err) { setFileError(err); setFile(null); return; }
    setFileError(null); setFile(f); audio.reset();
  };

  const clearFile = () => { setFile(null); setPreviewUrl(null); setFileError(null); audio.reset(); };

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
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      setAudioFiles(await listAudioFiles());
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "Could not load library");
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    const vErr = validateFile(file);
    if (vErr) { setFileError(vErr); return; }
    setAnalysisStep(useCuda && cudaAvailable ? `Analyzing on GPU${cudaFallback ? " (compat mode)" : ""}...` : "Analyzing tempo and beats...");
    const result = await audio.analyze(file, "sonara", useCuda && cudaAvailable);
    if (result) {
      setAnalysisStep("Detecting song structure...");
      loadAudioFiles();
    }
    setAnalysisStep("");
  };

  const handleSeparate = async () => {
    if (!file) return;
    const vErr = validateFile(file);
    if (vErr) { setFileError(vErr); return; }
    setSeparating(true); setError(null); setStemsNote(null);
    setAnalysisStep("Separating stems with Demucs...");
    try {
      const result = await separateAudioStems(file, "htdemucs");
      if (result.error) {
        setError(result.error);
      } else {
        const names = Object.keys(result.stems);
        setStemsNote(names);
        setAnalysisStep(`Separated ${names.length} stems`);
        setTimeout(() => setAnalysisStep(""), 2500);
        loadAudioFiles();
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Separation failed"); setAnalysisStep(""); }
    finally { setSeparating(false); }
  };

  const handleAnalyzeLibraryFile = async (storedPath: string) => {
    if (!storedPath || editingFile) return;
    setSelectedLibraryFile(storedPath);
    setAnalysisStep("Loading audio file...");
    try {
      const filename = storedPath.split(/[/\\]/).pop() || "audio.mp3";
      // ensure-analysis returns cached analysis immediately when available
      const ensured = await audio.ensure(filename, "sonara");
      if (ensured && ensured.analysis) {
        setAnalysisStep("Detecting song structure...");
        setAnalysis(ensured.analysis);
      }
      setAnalysisStep("");
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Analysis failed"); setAnalysisStep(""); }
    finally { setSelectedLibraryFile(null); }
  };

  // Media Library preselection: auto-analyze ?file=filename on mount.
  const hasAutoAnalyzed = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fileParam = params.get("file");
    if (!fileParam || hasAutoAnalyzed.current) return;
    if (audioFiles.length === 0) return;

    hasAutoAnalyzed.current = true;
    const match = audioFiles.find(f => f.filename === fileParam);
    if (match) {
      handleAnalyzeLibraryFile(match.path);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [audioFiles, handleAnalyzeLibraryFile]);

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
    const genKey = `${type}@${start}`;
    setGenerating(genKey); setError(null);
    try {
      const result = await generateVideoSection({
        prompt: `Music video for ${type} section`, section: type,
        duration: end - start, audio_path: analysis!.stored_path ?? "",
        audio_filename: file?.name || analysis!.stored_path?.split(/[/\\]/).pop() || "audio.mp3", method,
      });
      if (result.success) { setActiveJobId(result.job_id); setJobProgress({ progress: 0, message: `Queued ${type} via ${method === "comfyui" ? "ComfyUI" : "Visualization"}` }); }
      else setError(result.error || "Failed to generate");
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to generate"); }
    finally { setGenerating(null); }
  };

  const handleGenerateSelected = async (method: "comfyui" | "visualization" = "comfyui") => {
    if (!analysis?.stored_path || selectedSections.size === 0) return;
    const sections = displaySections.filter((_, i) => selectedSections.has(i));
    setShowGenerateDialog(false); setGenerating("selected"); setError(null);
    try {
      for (const section of sections) {
        const result = await generateVideoSection({
          prompt: `Music video for ${section.type} section`, section: section.type,
          duration: section.end - section.start, audio_path: analysis.stored_path ?? "",
          audio_filename: file?.name || analysis.stored_path?.split(/[/\\]/).pop() || "audio.mp3", method,
        });
        if (!result.success) { setError(result.error || `Failed to generate ${section.type}`); break; }
        setActiveJobId(result.job_id); setJobProgress({ progress: 0, message: `Generating ${section.type}` });
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to generate"); }
    finally { setGenerating(null); setSelectedSections(new Set()); }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  const formatFileSize = (b: number) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;

  const exportAnalysis = () => {
    if (!analysis) return;
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(file?.name || analysis.stored_path?.split(/[/\\]/).pop() || "analysis").replace(/\.[^.]+$/, "")}-analysis.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const waveformRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const envelope = analysis?.amplitude_envelope;
    const host = waveformRef.current;
    if (!envelope?.length || !host) return;
    const draw = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = host.getBoundingClientRect();
      if (rect.width === 0) return;
      canvas.width = rect.width * dpr;
      canvas.height = 80 * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `80px`;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, 80);
      const mid = 40;
      const step = rect.width / envelope.length;
      const trace = (mirror: 1 | -1, alpha: number) => {
        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let i = 0; i < envelope.length; i++) {
          ctx.lineTo(i * step, mid + mirror * envelope[i] * 36);
        }
        ctx.strokeStyle = "#8b5cf6";
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      trace(-1, 1);
      trace(1, 0.35);
      host.innerHTML = "";
      host.appendChild(canvas);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(host);
    return () => ro.disconnect();
  }, [analysis?.amplitude_envelope]);

  return (
    <div className={DS.pageWide}>
      <div className={DS.pageTitle}><Music size={22} /> Audio Analysis</div>
      <p className={DS.pageSubtitle}>Upload audio or select from library to detect tempo, beats, and song structure.</p>

      {/* GPU status banner — always visible for clarity */}
      <div className={`${DS.cardTight} ${cudaAvailable ? "border-green-500/30 bg-green-500/5" : "border-amber-500/20 bg-amber-500/5"}`} role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <Zap size={16} className={`shrink-0 ${cudaAvailable ? "text-green-400" : "text-amber-400"}`} />
            <span className={`text-sm ${cudaAvailable ? "text-green-300" : "text-amber-300"}`}>{cudaAvailable ? (cudaFallback ? "CUDA Available (compat)" : "CUDA Available") : "CPU Mode"}</span>
            <span className={DS.textXs + " truncate"}>{cudaAvailable ? cudaGpuName : "GPU not detected — using CPU fallback"}</span>
            {cudaAvailable && gpuVram && (
              <span className={DS.badge + " tabular-nums"}>
                {(gpuVram.used / 1024).toFixed(1)}/{(gpuVram.total / 1024).toFixed(1)} GB · {gpuVram.percent.toFixed(0)}%
              </span>
            )}
            {cudaAvailable && cudaFallback && <span className={DS.badgeBlue} title="NVML unavailable, using torch.cuda fallback">fallback</span>}
          </div>
          {cudaAvailable && (
            <label className="flex items-center gap-2 cursor-pointer shrink-0" title={useCuda ? "GPU acceleration on" : "CPU only"}>
              <span className={DS.textXs}>{useCuda ? "GPU on" : "GPU off"}</span>
              <input type="checkbox" checked={useCuda} onChange={(e) => setUseCuda(e.target.checked)} className="rounded border-gray-600 bg-gray-700 text-green-500 focus:ring-green-500" aria-label="Toggle GPU acceleration" />
            </label>
          )}
        </div>
        {!cudaAvailable && <p className={DS.textXs + " mt-1"}>CPU analysis is slower but works for any file.</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); setDragOver(false); }}
            onClick={() => !file && (document.getElementById("audio-analysis-file-input") as HTMLInputElement)?.click()}
            className={`${DS.card} text-center transition-all duration-200 ${file ? "border-violet-500/30 bg-violet-500/5" : dragOver ? "border-violet-500 bg-violet-500/10 scale-[1.01]" : "border-dashed border-2 hover:border-gray-500 cursor-pointer hover:bg-gray-800/50"}`}
            role="button" aria-label="Upload audio file" tabIndex={0}
            onKeyDown={e => { if (e.key === "Enter" && !file) (document.getElementById("audio-analysis-file-input") as HTMLInputElement)?.click(); }}
          >
            <Upload size={36} className="mx-auto mb-3 text-gray-500" />
            {file ? (
              <div>
                <p className={DS.textBold}>{file.name}</p>
                <p className={DS.textXs}>{(file.size / 1048576).toFixed(2)} MB · {file.type || "audio/*"}</p>
                {previewUrl && <audio ref={uploadAudioRef} controls src={previewUrl} className="w-full mt-3 rounded" aria-label={`Preview ${file.name}`} />}
                <button onClick={e => { e.stopPropagation(); clearFile(); }} className={DS.btnSecondarySm + " mt-3 mx-auto"} aria-label="Clear selected file">Clear</button>
              </div>
            ) : (
              <div><p className="text-sm text-gray-300 font-medium">Drop audio file here or click to browse</p><p className={DS.textXs + " mt-1"}>Supports MP3, WAV, FLAC, OGG, OPUS, M4A, AAC, WMA · Max 500 MB</p></div>
            )}
            <input id="audio-analysis-file-input" type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,.wma" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} className="hidden" />
          </div>
          {fileError && <div className={DS.cardError} role="alert"><AlertCircle size={16} /><span className="text-sm">{fileError}</span></div>}

          {file && <button onClick={handleAnalyze} disabled={analyzing || separating} className={`${DS.btnPrimary} w-full`} aria-busy={analyzing}>{analyzing ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}{analyzing ? "Analyzing..." : "Analyze"}</button>}
          {file && !analyzing && <button onClick={handleSeparate} disabled={separating || analyzing} className={`${DS.btnSecondary} w-full mt-2`} aria-busy={separating} title="Split into vocals, drums, bass and more with Demucs (slow, GPU recommended)">{separating ? <Loader2 size={18} className="animate-spin" /> : <Music2 size={18} />}{separating ? "Separating stems..." : "Separate Stems (optional)"}</button>}

          {stemsNote && !separating && (
            <div className={DS.cardTight + " border-green-500/30 bg-green-500/5"} role="status">
              <p className="text-sm text-green-300">Separated {stemsNote.length} stems — saved to the library:</p>
              <p className={DS.textXs + " mt-1 break-words"}>{stemsNote.join(" · ")}</p>
            </div>
          )}

          {analyzing && analysisStep && (
            <div className={DS.cardTight} style={{ background: "rgba(139,92,246,0.08)", borderColor: "rgba(139,92,246,0.2)" }} role="status" aria-live="polite">
              <div className={DS.flexBetween}><div className={DS.flexCenter}><Loader2 size={16} className="animate-spin text-violet-400" /><span className="text-sm text-violet-300">{analysisStep}</span></div><span className={DS.textXs}>{analyzing ? "This may take 10–30s for long tracks" : ""}</span></div>
            </div>
          )}

          {jobProgress && !analyzing && (
            <div className={DS.cardTight} style={{ background: "rgba(139,92,246,0.08)", borderColor: "rgba(139,92,246,0.2)" }} role="status" aria-live="polite">
              <div className={DS.flexCenter}><Loader2 size={16} className="animate-spin text-violet-400" /><span className="text-sm text-violet-300">{jobProgress.message}</span></div>
              <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden" aria-label={`Progress ${Math.round((jobProgress.progress ?? 0) * 100)}%`}><div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${(jobProgress.progress ?? 0) * 100}%` }} /></div>
            </div>
          )}

           {error && <div className={DS.cardError} role="alert"><AlertCircle size={20} /><div className="flex-1"><p className="text-sm font-medium">{error}</p><button onClick={() => setError(null)} className="text-xs underline mt-1">Dismiss</button></div></div>}

          {analysis && (
            <div className={DS.section}>
              <div className={DS.grid4}>
                <div className={`${DS.card} border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-transparent`}>
                  <div className={DS.flexCenter}>
                    <div className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center mr-3"><Music2 size={18} className="text-violet-400" /></div>
                    <span className={DS.textBoldXl}>{analysis.tempo_bpm.toFixed(0)}</span>
                  </div>
                  <p className={DS.textXs + " mt-1.5"}>BPM</p>
                </div>
                <div className={`${DS.card} border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-transparent`}>
                  <div className={DS.flexCenter}>
                    <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center mr-3"><Clock size={18} className="text-blue-400" /></div>
                    <span className={DS.textBoldXl}>{formatTime(analysis.duration_seconds)}</span>
                  </div>
                  <p className={DS.textXs + " mt-1.5"}>Duration</p>
                </div>
                <div className={`${DS.card} border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-transparent`}>
                  <div className={DS.flexCenter}>
                    <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center mr-3"><Zap size={18} className="text-amber-400" /></div>
                    <span className={DS.textBoldXl}>{analysis.beat_count}</span>
                  </div>
                  <p className={DS.textXs + " mt-1.5"}>Beats</p>
                </div>
                <div className={`${DS.card} border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent`}>
                  <div className={DS.flexCenter}>
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center mr-3"><TrendingUp size={18} className="text-emerald-400" /></div>
                    <span className={DS.textBoldXl}>{(analysis.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className={DS.textXs + " mt-1.5"}>Confidence</p>
                </div>
              </div>

              {/* Insights + playback */}
              {insights && (
                <div className={`${DS.cardTight} border-l-4 border-l-violet-500 bg-violet-500/5`}>
                  <p className="text-sm text-gray-200 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ListMusic size={14} className="text-violet-400 shrink-0" />
                    <span className="capitalize font-medium">{insights.structure}</span>
                  </p>
                  <p className={DS.textXs + " mt-1.5 tabular-nums text-gray-400"}>
                    {insights.bps.toFixed(1)} beats/s
                    {insights.peak && (
                      <> · Peak <strong className="text-white capitalize">{insights.peak.type}</strong> {formatTime(insights.peak.start)}–{formatTime(insights.peak.end)} ({(insights.peak.energy * 100).toFixed(0)}%)</>
                    )}
                    {displaySections.some((s) => s.parts > 1) && (
                      <> · {analysis.sections.length} raw sections merged into {displaySections.length} blocks</>
                    )}
                    <> · Avg confidence <strong className="text-white">{(displaySections.reduce((a, s) => a + s.confidence, 0) / displaySections.length * 100).toFixed(0)}%</strong></>
                  </p>
                </div>
              )}

              {/* Next step: Kinetic Typography */}
              {analysis && (
                <div className={`${DS.card} border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-transparent hover:border-violet-500/40 transition-colors cursor-pointer`} onClick={goToKineticTypography} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") goToKineticTypography(); }}>
                  <div className={DS.flexBetween}>
                    <div className={DS.flexCenter}>
                      <div className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center mr-3"><Type size={18} className="text-violet-400" /></div>
                      <div>
                        <p className="text-sm font-bold text-white">Kinetic Typography</p>
                        <p className={DS.textXs + " text-gray-400"}>Create animated lyric visuals for this track</p>
                      </div>
                    </div>
                    <span className="text-violet-300 text-sm font-medium">Open →</span>
                  </div>
                </div>
              )}

              {/* Mini waveform + quick actions */}
              <div className={DS.card}>
                <div className={DS.flexBetween}>
                  <h3 className={DS.sectionTitle}>Waveform</h3>
                  <div className="flex gap-2">
                    <button onClick={exportAnalysis} className={DS.btnSecondarySm} title="Download analysis JSON"><Download size={14} /> Export</button>
                  </div>
                </div>
                {libraryStreamUrl && (
                  <audio
                    ref={libraryAudioRef}
                    controls
                    src={libraryStreamUrl}
                    className="w-full mt-2 rounded"
                    aria-label={`Play ${analyzedFilename}`}
                  />
                )}
                <div ref={waveformRef} className="w-full h-20 bg-gray-900/40 rounded-lg border border-gray-700 overflow-hidden mt-2" />
                {libraryStreamUrl && (
                  <p className={DS.textXs + " mt-1.5"}>Tip: section timestamps below seek this player.</p>
                )}
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
                      {displaySections.map((s, i) => (
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
                        data={(() => {
                          const curve = analysis.energy_curve;
                          const maxPts = 120;
                          const step = Math.max(1, Math.floor(curve.length / maxPts));
                          const sampled = curve.filter((_, i) => i % step === 0);
                          return sampled.map((e, i) => ({
                            time: (i / sampled.length) * analysis.duration_seconds,
                            energy: e * 100,
                          }));
                        })()}
                      />
                       {/* Sample beats to avoid clutter — show fewer lines on longer tracks */}
                       {analysis.beat_times.filter((_, i) => {
                         const len = analysis.beat_times.length;
                         if (len <= 40) return true;
                         const step = Math.max(1, Math.floor(len / 40));
                         return i % step === 0;
                       }).map((bt, i) => (
                         <ReferenceLine key={`b${i}`} x={bt} stroke="#fbbf24" strokeWidth={1} strokeOpacity={0.25} />
                       ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {/* Section labels */}
                <div className="flex rounded-lg overflow-hidden h-6 mt-1" role="img" aria-label="Song sections">
                  {displaySections.map((s, i) => (
                    <div key={i} className="flex items-center justify-center" style={{ width: `${((s.end - s.start) / analysis.duration_seconds) * 100}%`, backgroundColor: SECTION_HEX[s.type] || SECTION_HEX.full }} title={`${s.type}${s.parts > 1 ? ` (×${s.parts} merged)` : ""}: ${formatTime(s.start)}–${formatTime(s.end)} ${Math.round(s.energy * 100)}%`}>
                      <span className="text-[10px] font-medium truncate px-1 leading-6 text-white">{s.type}{s.parts > 1 ? ` ×${s.parts}` : ""}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3 mt-2">
                  {(() => {
                    const seen = new Set<string>();
                    return analysis.sections.filter(s => { if (seen.has(s.type)) return false; seen.add(s.type); return true; }).map(s => (
                      <span key={s.type} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SECTION_HEX[s.type] || SECTION_HEX.full }} />
                        <span className="text-xs capitalize text-gray-300">{s.type}</span>
                      </span>
                    ));
                  })()}
                </div>
                <div className="flex justify-between mt-1">
                  <span className={DS.textXs}>0:00</span>
                  <span className={DS.textXs}>Purple = energy · Amber = beats (sampled) · Dashed = sections</span>
                  <span className={DS.textXs}>{formatTime(analysis.duration_seconds)}</span>
                </div>
              </div>

              {/* Beat Density by Section */}
              {analysis.beat_times.length > 0 && (() => {
                const raw = buildBeatDensity(analysis.beat_times, analysis.sections, analysis.energy_curve, analysis.duration_seconds, analysis.tempo_bpm);
                const maxBars = 100;
                const step = Math.max(1, Math.floor(raw.length / maxBars));
                const density = raw.filter((_, i) => i % step === 0);
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
                    <div className="flex justify-between mt-1">
                      <span className={DS.textXs + " tabular-nums"}>{formatTime(density[0]?.time ?? 0)}</span>
                      <span className={DS.textXs}>{density.length} bars</span>
                      <span className={DS.textXs + " tabular-nums"}>{formatTime(analysis.duration_seconds)}</span>
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Detected Sections */}
              <div className={DS.card}>
                <div className={DS.flexBetween}>
                  <h3 className={DS.sectionTitle}><Activity size={16} />Detected Sections<span className={DS.textXs + " ml-2"}>({displaySections.length}{displaySections.length !== analysis.sections.length ? ` · ${analysis.sections.length} merged` : ""}) · check to batch-generate</span></h3>
                  <div className="flex gap-2">
                    {displaySections.length > 1 && <button onClick={() => setSelectedSections(new Set(displaySections.map((_, i) => i)))} className={DS.btnSecondarySm}>Select all</button>}
                    <button onClick={exportAnalysis} className={DS.btnSecondarySm} title="Export analysis JSON"><Download size={14} />Export</button>
                    {selectedSections.size > 0 && <button onClick={() => { setPendingGenerateSection(null); setShowGenerateDialog(true); }} className={DS.btnPrimarySm}>Generate Selected ({selectedSections.size})</button>}
                  </div>
                </div>
                <div className="space-y-1.5" role="list" aria-label="Song sections">
                  {displaySections.map((section, i) => (
                    <div key={i} role="listitem" className={`flex items-center gap-3 py-2.5 px-3 rounded-lg border transition-colors ${selectedSections.has(i) ? "bg-violet-500/10 border-violet-500/30" : "bg-gray-800/50 border-gray-700/50 hover:border-gray-600"}`}>
                      <input type="checkbox" checked={selectedSections.has(i)} onChange={e => { const n = new Set(selectedSections); if (e.target.checked) n.add(i); else n.delete(i); setSelectedSections(n); }} className="rounded border-gray-600 bg-gray-700 text-violet-500 focus:ring-violet-500 shrink-0" aria-label={`Select ${section.type} ${formatTime(section.start)} to ${formatTime(section.end)}`} />
                      <span className="px-2 py-1 rounded-md text-xs font-semibold shrink-0 text-white" style={{ backgroundColor: SECTION_HEX[section.type] || SECTION_HEX.full }}>
                        {section.type}{section.parts > 1 ? ` ×${section.parts}` : ""}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={DS.textXs}>
                          <button onClick={() => seekTo(section.start)} className="hover:text-violet-300 underline decoration-dotted underline-offset-2 tabular-nums font-medium" title={`Play from ${formatTime(section.start)}`}>
                            {formatTime(section.start)} → {formatTime(section.end)}
                          </button>
                          <span className="ml-2 text-gray-500 tabular-nums">({formatTime(section.end - section.start)})</span>
                          <span className="ml-2 text-gray-500 tabular-nums">· {(section.confidence * 100).toFixed(0)}% conf</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1" aria-label={`Energy ${Math.round(section.energy * 100)}%`}><div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${section.energy * 100}%`, backgroundColor: getEnergyColor(section.energy) }} /></div><span className={DS.textXs + " tabular-nums text-gray-400"}>{(section.energy * 100).toFixed(0)}%</span></div>
                      </div>
                      <button onClick={() => seekTo(section.start)} className="p-2 rounded-lg text-muted hover:text-white hover:bg-white/10 shrink-0 transition-colors" title={`Preview from ${formatTime(section.start)}`} aria-label={`Preview ${section.type} from ${formatTime(section.start)}`}>
                        <SkipForward size={14} />
                      </button>
                      <button onClick={() => handleGenerateSection(section.type, section.start, section.end)} disabled={generating === `${section.type}@${section.start}` || generating === "selected" || !analysis?.stored_path} className={`${DS.btnSecondarySm} shrink-0`} title={`Generate video for ${section.type}`} aria-label={`Generate ${section.type}`}>
                        {generating === `${section.type}@${section.start}` ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
                <p className={DS.textXs + " mt-2"}>Timestamps seek the player · <Play size={10} className="inline" /> generates one block · check multiple then “Generate Selected”.</p>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1 space-y-5 min-w-0">
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
                  <select value={sortBy} onChange={e => { setSortBy(e.target.value as "name" | "size" | "date"); setCurrentPage(1); }} className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500">
                    <option value="date">Newest</option><option value="name">Name</option><option value="size">Size</option>
                  </select>
                </div>
                {(() => {
                  const filtered = audioFiles.filter(f => !filterText || f.filename.toLowerCase().includes(filterText.toLowerCase()));
                  const sorted = [...filtered].sort((a, b) => {
                    if (sortBy === "name") return a.filename.localeCompare(b.filename);
                    if (sortBy === "size") return b.size_bytes - a.size_bytes;
                    return (b.modified ?? 0) - (a.modified ?? 0);
                  });
                  const analyzedName = analysis?.stored_path?.split(/[/\\]/).pop();
                  const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
                  if (libraryLoading && audioFiles.length === 0) {
                    return <p className={DS.textXs + " py-4 text-center"}><Loader2 size={14} className="animate-spin inline mr-1" />Loading library…</p>;
                  }
                  if (libraryError && audioFiles.length === 0) {
                    return <p className={DS.cardWarning}>Library failed to load: {libraryError}. <button onClick={loadAudioFiles} className="underline">Retry</button></p>;
                  }
                  if (filtered.length === 0 && audioFiles.length > 0) return <p className={DS.cardWarning}>No files match “{filterText}”. <button onClick={() => setFilterText("")} className="underline">Clear filter</button></p>;
                  return filtered.length > 0 ? (
                  <>
                    <p className={DS.textXs + " mb-2"}>{filtered.length} file{filtered.length !== 1 ? "s" : ""} {filterText ? "matching filter" : "in library"}</p>
                    <div className="space-y-1" role="list" aria-label="Audio files">
                       {paged.map((f) => {
                         const isActive = selectedLibraryFile === f.path && !editingFile;
                         const isAnalyzed = analyzedName === f.filename;
                         return (
                         <div
                           key={f.path}
                           role="listitem"
                           tabIndex={0}
                           aria-label={`Analyze ${f.filename}`}
                           title={isAnalyzed ? `${f.filename} — currently analyzed` : `Analyze ${f.filename} (cached when available)`}
                           className={`p-2.5 rounded-lg cursor-pointer transition-all ${isActive ? "bg-violet-500/15 border border-violet-500/30 shadow-sm" : isAnalyzed ? "border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10" : "border border-transparent hover:bg-gray-700/50"}`}
                           onClick={() => handleAnalyzeLibraryFile(f.path)}
                           onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && editingFile !== f.path) { e.preventDefault(); handleAnalyzeLibraryFile(f.path); } }}
                         >
                           <div className={DS.flexBetween}>
                             <div className={DS.flexCenter} style={{ minWidth: 0, flex: 1 }}>
                               {isActive && analyzing
                                 ? <Loader2 size={14} className="animate-spin text-violet-400 shrink-0" />
                                 : <Music size={14} className={`shrink-0 ${isAnalyzed ? "text-emerald-400" : "text-gray-500"}`} />}
                               {editingFile === f.path ? (
                                 <form onSubmit={async (e) => { e.preventDefault(); e.stopPropagation(); await saveEdit(f.filename); }} onClick={e => e.stopPropagation()} className="flex-1 min-w-0">
                                   <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setEditingFile(null); }} className="ml-2 px-1.5 py-0.5 bg-gray-700 border border-violet-500 rounded text-sm text-white w-full focus:outline-none" aria-label="New file name" />
                                 </form>
                               ) : (
                                 <span className="text-sm truncate ml-2 text-gray-200" title={f.filename}>{f.filename}</span>
                               )}
                               {isAnalyzed && editingFile !== f.path && (
                                 <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-medium shrink-0">Analyzed</span>
                               )}
                             </div>
                             <div className="flex items-center gap-1.5 shrink-0 ml-2">
                               <span className={DS.textXs + " tabular-nums text-gray-500"}>{formatFileSize(f.size_bytes)}</span>
                               <button
                                 onClick={e => { e.stopPropagation(); startEditing(f.path, f.filename); }}
                                 className="p-1.5 rounded text-muted hover:text-white hover:bg-white/10 transition-colors"
                                 title={`Rename ${f.filename}`}
                                 aria-label={`Rename ${f.filename}`}
                               >
                                 <Pencil size={12} />
                               </button>
                             </div>
                           </div>
                         </div>
                         );
                       })}
                    </div>
                    {filtered.length > pageSize && (
                      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-700">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={DS.btnSecondarySm + " shrink-0"}>← Prev</button>
                        <span className={DS.textXs + " tabular-nums whitespace-nowrap"}>Page {currentPage} of {Math.ceil(filtered.length / pageSize)}</span>
                        <button onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage >= Math.ceil(filtered.length / pageSize)} className={DS.btnSecondarySm + " shrink-0"}>Next →</button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className={DS.textXs}>No audio files in library.<br />Upload a file to add it.</p>
                ); })()}
              </div>
            )}
          </div>
          <details className={DS.card} style={{ overflow: "hidden" }}>
            <summary className={DS.sectionTitle + " cursor-pointer list-none flex items-center justify-between"}>
              <span>Tips</span>
              <span className={DS.textXs}>show</span>
            </summary>
            <ul className={DS.textSm + " mt-2 space-y-1.5"}>
              <li>• <strong>Analyze:</strong> click a library file (cached results load instantly) or upload + Analyze. The green badge marks what's loaded.</li>
              <li>• <strong>Uploads:</strong> drag & drop MP3/WAV/FLAC/OGG/OPUS/M4A/AAC/WMA (≤500 MB) onto the upload zone.</li>
              <li>• <strong>Rename:</strong> pencil icon on any row; <kbd className="px-1 rounded bg-gray-700">Esc</kbd> cancels.</li>
              <li>• <strong>Stems:</strong> Separate Stems is slow (Demucs) — results land back in the library.</li>
              <li>• <strong>Batch generate:</strong> check sections → “Generate Selected”, or play per row.</li>
            </ul>
          </details>
        </div>
      </div>

      {showGenerateDialog && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => { setShowGenerateDialog(false); setPendingGenerateSection(null); }}
          role="presentation"
        >
          <div
            className={DS.card}
            style={{ maxWidth: 520, width: "92%" }}
            role="dialog"
            aria-modal="true"
            aria-label="Generate video"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-1">Generate Video</h3>
            <p className="text-sm text-gray-400 mb-5">
              {pendingGenerateSection ? `Generate video for "${pendingGenerateSection.type}" section (${formatTime(pendingGenerateSection.end - pendingGenerateSection.start)})?` : `Generate video for ${selectedSections.size} selected sections?`}
            </p>
            <p className="text-xs text-gray-500 mb-5">Choose a generation method. ComfyUI uses AI image models; Visualization creates audio-reactive motion graphics.</p>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <button onClick={() => pendingGenerateSection ? confirmGenerate("comfyui") : handleGenerateSelected("comfyui")} className={`${DS.card} hover:border-violet-500/40 text-left p-4 transition-colors group`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center group-hover:bg-violet-500/30 transition-colors">
                    <Sparkles size={16} className="text-violet-400" />
                  </div>
                  <span className="text-sm font-bold text-white">ComfyUI</span>
                </div>
                <p className="text-xs text-gray-400">AI-generated visuals from text prompts. Best for cinematic, stylized scenes.</p>
              </button>
              <button onClick={() => pendingGenerateSection ? confirmGenerate("visualization") : handleGenerateSelected("visualization")} className={`${DS.card} hover:border-blue-500/40 text-left p-4 transition-colors group`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                    <Activity size={16} className="text-blue-400" />
                  </div>
                  <span className="text-sm font-bold text-white">Visualization</span>
                </div>
                <p className="text-xs text-gray-400">Audio-reactive waveforms and particles. Best for lyric videos and abstract visuals.</p>
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={() => { setShowGenerateDialog(false); setPendingGenerateSection(null); }} className={DS.btnSecondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
