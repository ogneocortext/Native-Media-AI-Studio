import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Music,
  Zap,
  Play,
  Loader2,
  AlertCircle,
  BarChart3,
  Database,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Activity,
  Clock,
  TrendingUp,
  Music2,
  Pencil,
} from "lucide-react";
import {
  analyzeAudio,
  generateVideoSection,
  listAudioFiles,
  renameAudioFile,
  getApiBase,
  type AudioAnalysisResult,
} from "../../services/api";
import { DS, SECTION_COLORS } from "../../styles/designSystem";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface AudioFile {
  filename: string;
  path: string;
  size_bytes: number;
}

const EnergyTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="aa-card" style={{ padding: "0.5rem" }}>
        <p className="text-xs text-white font-medium">Energy: {(payload[0].value * 100).toFixed(0)}%</p>
        <p className="text-[10px] text-gray-400">Time: {label}</p>
      </div>
    );
  }
  return null;
};

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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadAudioFiles();
  }, []);

  // Draw energy curve on canvas
  useEffect(() => {
    if (!analysis?.energy_curve?.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const data = analysis.energy_curve;
    const barW = w / data.length;

    ctx.clearRect(0, 0, w, h);
    data.forEach((energy, i) => {
      const barH = energy * h * 0.9;
      const x = i * barW;
      const y = h - barH;

      const gradient = ctx.createLinearGradient(0, y, 0, h);
      gradient.addColorStop(0, energy > 0.6 ? "#f59e0b" : energy > 0.3 ? "#3b82f6" : "#22c55e");
      gradient.addColorStop(1, "rgba(0,0,0,0.3)");

      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barW - 1, barH);
    });

    // Draw section boundaries
    if (analysis.sections) {
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      analysis.sections.forEach((s) => {
        const x = (s.start / analysis.duration_seconds) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }
  }, [analysis]);

  const loadAudioFiles = async () => {
    try {
      const files = await listAudioFiles();
      setAudioFiles(files);
    } catch {
      // Backend may not be running
    }
  };

  const handleGenerateSection = async (section: string, start: number, end: number) => {
    if (!analysis?.stored_path) return;
    setGenerating(section);
    try {
      await generateVideoSection({
        prompt: `Music video for ${section} section`,
        section,
        duration: end - start,
        audio_path: analysis.stored_path,
        audio_filename: file?.name,
      });
    } catch {
      // ignore
    } finally {
      setGenerating(null);
    }
  };

  const [analysisStep, setAnalysisStep] = useState<string>("");

  const handleAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setAnalysisStep("Uploading audio file...");
    try {
      setAnalysisStep("Analyzing tempo and beats...");
      const result = await analyzeAudio(file);
      setAnalysisStep("Detecting song structure...");
      setAnalysis(result);
      setAnalysisStep("");
      loadAudioFiles();
    } catch (err: any) {
      setError(err.message || "Analysis failed");
      setAnalysisStep("");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAnalyzeLibraryFile = async (storedPath: string) => {
    if (!storedPath) return;
    setSelectedLibraryFile(storedPath);
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setAnalysisStep("Loading audio file...");
    try {
      const filename = storedPath.split(/[/\\]/).pop() || "audio.mp3";
      const base = getApiBase();
      const response = await fetch(`${base}/api/audio/file/${filename}`);
      if (!response.ok) throw new Error("Failed to load audio file");
      const blob = await response.blob();
      const file = new File([blob], filename, { type: blob.type });
      setAnalysisStep("Analyzing tempo and beats...");
      const result = await analyzeAudio(file);
      setAnalysisStep("Detecting song structure...");
      setAnalysis(result);
      setAnalysisStep("");
    } catch (err: any) {
      setError(err.message || "Analysis failed");
      setAnalysisStep("");
    } finally {
      setAnalyzing(false);
      setSelectedLibraryFile(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type.startsWith("audio/")) {
      setFile(droppedFile);
      setAnalysis(null);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const getSectionColor = (type: string) => SECTION_COLORS[type] || SECTION_COLORS.full;

  return (
    <div className={DS.pageWide}>
      <div className={DS.pageTitle}>
        <Music size={22} />
        Audio Analysis
      </div>
      <p className={DS.pageSubtitle}>
        Upload audio or select from library to detect tempo, beats, and song structure.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Upload Area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => {
              const el = document.getElementById("audio-analysis-file-input") as HTMLInputElement;
              el?.click();
            }}
            className={`${DS.card} text-center cursor-pointer transition-colors ${dragOver ? "border-violet-500 bg-violet-500/10" : ""}`}
          >
            <Upload size={40} className="mx-auto mb-3 text-gray-500" />
            {file ? (
              <div>
                <p className={DS.textBold}>{file.name}</p>
                <p className={DS.textXs}>{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            ) : (
              <div>
                <p className={DS.textSm}>Drop audio file here or click to browse</p>
                <p className={DS.textXs}>Supports MP3, WAV, FLAC, OGG</p>
              </div>
            )}
            <input
              id="audio-analysis-file-input"
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setFile(f); setAnalysis(null); }
              }}
              className="hidden"
            />
          </div>

          {/* Analyze Button */}
          {file && (
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className={`${DS.btnPrimary} w-full`}
            >
              {analyzing ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
              {analyzing ? "Analyzing..." : "Analyze Uploaded File"}
            </button>
          )}

          {/* Analysis Progress */}
          {analyzing && analysisStep && (
            <div className={DS.cardTight} style={{ background: "rgba(139, 92, 246, 0.08)", borderColor: "rgba(139, 92, 246, 0.2)" }}>
              <div className={DS.flexCenter}>
                <Loader2 size={16} className="animate-spin text-violet-400" />
                <span className="text-sm text-violet-300">{analysisStep}</span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className={DS.cardError}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {/* Results */}
          {analysis && (
            <div className={DS.section}>
              {/* Key Metrics */}
              <div className={DS.grid4}>
                <div className={DS.card}>
                  <div className={DS.flexCenter}>
                    <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center mr-2">
                      <Music2 size={16} className="text-violet-400" />
                    </div>
                    <span className={DS.textBold}>{analysis.tempo_bpm.toFixed(0)}</span>
                  </div>
                  <p className={DS.textXs}>BPM</p>
                </div>
                <div className={DS.card}>
                  <div className={DS.flexCenter}>
                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center mr-2">
                      <Clock size={16} className="text-blue-400" />
                    </div>
                    <span className={DS.textBold}>{formatTime(analysis.duration_seconds)}</span>
                  </div>
                  <p className={DS.textXs}>Duration</p>
                </div>
                <div className={DS.card}>
                  <div className={DS.flexCenter}>
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center mr-2">
                      <Zap size={16} className="text-amber-400" />
                    </div>
                    <span className={DS.textBold}>{analysis.beat_count}</span>
                  </div>
                  <p className={DS.textXs}>Beats</p>
                </div>
                <div className={DS.card}>
                  <div className={DS.flexCenter}>
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center mr-2">
                      <TrendingUp size={16} className="text-emerald-400" />
                    </div>
                    <span className={DS.textBold}>{(analysis.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className={DS.textXs}>Confidence</p>
                </div>
              </div>

              {/* Song Structure Bar */}
              <div className={DS.card}>
                <h3 className={DS.sectionTitle}>
                  <BarChart3 size={14} />
                  Song Structure
                </h3>
                <div className="flex rounded-lg overflow-hidden h-8">
                  {analysis.sections.map((section, i) => {
                    const width = ((section.end - section.start) / analysis.duration_seconds) * 100;
                    return (
                      <div
                        key={i}
                        className={`flex items-center justify-center ${getSectionColor(section.type)}`}
                        style={{ width: `${width}%` }}
                      >
                        <span className="text-xs font-medium truncate px-1">{section.type}</span>
                      </div>
                    );
                  })}
                </div>
                <div className={DS.flexBetween}>
                  <span className={DS.textXs}>0:00</span>
                  <span className={DS.textXs}>{formatTime(analysis.duration_seconds)}</span>
                </div>
              </div>

              {/* Energy Curve with Chart */}
              {analysis.energy_curve && analysis.energy_curve.length > 0 && (
                <div className={DS.card}>
                  <h3 className={DS.sectionTitle}>
                    <Activity size={14} />
                    Energy Curve
                  </h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={analysis.energy_curve.slice(0, 120).map((energy, i) => ({
                          time: formatTime((i / analysis.energy_curve!.length) * analysis.duration_seconds),
                          energy: energy * 100,
                        }))}
                        margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient id="energyGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.6} />
                            <stop offset="50%" stopColor="#8b5cf6" stopOpacity={0.2} />
                             <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                        <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" axisLine={{ stroke: '#374151' }} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} domain={[0, 100]} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip content={<EnergyTooltip />} />
                        <Area type="monotone" dataKey="energy" name="Energy" stroke="#8b5cf6" strokeWidth={2} fill="url(#energyGradient)" animationDuration={600} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Sections with Generate Buttons */}
              <div className={DS.card}>
                <h3 className={DS.sectionTitle}>
                  <Activity size={14} />
                  Detected Sections
                  <span className={DS.textXs}>({analysis.sections.length})</span>
                </h3>
                <div className="space-y-2">
                  {analysis.sections.map((section, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-700 last:border-0">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getSectionColor(section.type)}`}>
                        {section.type}
                      </span>
                      <div className="flex-1">
                        <div className={DS.textXs}>
                          {formatTime(section.start)} → {formatTime(section.end)}
                          <span className="ml-2 text-gray-500">({formatTime(section.end - section.start)})</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${getEnergyColor(section.energy)}`} style={{ width: `${section.energy * 100}%` }} />
                          </div>
                          <span className={DS.textXs}>{(section.energy * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleGenerateSection(section.type, section.start, section.end)}
                        disabled={generating === section.type || !analysis.stored_path}
                        className={DS.btnSecondary}
                      >
                        {generating === section.type ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Beat Timeline */}
              {analysis.beat_times && analysis.beat_times.length > 0 && (
                <div className={DS.card}>
                  <h3 className={DS.sectionTitle}>
                    <Zap size={14} />
                    Beat Timeline
                    <span className={DS.textXs}>({analysis.beat_times.length} beats)</span>
                  </h3>
                  <div className={DS.flexWrap}>
                    {analysis.beat_times.slice(0, 100).map((t, i) => (
                      <span key={i} className={DS.textXs}>
                        {t.toFixed(2)}
                      </span>
                    ))}
                    {analysis.beat_times.length > 100 && (
                      <span className={DS.textXs}>+{analysis.beat_times.length - 100} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar - Audio Library */}
        <div className="lg:col-span-1 space-y-4 min-w-0">
          <div className={DS.card} style={{ overflow: "hidden" }}>
            <div
              onClick={() => setShowLibrary(!showLibrary)}
              className={DS.flexBetween}
            >
              <span className={DS.sectionTitle}>
                <Database size={14} />
                Audio Library ({audioFiles.length})
              </span>
              <div className="flex items-center gap-2">
                <button onClick={(e) => { e.stopPropagation(); loadAudioFiles(); }} className={DS.btnSecondary}>
                  <RefreshCw size={14} />
                </button>
                {showLibrary ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
            </div>
             {showLibrary && (
               <div className="mt-3">
                {/* Sort & Filter Controls */}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    placeholder="Filter files..."
                    value={filterText}
                    onChange={(e) => { setFilterText(e.target.value); setCurrentPage(1); }}
                    className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                  />
                  <select
                    value={sortBy}
                    onChange={(e) => { setSortBy(e.target.value as any); setCurrentPage(1); }}
                    className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="date">Newest</option>
                    <option value="name">Name</option>
                    <option value="size">Size</option>
                  </select>
                </div>

                {/* File List */}
                {audioFiles.length > 0 ? (
                  <>
                    <div className="space-y-1">
                      {audioFiles
                        .filter(f => !filterText || f.filename.toLowerCase().includes(filterText.toLowerCase()))
                        .sort((a, b) => {
                          if (sortBy === "name") return a.filename.localeCompare(b.filename);
                          if (sortBy === "size") return b.size_bytes - a.size_bytes;
                          return 0;
                        })
                        .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                        .map((f, i) => (
                          <div
                            key={i}
                            className={`p-2 rounded-lg cursor-pointer transition-colors ${selectedLibraryFile === f.path ? "bg-violet-500/20 border border-violet-500/30" : "hover:bg-gray-700"}`}
                            onClick={() => { if (editingFile !== f.path) handleAnalyzeLibraryFile(f.path); }}
                          >
                            <div className={DS.flexBetween}>
                              <div className={DS.flexCenter} style={{ minWidth: 0, flex: 1 }}>
                                <Music size={14} className="shrink-0" />
                                {editingFile === f.path ? (
                                  <input
                                    autoFocus
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    onBlur={async () => {
                                      if (editName.trim() && editName !== f.filename) {
                                        try {
                                          const ext = f.filename.includes(".") ? f.filename.slice(f.filename.lastIndexOf(".")) : "";
                                          const newName = editName.includes(".") ? editName : editName + ext;
                                          await renameAudioFile(f.filename, newName);
                                          await loadAudioFiles();
                                        } catch { /* ignore */ }
                                      }
                                      setEditingFile(null);
                                    }}
                                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingFile(null); }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="ml-2 px-1 py-0.5 bg-gray-700 border border-violet-500 rounded text-sm text-white w-full focus:outline-none"
                                  />
                                ) : (
                                  <span className="text-sm truncate">{f.filename}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={DS.textXs}>{formatFileSize(f.size_bytes)}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditingFile(f.path); setEditName(f.filename); }}
                                  className={DS.btnSecondarySm}
                                  title="Rename"
                                >
                                  <Pencil size={12} />
                                </button>
                                {selectedLibraryFile === f.path && analyzing ? (
                                  <Loader2 size={12} className="animate-spin text-violet-400" />
                                ) : (
                                  <Play size={12} />
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {audioFiles.filter(f => !filterText || f.filename.toLowerCase().includes(filterText.toLowerCase())).length > pageSize && (
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700">
                        <button
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className={DS.btnSecondarySm}
                        >
                          Prev
                        </button>
                        <span className={DS.textXs}>
                          Page {currentPage} of {Math.ceil(audioFiles.filter(f => !filterText || f.filename.toLowerCase().includes(filterText.toLowerCase())).length / pageSize)}
                        </span>
                        <button
                          onClick={() => setCurrentPage(p => p + 1)}
                          disabled={currentPage >= Math.ceil(audioFiles.filter(f => !filterText || f.filename.toLowerCase().includes(filterText.toLowerCase())).length / pageSize)}
                          className={DS.btnSecondarySm}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className={DS.textXs}>
                    No audio files in library.<br />
                    Upload a file to add it.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className={DS.card}>
            <h3 className={DS.sectionTitle}>Tips</h3>
            <ul className={DS.textSm}>
              <li>• Click a library file to analyze it</li>
              <li>• Upload new files to add them to the library</li>
              <li>• Analysis detects tempo, beats & sections</li>
              <li>• Use results to sync visuals to music</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}