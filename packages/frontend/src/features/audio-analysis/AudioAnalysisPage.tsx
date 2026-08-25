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
  ArrowRight,
} from "lucide-react";
import {
  analyzeAudio,
  generateVideoSection,
  listAudioFiles,
  type AudioAnalysisResult,
} from "../../services/api";
import { SECTION_COLORS } from "../../styles/designSystem";
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
  stored_path: string;
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
      const response = await fetch(storedPath);
      const blob = await response.blob();
      const filename = storedPath.split("/").pop() || "audio.mp3";
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
    <div className="aa-page">
      <div className="aa-header">
        <div className="aa-title-row">
          <Music size={22} className="aa-icon" />
          <h1 className="aa-title">Audio Analysis</h1>
        </div>
        <p className="aa-subtitle">
          Upload audio or select from library to detect tempo, beats, and song structure.
        </p>
      </div>

      <div className="aa-layout">
        {/* Main Area */}
        <div className="aa-main">
          {/* Upload Area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => {
              const el = document.getElementById("audio-analysis-file-input") as HTMLInputElement;
              el?.click();
            }}
            className={`aa-dropzone ${dragOver ? "border-violet-500 bg-violet-500/10" : ""}`}
          >
            <Upload size={40} className="aa-dropzone-icon" />
            {file ? (
              <div>
                <p className="aa-dropzone-filename">{file.name}</p>
                <p className="aa-dropzone-filesize">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            ) : (
              <div>
                <p className="aa-dropzone-text">Drop audio file here or click to browse</p>
                <p className="aa-dropzone-hint">Supports MP3, WAV, FLAC, OGG</p>
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
              className="aa-analyze-btn"
            >
              {analyzing ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
              {analyzing ? "Analyzing..." : "Analyze Uploaded File"}
            </button>
          )}

          {/* Analysis Progress */}
          {analyzing && analysisStep && (
            <div className="aa-card" style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "rgba(139, 92, 246, 0.08)", borderColor: "rgba(139, 92, 246, 0.2)" }}>
              <Loader2 size={16} className="animate-spin text-violet-400" />
              <span className="text-sm text-violet-300">{analysisStep}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="aa-card" style={{ display: "flex", gap: "0.5rem", color: "#fcd34d", background: "rgba(251, 191, 36, 0.1)", borderColor: "rgba(251, 191, 36, 0.2)" }}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {/* Results */}
          {analysis && (
            <div className="aa-results">
              {/* Key Metrics */}
              <div className="aa-metrics-grid">
                <div className="aa-card aa-metric">
                  <div className="aa-metric-icon bg-violet-500/20">
                    <Music2 size={18} className="text-violet-400" />
                  </div>
                  <div className="aa-metric-value">{analysis.tempo_bpm.toFixed(0)}</div>
                  <div className="aa-metric-label">BPM</div>
                </div>
                <div className="aa-card aa-metric">
                  <div className="aa-metric-icon bg-blue-500/20">
                    <Clock size={18} className="text-blue-400" />
                  </div>
                  <div className="aa-metric-value">{formatTime(analysis.duration_seconds)}</div>
                  <div className="aa-metric-label">Duration</div>
                </div>
                <div className="aa-card aa-metric">
                  <div className="aa-metric-icon bg-amber-500/20">
                    <Zap size={18} className="text-amber-400" />
                  </div>
                  <div className="aa-metric-value">{analysis.beat_count}</div>
                  <div className="aa-metric-label">Beats</div>
                </div>
                <div className="aa-card aa-metric">
                  <div className="aa-metric-icon bg-emerald-500/20">
                    <TrendingUp size={18} className="text-emerald-400" />
                  </div>
                  <div className="aa-metric-value">{(analysis.confidence * 100).toFixed(0)}%</div>
                  <div className="aa-metric-label">Confidence</div>
                </div>
              </div>

              {/* Song Structure Bar */}
              <div className="aa-card">
                <h3 className="aa-section-title">
                  <BarChart3 size={14} />
                  Song Structure
                </h3>
                <div className="aa-structure">
                  {analysis.sections.map((section, i) => {
                    const width = ((section.end - section.start) / analysis.duration_seconds) * 100;
                    return (
                      <div
                        key={i}
                        className={`aa-structure-section ${getSectionColor(section.type)}`}
                        style={{ width: `${width}%` }}
                      >
                        <span className="aa-structure-label">{section.type}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="aa-structure-time">
                  <span>0:00</span>
                  <span>{formatTime(analysis.duration_seconds)}</span>
                </div>
              </div>

              {/* Energy Curve with Chart */}
              {analysis.energy_curve && analysis.energy_curve.length > 0 && (
                <div className="aa-card">
                  <h3 className="aa-section-title">
                    <Activity size={14} />
                    Energy Curve
                  </h3>
                  <div className="aa-energy-chart">
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
                        <XAxis 
                          dataKey="time" 
                          tick={{ fontSize: 10, fill: '#9ca3af' }} 
                          interval="preserveStartEnd"
                          axisLine={{ stroke: '#374151' }}
                          tickLine={false}
                        />
                        <YAxis 
                          tick={{ fontSize: 10, fill: '#9ca3af' }} 
                          domain={[0, 100]}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `${v}%`}
                        />
                        <Tooltip content={<EnergyTooltip />} />
                        <Area 
                          type="monotone" 
                          dataKey="energy" 
                          name="Energy"
                          stroke="#8b5cf6" 
                          strokeWidth={2} 
                          fill="url(#energyGradient)"
                          animationDuration={600}
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Canvas fallback for performance */}
                  <canvas
                    ref={canvasRef}
                    width={800}
                    height={80}
                    className="aa-energy-canvas"
                  />
                </div>
              )}

              {/* Sections with Generate Buttons */}
              <div className="aa-card">
                <h3 className="aa-section-title">
                  <Activity size={14} />
                  Detected Sections
                  <span className="aa-section-count">{analysis.sections.length} sections</span>
                </h3>
                <div className="aa-sections-list">
                  {analysis.sections.map((section, i) => (
                    <div key={i} className="aa-section-item">
                      <span className={`aa-section-badge ${getSectionColor(section.type)}`}>
                        {section.type}
                      </span>
                      <div className="aa-section-info">
                        <div className="aa-section-time">
                          <span>{formatTime(section.start)}</span>
                          <ArrowRight size={10} />
                          <span>{formatTime(section.end)}</span>
                          <span className="aa-section-duration">({formatTime(section.end - section.start)})</span>
                        </div>
                        <div className="aa-section-energy">
                          <div className="aa-section-energy-bar">
                            <div className={`aa-section-energy-fill ${getEnergyColor(section.energy)}`} style={{ width: `${section.energy * 100}%` }} />
                          </div>
                          <span className="aa-section-energy-value">{(section.energy * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleGenerateSection(section.type, section.start, section.end)}
                        disabled={generating === section.type || !analysis.stored_path}
                        className="aa-generate-btn"
                      >
                        {generating === section.type ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                        Generate
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Beat Timeline */}
              {analysis.beat_times && analysis.beat_times.length > 0 && (
                <div className="aa-card">
                  <h3 className="aa-section-title">
                    <Zap size={14} />
                    Beat Timeline
                    <span className="aa-section-count">{analysis.beat_times.length} beats</span>
                  </h3>
                  <div className="aa-beat-timeline">
                    {analysis.beat_times.slice(0, 100).map((t, i) => (
                      <span key={i} className="aa-beat-item">
                        {t.toFixed(2)}
                      </span>
                    ))}
                    {analysis.beat_times.length > 100 && (
                      <span className="aa-beat-more">+{analysis.beat_times.length - 100} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar - Audio Library */}
        <div className="aa-sidebar">
          <div className="aa-card">
            <div
              onClick={() => setShowLibrary(!showLibrary)}
              className="aa-library-header"
            >
              <span className="aa-library-title">
                <Database size={14} />
                Audio Library ({audioFiles.length})
              </span>
              <span className="aa-library-actions">
                <button onClick={(e) => { e.stopPropagation(); loadAudioFiles(); }} className="aa-library-refresh">
                  <RefreshCw size={14} />
                </button>
                {showLibrary ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </div>
            {showLibrary && (
              <div className="aa-library-list">
                {audioFiles.length > 0 ? (
                  audioFiles.map((f, i) => (
                    <div
                      key={i}
                      className={`aa-library-item ${selectedLibraryFile === f.stored_path ? "active" : ""}`}
                      onClick={() => handleAnalyzeLibraryFile(f.stored_path)}
                    >
                      <div className="aa-library-item-name">
                        <Music size={14} className="aa-icon" />
                        <span className="aa-library-item-filename">{f.filename}</span>
                      </div>
                      <div className="aa-library-item-meta">
                        <span className="aa-library-item-size">{formatFileSize(f.size_bytes)}</span>
                        {selectedLibraryFile === f.stored_path && analyzing ? (
                          <Loader2 size={12} className="animate-spin text-violet-400" />
                        ) : (
                          <Play size={12} className="aa-library-item-play" />
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="aa-library-empty">
                    No audio files in library.<br />
                    Upload a file to add it.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="aa-card">
            <h3 className="aa-tips-title">Tips</h3>
            <ul className="aa-tips-list">
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