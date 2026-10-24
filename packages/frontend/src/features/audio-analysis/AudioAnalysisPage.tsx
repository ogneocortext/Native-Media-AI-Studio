/**
 * AudioAnalysisPage — upload, analyze, and visualize a single audio track.
 *
 * REFACTORED VERSION — simplified orchestrator that delegates UI to extracted
 * components/hooks and drives analysis through `useAudioAnalysis`.
 */
import { useState, useEffect } from "react";
import {
  BarChart3,
  Loader2,
  RefreshCw,
  Sparkles,
  Scissors,
  Type,
  Play,
  AlertCircle,
} from "lucide-react";
import {
  getCudaStatus,
  separateAudioFile,
} from "../../services/api";
import {
  SEPARATION_FAILED_HEADLINE,
  friendlyPipelineError,
} from "../../utils/errorCopy";
import { useAudioAnalysis } from "../../hooks/useAudioAnalysis";
import { AudioTransport } from "../../components/audio";
import { DS } from "../../styles/designSystem";
import { useNavigate } from "react-router-dom";
import { setPendingTrack } from "../../utils/pendingTrack";

// Extracted components
import {
  BeatDensityChart,
  buildBeatDensity,
} from "./components/BeatDensityChart";
import { EnergyChart } from "./components/EnergyChart";
import { SectionsDisplay } from "./components/SectionsDisplay";
import { LibraryTrackList } from "./components/LibraryTrackList";
import { AnalysisCards } from "./components/AnalysisCards";
import { AudioTrimModal } from "./components/AudioTrimModal";
import { MasteringPanel } from "./components/MasteringPanel";

// Extracted utils
import { validateAudioFile } from "./utils/fileValidation";

export function AudioAnalysisPage() {
  const audio = useAudioAnalysis();
  const [file, setFile] = useState<File | null>(null);
  const [libraryTrack, setLibraryTrack] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cudaAvailable, setCudaAvailable] = useState(false);
  const [showTrimModal, setShowTrimModal] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getCudaStatus().then((status) => setCudaAvailable(!!status.available));
  }, []);

  const handleFileSelect = (selectedFile: File) => {
    const validation = validateAudioFile(selectedFile);
    if (!validation.valid) {
      setError(validation.error ?? "Invalid file");
      return;
    }
    setError(null);
    setFile(selectedFile);
    setLibraryTrack(null);
  };

  const handleLibrarySelect = (filename: string) => {
    setLibraryTrack(filename);
    setFile(null);
    setError(null);
  };

  const handleAnalyze = async (useCuda: boolean = false) => {
    if (!file && !libraryTrack) {
      setError("Please select a file or track first");
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      if (file) {
        await audio.analyze(file, "sonara", useCuda);
      } else if (libraryTrack) {
        await audio.ensure(libraryTrack, "sonara");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSeparateStems = async () => {
    if (!audio.summary?.filename) return;

    try {
      await separateAudioFile(audio.summary.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : SEPARATION_FAILED_HEADLINE);
    }
  };

  const handleGenerateVideo = async () => {
    if (!audio.summary?.filename) return;

    setPendingTrack(audio.summary.filename);
    navigate("/video-generation");
  };

  const beatDensityData = audio.analysis
    ? buildBeatDensity(audio.analysis.beat_times, audio.analysis.sections)
    : [];

  const energyData = audio.analysis?.energy_curve?.map((v, i) => ({
    time: i,
    energy: v,
  })) ?? [];

  const filename = audio.summary?.filename || audio.analysis?.stored_path || null;
  const audioUrl = filename ? `/api/audio/file/${encodeURIComponent(filename)}` : null;

  return (
    <div className={DS.page}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={DS.pageTitle}>
            <BarChart3 size={24} className="text-accent" />
            Audio Analysis
          </h1>
          <p className={DS.pageSubtitle}>
            Upload or select a track to analyze tempo, beats, sections, and energy
          </p>
        </div>
        {audio.analysis && (
          <button
            onClick={() => {
              if (audio.summary?.filename)
                void audio.ensure(audio.summary.filename, "sonara");
            }}
            className="btn btn-ghost"
            title="Refresh analysis"
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      {/* Upload / Library Selection */}
      {!audio.analysis && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className={DS.card}>
            <h3 className={DS.cardTitle}>Upload File</h3>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              className={DS.input}
            />
            {file && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-muted">{file.name}</span>
                <button
                  onClick={() => handleAnalyze(cudaAvailable)}
                  disabled={analyzing}
                  className={DS.btnPrimarySm}
                >
                  {analyzing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  Analyze
                </button>
              </div>
            )}
          </div>

          <div className={DS.card}>
            <h3 className={DS.cardTitle}>From Library</h3>
            <LibraryTrackList onSelect={handleLibrarySelect} />
            {libraryTrack && (
              <button
                onClick={() => handleAnalyze(cudaAvailable)}
                disabled={analyzing}
                className={DS.btnFull}
              >
                {analyzing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Sparkles size={16} />
                )}
                Analyze {libraryTrack}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle size={20} />
          <div>
            <p className="font-semibold">Error</p>
            <p className="text-sm">
              {friendlyPipelineError(error, "Analysis failed").headline}
            </p>
          </div>
        </div>
      )}

      {/* Analysis Results */}
      {audio.analysis && (
        <>
          <AnalysisCards analysis={audio.analysis} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BeatDensityChart data={beatDensityData} />
            <EnergyChart data={energyData} />
          </div>

          <SectionsDisplay sections={audio.analysis.sections} />

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleSeparateStems}
              className={DS.btnSecondary}
            >
              <Scissors size={16} />
              Separate Stems
            </button>
            <button
              onClick={() => setShowTrimModal(true)}
              className={DS.btnSecondary}
            >
              <Type size={16} />
              Trim Audio
            </button>
            <button
              onClick={handleGenerateVideo}
              className={DS.btnPrimary}
            >
              <Play size={16} />
              Generate Video
            </button>
          </div>

          {/* Audio Transport */}
          {audioUrl && (
            <div className={DS.card}>
              <AudioTransport src={audioUrl} ariaLabel="Analysis playback" />
            </div>
          )}

          {/* Mastering Panel */}
          <MasteringPanel onMastered={() => {/* Handle mastered file */}} />
        </>
      )}

      {/* Trim Modal */}
      {showTrimModal && filename && audioUrl && (
        <AudioTrimModal
          isOpen={showTrimModal}
          onClose={() => setShowTrimModal(false)}
          filename={filename}
          audioUrl={audioUrl}
          duration={audio.analysis?.duration_seconds ?? 0}
          sections={audio.analysis?.sections ?? []}
          onSaved={() => {
            setShowTrimModal(false);
            if (audio.summary?.filename)
              void audio.ensure(audio.summary.filename, "sonara");
          }}
          onAnalyzeFile={() => {}}
          onSendToKinetic={() => {}}
        />
      )}
    </div>
  );
}
