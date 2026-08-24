import React, { useState, useEffect, useRef } from "react";
import {
  Upload,
  Music2,
  Activity,
  BarChart3,
  Play,
  Pause,
  Loader2,
  Check,
  ArrowRight,
  Clock,
  Zap,
  TrendingUp,
} from "lucide-react";
import { Card } from "../../components/common";
import {
  analyzeAudio,
  generateVideoSection,
  type AudioAnalysisResult,
} from "../../services/api";
import { useNavigate } from "react-router-dom";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getEnergyColor(energy: number): string {
  if (energy < 0.3) return "bg-blue-500";
  if (energy < 0.6) return "bg-amber-500";
  return "bg-red-500";
}

function getSectionColor(type: string): string {
  switch (type) {
    case "intro": return "bg-violet-500/20 text-violet-300 border-violet-500/30";
    case "verse": return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "chorus": return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    case "bridge": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    case "outro": return "bg-gray-500/20 text-gray-300 border-gray-500/30";
    default: return "bg-white/10 text-white border-white/10";
  }
}

export function AudioAnalysis() {
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<AudioAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);

  const handleFile = async (file: File) => {
    setAudioFile(file);
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const result = await analyzeAudio(file);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  // Draw energy curve
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

  const handleGenerateSection = async (section: string, start: number, end: number) => {
    if (!analysis?.stored_path) return;
    setGenerating(section);
    try {
      await generateVideoSection({
        prompt: `Music video for ${section} section`,
        section,
        duration: end - start,
        audio_path: analysis.stored_path,
        audio_filename: audioFile?.name,
      });
      navigate("/queue");
    } catch {
      // ignore
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Audio Analysis</h1>
        <p className="text-sm text-muted mt-1">Upload audio to analyze beats, tempo, sections, and energy</p>
      </div>

      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file"; input.accept = "audio/*,.mp3,.wav,.flac,.ogg,.m4a";
          input.onchange = () => { if (input.files?.[0]) handleFile(input.files[0]); };
          input.click();
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all mb-6 ${dragOver ? "border-violet-500 bg-violet-500/10" : "border-white/10 bg-white/[0.02] hover:border-violet-500/40 hover:bg-violet-500/5"}`}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-violet-400" />
            <p className="text-sm text-white font-medium">Analyzing audio on GPU…</p>
            <p className="text-xs text-muted">librosa + CUDA • beats, tempo, sections, energy</p>
          </div>
        ) : analysis ? (
          <div className="flex items-center justify-center gap-3">
            <Check size={20} className="text-emerald-400" />
            <p className="text-sm text-white font-medium">{audioFile?.name} — analyzed</p>
            <button onClick={(e) => { e.stopPropagation(); setAnalysis(null); setAudioFile(null); }} className="text-xs text-violet-300 hover:underline">Upload another</button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={28} className="text-muted" />
            <p className="text-sm text-white font-medium">Drop audio file here</p>
            <p className="text-xs text-muted">MP3, WAV, FLAC • max 500 MB</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300">{error}</div>
      )}

      {analysis && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Card>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-violet-500/20 flex items-center justify-center">
                  <Music2 size={18} className="text-violet-400" />
                </div>
                <div>
                  <p className="text-2xl font-extrabold text-white">{analysis.tempo_bpm.toFixed(0)}</p>
                  <p className="text-xs text-muted">BPM</p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Clock size={18} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-extrabold text-white">{formatTime(analysis.duration_seconds)}</p>
                  <p className="text-xs text-muted">Duration</p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Zap size={18} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-extrabold text-white">{analysis.beat_count}</p>
                  <p className="text-xs text-muted">Beats</p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <TrendingUp size={18} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-2xl font-extrabold text-white">{(analysis.confidence * 100).toFixed(0)}%</p>
                  <p className="text-xs text-muted">Confidence</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Energy Curve */}
          <Card className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 size={18} className="text-violet-400" />
              <h3 className="font-semibold text-sm">Energy Curve</h3>
              <span className="text-xs text-muted">{analysis.energy_curve.length} points</span>
            </div>
            <canvas
              ref={canvasRef}
              width={800}
              height={120}
              className="w-full h-[120px] rounded-lg bg-black/30"
            />
            <div className="flex items-center gap-4 mt-2 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Low energy</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Medium</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />High energy</span>
            </div>
          </Card>

          {/* Sections */}
          <Card className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <Activity size={18} className="text-violet-400" />
              <h3 className="font-semibold text-sm">Detected Sections</h3>
              <span className="text-xs text-muted">{analysis.sections.length} sections</span>
            </div>
            <div className="space-y-2">
              {analysis.sections.map((section, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                  <span className={`text-xs font-bold uppercase px-2 py-1 rounded border ${getSectionColor(section.type)}`}>
                    {section.type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span>{formatTime(section.start)}</span>
                      <ArrowRight size={10} />
                      <span>{formatTime(section.end)}</span>
                      <span className="text-white">({formatTime(section.end - section.start)})</span>
                    </div>
                    <div className="mt-1 h-1.5 bg-background rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${getEnergyColor(section.energy)}`} style={{ width: `${section.energy * 100}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-muted">{(section.energy * 100).toFixed(0)}%</span>
                  <button
                    onClick={() => handleGenerateSection(section.type, section.start, section.end)}
                    disabled={generating === section.type || !analysis.stored_path}
                    className="text-xs px-2 py-1 rounded-lg bg-violet-600/20 text-violet-300 border border-violet-500/30 hover:bg-violet-600/30 disabled:opacity-50 flex items-center gap-1"
                  >
                    {generating === section.type ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                    Generate
                  </button>
                </div>
              ))}
            </div>
          </Card>

          {/* Beat Times Preview */}
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <Zap size={18} className="text-amber-400" />
              <h3 className="font-semibold text-sm">Beat Timeline</h3>
              <span className="text-xs text-muted">{analysis.beat_times.length} beats</span>
            </div>
            <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
              {analysis.beat_times.slice(0, 100).map((t, i) => (
                <div key={i} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px] font-mono">
                  {t.toFixed(2)}
                </div>
              ))}
              {analysis.beat_times.length > 100 && (
                <span className="text-[10px] text-muted">+{analysis.beat_times.length - 100} more</span>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
