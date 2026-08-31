import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music, Sparkles, Type, Palette, Sliders, Eye, RotateCcw, Mic, Loader2, Edit3 } from "lucide-react";
import { kineticPresets, kineticPresetList, selectPresetForTrack, type LyricLine } from "../visualizer/components/KineticPresets";
import { listAudioFiles, ensureAnalysis, transcribeAudio, getLyricsByFilename } from "../../services/api";
import { parseLyricsFromCsv } from "../visualizer/lyricsParser";
import { createDefaultLyricsData, lyricsDataToLegacy } from "../visualizer/lyricsData";
import { LyricsEditorModal } from "./components/LyricsEditorModal";
import { PresetSelector, type VisualPreset } from "../visualizer/PresetSelector";

// Word-level highlight component for karaoke-style display
function WordHighlight({ line, time, color, glowIntensity }: {
  line: LyricLine;
  time: number;
  color: string;
  glowIntensity: number;
}) {
  if (!line.words || line.words.length === 0) {
    return <>{line.text}</>;
  }

  return (
    <>
      {line.words.map((word, i) => {
        const isPast = time >= word.end;
        const isCurrent = time >= word.start && time < word.end;

        return (
          <span
            key={i}
            className={`kt-word ${isCurrent ? "current" : ""} ${isPast ? "past" : ""}`}
            style={{
              color: isPast || isCurrent ? color : `${color}80`,
              textShadow: isCurrent && glowIntensity > 0
                ? `0 0 ${20 * glowIntensity}px ${color}, 0 0 ${40 * glowIntensity}px ${color}80`
                : "none",
              transition: "color 0.1s, text-shadow 0.1s",
            }}
          >
            {word.word}{" "}
          </span>
        );
      })}
    </>
  );
}

// Sample lyrics for preview when no track is selected
const SAMPLE_LYRICS: LyricLine[] = [
  { start: 0, end: 4, text: "Feel the rhythm take control", section: "INTRO" },
  { start: 4, end: 12, text: "Walking through the neon lights", section: "VERSE" },
  { start: 12, end: 20, text: "Echoes in the midnight haze", section: "VERSE" },
  { start: 20, end: 30, text: "We rise together, breaking chains", section: "CHORUS" },
  { start: 30, end: 40, text: "Forever burning, never fade", section: "CHORUS" },
  { start: 40, end: 50, text: "The rhythm pulls us higher still", section: "BRIDGE" },
  { start: 50, end: 60, text: "We are the fire, we are the night", section: "FINAL CHORUS" },
];

interface TrackInfo {
  filename: string;
  name: string;
  bpm?: number;
  duration?: number;
  energy?: number;
  beatTimes?: number[];
  energyCurve?: number[];
  sections?: Array<{ type: string; start: number; end: number; energy: number }>;
}

// Helper: find the closest beat time index for a given time
function findBeatIndex(beatTimes: number[], time: number): number {
  if (!beatTimes || beatTimes.length === 0) return -1;
  let closest = -1;
  let minDist = Infinity;
  for (let i = 0; i < beatTimes.length; i++) {
    const dist = Math.abs(beatTimes[i] - time);
    if (dist < minDist) { minDist = dist; closest = i; }
  }
  return minDist < 0.1 ? closest : -1;
}

