import { useState, useEffect, useCallback } from "react";
import {
  Upload,
  Music,
  Zap,
  Play,
  Loader2,
  AlertCircle,
  BarChart3,
  Waves,
  Database,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Activity,
} from "lucide-react";
import {
  analyzeAudio,
  listAudioFiles,
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
  stored_path: string;
  size_bytes: number;
}

const EnergyTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-2 shadow-xl">
        <p className="text-xs text-white font-medium">Energy: {(payload[0].value * 100).toFixed(0)}%</p>
        <p className="text-[10px] text-gray-400">Time: {label}</p>
      </div>
    );
  }
  return null;
};

export function AudioAnalysisPage() {
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AudioAnalysisResult | null>(null);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedLibraryFile, setSelectedLibraryFile] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(true);

  useEffect(() => {
    loadAudioFiles();
  }, []);

  const loadAudioFiles = async () => {
    try {
      const files = await listAudioFiles();
      setAudioFiles(files);
    } catch {
      // Backend may not be running
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      const result = await analyzeAudio(file);
      setAnalysis(result);
      loadAudioFiles();
    } catch (err: any) {
      setError(err.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAnalyzeLibraryFile = async (storedPath: string) => {
    setSelectedLibraryFile(storedPath);
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      // Fetch the file from the server and create a File object
      const response = await fetch(storedPath);
      const blob = await response.blob();
      const filename = storedPath.split("/").pop() || "audio.mp3";
      const file = new File([blob], filename, { type: blob.type });
      const result = await analyzeAudio(file);
      setAnalysis(result);
    } catch (err: any) {
      setError(err.message || "Analysis failed");
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
    <div className={DS.page}>
      <div>
        <h1 className={DS.pageTitle}>
          <Music size={22} className={DS.accentViolet} />
          Audio Analysis
        </h1>
        <p className={DS.pageSubtitle}>
          Upload audio or select from library to detect tempo, beats, and song structure.
        </p>
      </div>

      <div className={DS.gridMainSidebar}>
        {/* Main Area */}
        <div className="space-y-4">
          {/* Upload Area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`${DS.uploadZone} ${dragOver ? DS.uploadZoneActive : DS.uploadZoneIdle}`}
          >
            <Upload size={40} className="mx-auto text-gray-500 mb-3" />
            {file ? (
              <div>
                <p className="text-white font-medium">{file.name}</p>
                <p className={DS.textXs}>{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            ) : (
              <div>
                <p className={DS.textSm}>Drop audio file here or click to browse</p>
                <p className={DS.textXs + " mt-1"}>Supports MP3, WAV, FLAC, OGG</p>
              </div>
            )}
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setFile(f); setAnalysis(null); }
              }}
              className="absolute inset-0 opacity-0 cursor-pointer"
              style={{ position: "absolute", inset: 0 }}
            />
          </div>

          {/* Analyze Button */}
          {file && (
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className={DS.btnFull}
            >
              {analyzing ? <Loader2 size={18} className={DS.loading} /> : <Zap size={18} />}
              {analyzing ? "Analyzing..." : "Analyze Uploaded File"}
            </button>
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
              <div className={DS.grid4}>
                <div className={DS.statCard}>
                  <p className={DS.statLabel}>Tempo</p>
                  <p className={DS.statValue}>{analysis.tempo_bpm}</p>
                  <p className={DS.statSub}>BPM</p>
                </div>
                <div className={DS.statCard}>
                  <p className={DS.statLabel}>Duration</p>
                  <p className={DS.statValue}>{formatTime(analysis.duration_seconds)}</p>
                  <p className={DS.statSub}>mm:ss</p>
                </div>
                <div className={DS.statCard}>
                  <p className={DS.statLabel}>Beats</p>
                  <p className={DS.statValue}>{analysis.beat_count}</p>
                  <p className={DS.statSub}>total</p>
                </div>
                <div className={DS.statCard}>
                  <p className={DS.statLabel}>Sections</p>
                  <p className={DS.statValue}>{analysis.sections.length}</p>
                  <p className={DS.statSub}>detected</p>
                </div>
              </div>

              <div className={DS.card}>
                <h3 className={DS.sectionTitle}>
                  <BarChart3 size={14} />
                  Song Structure
                </h3>
                <div className="flex gap-0.5 h-12 rounded-lg overflow-hidden mt-3">
                  {analysis.sections.map((section, i) => {
                    const width = ((section.end - section.start) / analysis.duration_seconds) * 100;
                    return (
                      <div
                        key={i}
                        className={`${getSectionColor(section.type)} flex items-center justify-center relative group`}
                        style={{ width: `${width}%` }}
                      >
                        <span className="text-xs text-white font-medium truncate px-1">{section.type}</span>
                        <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs p-2 rounded whitespace-nowrap z-10">
                          {section.type}: {formatTime(section.start)} - {formatTime(section.end)}<br />
                          Energy: {(section.energy * 100).toFixed(0)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className={DS.flexBetween + " mt-1"}>
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
                  <div className="h-40 mt-3">
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
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar - Audio Library */}
        <div className="space-y-4">
          <div className={DS.card}>
            <button
              onClick={() => setShowLibrary(!showLibrary)}
              className={"w-full " + DS.flexBetween + " text-white font-medium mb-3"}
            >
              <span className={DS.flexCenter}>
                <Database size={14} />
                Audio Library ({audioFiles.length})
              </span>
              <span className={DS.flexCenter}>
                <button onClick={(e) => { e.stopPropagation(); loadAudioFiles(); }} className="text-gray-400 hover:text-white">
                  <RefreshCw size={14} />
                </button>
                {showLibrary ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>
            {showLibrary && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {audioFiles.length > 0 ? (
                  audioFiles.map((f, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedLibraryFile === f.stored_path
                          ? "bg-violet-600/30 border border-violet-500"
                          : "bg-gray-700/50 hover:bg-gray-700"
                      }`}
                      onClick={() => handleAnalyzeLibraryFile(f.stored_path)}
                    >
                      <div className={DS.flexCenter}>
                        <Music size={14} className={DS.accentViolet} />
                        <span className="text-sm text-gray-300 truncate flex-1">{f.filename}</span>
                      </div>
                      <div className={DS.flexBetween + " mt-1"}>
                        <span className={DS.textXs}>{formatFileSize(f.size_bytes)}</span>
                        {selectedLibraryFile === f.stored_path && analyzing ? (
                          <Loader2 size={12} className={DS.loading + " " + DS.accentViolet} />
                        ) : (
                          <Play size={12} className="text-gray-500" />
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className={DS.textXs + " text-center py-4"}>
                    No audio files in library.<br />
                    Upload a file to add it.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className={DS.card}>
            <h3 className={DS.textBold + " mb-2"}>Tips</h3>
            <ul className="space-y-1 text-xs text-gray-400">
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