export function KineticTypographyPage() {
  const [activePreset, setActivePreset] = useState("cinematic");
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lyrics, setLyrics] = useState<LyricLine[]>(SAMPLE_LYRICS);
  const [fontSize, setFontSize] = useState(48);
  const [glowIntensity, setGlowIntensity] = useState(0.7);
  const [showSectionLabel, setShowSectionLabel] = useState(true);
  const [beatPulse, setBeatPulse] = useState(true);
  const [selectedTrack, setSelectedTrack] = useState<TrackInfo | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<TrackInfo[]>([]);
  const [autoPreset, setAutoPreset] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [csvContent, setCsvContent] = useState<string>("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState<string>("");
  const [showLyricsEditor, setShowLyricsEditor] = useState(false);
  const [lyricsData, setLyricsData] = useState(createDefaultLyricsData());
  const [visualPresetId, setVisualPresetId] = useState("default");

  const previewRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastBeatIdxRef = useRef(-1);
  const preset = kineticPresets[activePreset] || kineticPresets.cinematic;

  // Audio URL for selected track
  const audioUrl = selectedTrack ? `/api/audio/file/${encodeURIComponent(selectedTrack.filename)}` : null;

  // Load library files and normalized lyrics CSV
  useEffect(() => {
    listAudioFiles().then(files => {
      if (Array.isArray(files)) {
        setLibraryFiles(files.map(f => ({
          filename: f.filename,
          name: f.filename.replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, ""),
        })));
      }
    }).catch(() => {});
    // Load normalized lyrics CSV (fallback to legacy if not found)
    fetch("/track-lyrics-normalized.csv")
      .then(r => r.text())
      .then(setCsvContent)
      .catch(() => {
        // Fallback to legacy CSV
        fetch("/track-prompts-lyrics.csv").then(r => r.text()).then(setCsvContent).catch(() => {});
      });
  }, []);

  // Real audio playback — drive elapsed from audio currentTime
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setElapsed(audio.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => { setIsPlaying(false); setElapsed(0); };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Beat detection from analysis data
  useEffect(() => {
    if (!beatPulse || !isPlaying || !selectedTrack?.beatTimes) return;
    const idx = findBeatIndex(selectedTrack.beatTimes, elapsed);
    if (idx >= 0 && idx !== lastBeatIdxRef.current) {
      lastBeatIdxRef.current = idx;
      const el = previewRef.current?.querySelector(".kt-preview-line");
      if (el && preset.beatAnimation) {
        preset.beatAnimation(el as HTMLElement);
      }
    }
  }, [elapsed, beatPulse, isPlaying, selectedTrack, preset]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (audioRef.current) {
          if (audioRef.current.paused) audioRef.current.play().catch(() => {});
          else audioRef.current.pause();
        } else {
          setIsPlaying(p => !p);
        }
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
        else setElapsed(prev => Math.max(0, prev - 5));
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        if (audioRef.current) audioRef.current.currentTime = Math.min(audioRef.current.duration || 60, audioRef.current.currentTime + 5);
        else setElapsed(prev => Math.min(prev + 5, selectedTrack?.duration || 60));
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        if (audioRef.current) audioRef.current.currentTime = 0;
        else setElapsed(0);
      }
      if (e.code === "KeyM") {
        e.preventDefault();
        setIsMuted(m => !m);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedTrack]);

  // Trigger enter animation on line change
  const currentLine = lyrics.find(l => elapsed >= l.start && elapsed < l.end);
  const prevLineRef = useRef<LyricLine | null>(null);
  useEffect(() => {
    if (currentLine && currentLine !== prevLineRef.current) {
      prevLineRef.current = currentLine;
      const el = previewRef.current?.querySelector(".kt-preview-line");
      if (el) preset.enterAnimation(el as HTMLElement);
    }
  }, [currentLine, preset]);

  // Parse lyrics from CSV for a track (fallback)
  const loadLyricsForTrack = useCallback(async (trackName: string, filename: string, duration: number) => {
    // First try to load from database
    try {
      const dbLyrics = await getLyricsByFilename(filename);
      if (dbLyrics.lines && dbLyrics.lines.length > 0) {
        // Ensure section is always a string
        const lines: LyricLine[] = dbLyrics.lines.map(l => ({
          ...l,
          section: l.section || "VERSE",
        }));
        setLyrics(lines);
        return;
      }
    } catch {
      // No database lyrics found, try CSV
    }

    // Fallback to CSV parsing
    const parsedLyrics = parseLyricsFromCsv(csvContent, trackName, duration);
    if (parsedLyrics.length > 0) {
      setLyrics(parsedLyrics);
    }
  }, [csvContent]);

  // Apply visual preset to current settings
  const applyVisualPreset = useCallback((preset: VisualPreset) => {
    // Apply lyric animation settings
    setFontSize(preset.lyrics.fontSize);
    setGlowIntensity(preset.lyrics.glowIntensity);
    // Store preset for use by visualizer
    // (In a full implementation, this would update a context or emit an event)
  }, []);

  // Transcribe audio and load synced lyrics (fallback if no DB lyrics)
  const handleTranscribe = useCallback(async (filename: string) => {
    setIsTranscribing(true);
    setTranscriptionStatus("Starting transcription...");

    try {
      setTranscriptionStatus("Transcribing with Whisper...");
      await transcribeAudio(filename);

      setTranscriptionStatus("Loading synced lyrics...");
      // Use the transcription endpoint to get lyrics
      const base = "";
      const res = await fetch(`${base}/api/audio/transcript/lyrics/${encodeURIComponent(filename)}`);
      if (res.ok) {
        const lyricsData = await res.json();
        if (lyricsData.lines && lyricsData.lines.length > 0) {
          const lines: LyricLine[] = lyricsData.lines.map((l: LyricLine) => ({
            ...l,
            section: l.section || "VERSE",
          }));
          setLyrics(lines);
          setTranscriptionStatus(`Transcribed ${lines.length} lines (edit to refine)`);
        } else {
          setTranscriptionStatus("No lyrics found in transcription");
        }
      } else {
        setTranscriptionStatus("Transcription failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTranscriptionStatus(`Transcription failed: ${msg}`);
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const handleTrackSelect = useCallback(async (filename: string) => {
    const file = libraryFiles.find(f => f.filename === filename);
    if (!file) return;

    // Pause current audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    setSelectedTrack(file);
    setElapsed(0);
    lastBeatIdxRef.current = -1;
    setIsLoadingAnalysis(true);

    try {
      // Ensure analysis exists (runs if not cached)
      const result = await ensureAnalysis(filename);
      const analysis = result.analysis;
      if (analysis) {
        const energy = analysis.energy_curve?.length
          ? analysis.energy_curve.reduce((a: number, b: number) => a + b, 0) / analysis.energy_curve.length
          : 0.5;
        const trackInfo: TrackInfo = {
          ...file,
          bpm: Math.round(analysis.tempo_bpm),
          duration: Math.round(analysis.duration_seconds),
          energy,
          beatTimes: analysis.beat_times || [],
          energyCurve: analysis.energy_curve || [],
          sections: analysis.sections || [],
        };
        setSelectedTrack(trackInfo);
        if (autoPreset) {
          const presetId = selectPresetForTrack(file.name, energy);
          setActivePreset(presetId);
        }
        // Load lyrics from database (or CSV fallback)
        loadLyricsForTrack(file.name, filename, analysis.duration_seconds || 60);
      }
    } catch {
      // Fallback to basic info
      setSelectedTrack({ ...file, duration: 60 });
    } finally {
      setIsLoadingAnalysis(false);
    }
  }, [libraryFiles, autoPreset, loadLyricsForTrack]);

  const handlePresetChange = useCallback((id: string) => {
    setAutoPreset(false);
    setActivePreset(id);
  }, []);

  const resetSettings = useCallback(() => {
    setFontSize(48);
    setGlowIntensity(0.7);
    setShowSectionLabel(true);
    setBeatPulse(true);
    setActivePreset("cinematic");
    setAutoPreset(true);
    setVolume(0.8);
    setIsMuted(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (audioRef.current.paused) audioRef.current.play().catch(() => {});
      else audioRef.current.pause();
    } else {
      setIsPlaying(p => !p);
    }
  }, []);

  const sectionColors: Record<string, string> = {
    INTRO: "#818cf8", VERSE: "#60a5fa", CHORUS: "#c084fc", BRIDGE: "#f59e0b", "FINAL CHORUS": "#f472b6",
  };
  const currentColor = currentLine ? sectionColors[currentLine.section] || "#a5b4fc" : "#a5b4fc";

  return (
    <div className="kt-page">
      {/* Hidden audio element for real playback */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          crossOrigin="anonymous"
          preload="auto"
          className="kt-audio-hidden"
        />
      )}

      <header className="kt-header">
        <div className="kt-title-row">
          <Type size={22} className="kt-title-icon" />
          <div>
            <h1 className="kt-title">Kinetic Typography</h1>
            <p className="kt-subtitle">Configure animated lyric visuals for your tracks</p>
          </div>
        </div>
        <div className="kt-header-actions">
          {isLoadingAnalysis && <span className="kt-loading-badge">Loading analysis...</span>}
          <button className="kt-btn kt-btn-primary" onClick={togglePlay}>
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </header>

      <div className="kt-content">
        {/* Preview Panel */}
        <div className="kt-preview-panel" ref={previewRef}>
          <div className="kt-preview-stage">
            <div className="kt-preview-bg">
              <div className="kt-preview-grid" />
              {/* Audio visualizer bars */}
              <div className="kt-audio-bass">
                <div className="kt-bass-bar" style={{ height: `${Math.min(100, (selectedTrack?.energy || 0.5) * 100 * (isPlaying ? 1.2 : 0.3))}%` }} />
              </div>
            </div>
             <div className={`kt-preview-lyrics ${preset.containerClass}`}>
               {showSectionLabel && currentLine && (
                 <div className="kt-preview-section" style={{ color: currentColor }}>{currentLine.section}</div>
               )}
               <div
                 key={currentLine?.text || "empty"}
                 className="kt-preview-line"
                 style={{
                   color: currentColor,
                   fontSize: `${fontSize}px`,
                   textShadow: glowIntensity > 0 ? `0 0 ${20 * glowIntensity}px ${currentColor}, 0 0 ${40 * glowIntensity}px ${currentColor}40` : "none",
                 }}
               >
                 {currentLine?.words && currentLine.words.length > 0 ? (
                   <WordHighlight line={currentLine} time={elapsed} color={currentColor} glowIntensity={glowIntensity} />
                 ) : (
                   currentLine?.text || (selectedTrack ? "Press Play to start" : "Select a track and press Play")
                 )}
               </div>
               {currentLine && (
                 <div className="kt-preview-next">{lyrics[lyrics.indexOf(currentLine) + 1]?.text || ""}</div>
               )}
             </div>
          </div>

          {/* Transport */}
          <div className="kt-transport">
            <button className="kt-transport-btn" onClick={() => { if (audioRef.current) audioRef.current.currentTime = 0; else setElapsed(0); }}><SkipBack size={14} /></button>
            <button className="kt-transport-btn kt-transport-play" onClick={togglePlay}>
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="kt-transport-btn" onClick={() => {
              if (audioRef.current) audioRef.current.currentTime = Math.min(audioRef.current.duration || 60, audioRef.current.currentTime + 5);
              else setElapsed(prev => Math.min(prev + 5, selectedTrack?.duration || 60));
            }}><SkipForward size={14} /></button>
            <div className="kt-scrubber">
              <input
                type="range"
                min="0"
                max={selectedTrack?.duration || 60}
                step="0.1"
                value={elapsed}
                onChange={(e) => {
                  const t = parseFloat(e.target.value);
                  if (audioRef.current) audioRef.current.currentTime = t;
                  setElapsed(t);
                }}
                className="kt-scrubber-input"
              />
            </div>
            <span className="kt-time">{Math.floor(elapsed / 60)}:{(Math.floor(elapsed) % 60).toString().padStart(2, "0")}</span>
            <button className="kt-transport-btn" onClick={() => setIsMuted(m => !m)}>
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => { setVolume(parseFloat(e.target.value)); setIsMuted(false); }}
              className="kt-volume-slider"
            />
          </div>

          {/* Keyboard hints */}
          <div className="kt-keyboard-hints">
            <span className="kt-keyboard-hint"><kbd>Space</kbd> Play/Pause</span>
            <span className="kt-keyboard-hint"><kbd>←</kbd><kbd>→</kbd> Scrub</span>
            <span className="kt-keyboard-hint"><kbd>R</kbd> Restart</span>
            <span className="kt-keyboard-hint"><kbd>M</kbd> Mute</span>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="kt-controls">
          {/* Track Selector */}
          <div className="kt-section">
            <div className="kt-section-header">
              <Music size={14} />
              <h3>Track Selection</h3>
            </div>
            <select
              className="kt-select"
              value={selectedTrack?.filename || ""}
              onChange={(e) => e.target.value ? handleTrackSelect(e.target.value) : setSelectedTrack(null)}
            >
              <option value="">Demo Mode (Sample Lyrics)</option>
              {libraryFiles.map(f => (
                <option key={f.filename} value={f.filename}>{f.name}</option>
              ))}
            </select>
            {selectedTrack && (
              <div className="kt-track-meta">
                {selectedTrack.bpm && <span className="kt-badge">{selectedTrack.bpm} BPM</span>}
                {selectedTrack.duration && <span className="kt-badge">{Math.round(selectedTrack.duration)}s</span>}
                {selectedTrack.energy && <span className="kt-badge">Energy {(selectedTrack.energy * 100).toFixed(0)}%</span>}
                {selectedTrack.beatTimes && <span className="kt-badge">{selectedTrack.beatTimes.length} beats</span>}
              </div>
            )}
            {selectedTrack && (
              <button
                className="kt-transcribe-btn"
                onClick={() => handleTranscribe(selectedTrack.filename)}
                disabled={isTranscribing}
              >
                {isTranscribing ? (
                  <><Loader2 size={12} className="kt-spin" /> Transcribing...</>
                ) : (
                  <><Mic size={12} /> Transcribe</>
                )}
              </button>
            )}
            {selectedTrack && (
              <button
                className="kt-transcribe-btn"
                onClick={() => setShowLyricsEditor(true)}
              >
                <><Edit3 size={12} /> Edit Lyrics</>
              </button>
            )}
            {transcriptionStatus && (
              <span className="kt-transcription-status">{transcriptionStatus}</span>
            )}
          </div>

          {/* Preset Selector */}
          <div className="kt-section">
            <div className="kt-section-header">
              <Sparkles size={14} />
              <h3>Animation Preset</h3>
              <label className="kt-auto-toggle">
                <input type="checkbox" checked={autoPreset} onChange={(e) => setAutoPreset(e.target.checked)} />
                Auto
              </label>
            </div>
            <div className="kt-preset-grid">
              {kineticPresetList.map(p => (
                <button
                  key={p.id}
                  className={`kt-preset-card ${activePreset === p.id ? "active" : ""}`}
                  onClick={() => handlePresetChange(p.id)}
                  aria-pressed={activePreset === p.id}
                >
                  <span className="kt-preset-name">
                    {activePreset === p.id && <span className="kt-preset-check">✓ </span>}
                    {p.name}
                  </span>
                  <span className="kt-preset-desc">{p.description}</span>
                  <div className="kt-preset-genres">
                    {p.genres.slice(0, 3).map(g => (
                      <span key={g} className="kt-preset-genre">{g}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Visual Preset Selector */}
          <div className="kt-section">
            <div className="kt-section-header">
              <Sparkles size={14} />
              <h3>Visual Preset</h3>
            </div>
            <PresetSelector
              currentPresetId={visualPresetId}
              onSelect={(preset) => {
                setVisualPresetId(preset.id);
                setFontSize(preset.lyrics.fontSize);
                setGlowIntensity(preset.lyrics.glowIntensity);
                // Apply preset to visualizer if connected
                applyVisualPreset(preset);
              }}
            />
          </div>

          {/* Style Controls */}
          <div className="kt-section">
            <div className="kt-section-header">
              <Palette size={14} />
              <h3>Style</h3>
            </div>
            <div className="kt-slider-row">
              <label>Size</label>
              <input type="range" min="24" max="96" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} />
              <span className="kt-slider-val">{fontSize}px</span>
            </div>
            <div className="kt-slider-row">
              <label>Glow</label>
              <input type="range" min="0" max="1" step="0.05" value={glowIntensity} onChange={(e) => setGlowIntensity(parseFloat(e.target.value))} />
              <span className="kt-slider-val">{(glowIntensity * 100).toFixed(0)}%</span>
            </div>
          </div>

          {/* Display Options */}
          <div className="kt-section">
            <div className="kt-section-header">
              <Eye size={14} />
              <h3>Display</h3>
            </div>
            <label className="kt-toggle">
              <input type="checkbox" checked={showSectionLabel} onChange={(e) => setShowSectionLabel(e.target.checked)} />
              <span>Show section labels</span>
            </label>
            <label className="kt-toggle">
              <input type="checkbox" checked={beatPulse} onChange={(e) => setBeatPulse(e.target.checked)} />
              <span>Beat pulse animation</span>
            </label>
          </div>

          {/* Preset Details */}
          <div className="kt-section">
            <div className="kt-section-header">
              <Sliders size={14} />
              <h3>Active Preset: {preset.name}</h3>
            </div>
            <p className="kt-preset-detail">{preset.description}</p>
            <div className="kt-preset-genres">
              {preset.genres.map(g => (
                <span key={g} className="kt-preset-genre">{g}</span>
              ))}
            </div>
          </div>

          {/* Reset */}
          <button className="kt-reset-btn" onClick={resetSettings}>
            <RotateCcw size={14} /> Reset All
          </button>
        </div>
      </div>

      {/* Lyrics Editor Modal */}
      <LyricsEditorModal
        isOpen={showLyricsEditor}
        onClose={() => setShowLyricsEditor(false)}
        lyricsData={lyricsData}
        onSave={(data) => {
          setLyricsData(data);
          // Convert to legacy format for the current display
          const legacyLines = lyricsDataToLegacy(data);
          setLyrics(legacyLines);
        }}
        trackName={selectedTrack?.name}
        currentTime={elapsed}
        isPlaying={isPlaying}
        onCaptureTime={(_type) => {
          // Return the current playback time for capture
          return elapsed;
        }}
      />
    </div>
  );
}
