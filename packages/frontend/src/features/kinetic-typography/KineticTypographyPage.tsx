import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Type, RotateCcw, Mic, Loader2, Edit3, Film, ChevronDown } from "lucide-react";
import { kineticPresets, kineticPresetList, selectPresetForTrack, type LyricLine } from "../visualizer/components/KineticPresets";
import { listAudioFiles, ensureAnalysis, transcribeAudio, getLyricsByFilename } from "../../services/api";
import { parseLyricsFromCsv, parseLrc } from "../visualizer/lyricsParser";
import { createDefaultLyricsData, lyricsDataToLegacy, legacyToLyricsData } from "../visualizer/lyricsData";
import { LyricsEditorModal } from "./components/LyricsEditorModal";
import { PresetSelector, type VisualPreset } from "../visualizer/PresetSelector";
import { consumePendingTrack } from "../../utils/pendingTrack";
import { generateKineticVideo, type KineticVideoResponse } from "../../services/api";

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
          <span key={i}>
            <span
              className={`kt-word ${isCurrent ? "current" : ""} ${isPast ? "past" : ""}`}
              style={{
                color: isPast || isCurrent ? color : `${color}60`,
                textShadow: isCurrent && glowIntensity > 0
                  ? `0 0 ${18 * glowIntensity}px ${color}, 0 0 ${36 * glowIntensity}px ${color}80`
                  : "none",
                transition: "color 0.12s ease, text-shadow 0.12s ease",
              }}
            >
              {word.word}
            </span>
            {i < (line.words?.length ?? 0) - 1 ? " " : ""}
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

// Helper: m:ss time display
function formatTime(s: number): string {
  const safe = Math.max(0, s || 0);
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}

export function KineticTypographyPage() {
  const [activePreset, setActivePreset] = useState("cinematic");
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lyrics, setLyrics] = useState<LyricLine[]>(SAMPLE_LYRICS);
  const [fontSize, setFontSize] = useState(40);
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
  const [lyricsSource, setLyricsSource] = useState<string>("none");
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoJob, setVideoJob] = useState<KineticVideoResponse | null>(null);
  const [videoJobError, setVideoJobError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    track: true,
    preset: true,
    visualPreset: false,
    style: false,
    display: false,
    presetDetails: false,
  });

  const previewRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastBeatIdxRef = useRef(-1);
  const pendingTrackRef = useRef<string | null>(null);
  const preset = kineticPresets[activePreset] || kineticPresets.cinematic;
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  // Audio URL for selected track
  const audioUrl = selectedTrack ? `/api/audio/file/${encodeURIComponent(selectedTrack.filename)}` : null;

  // Compute current line and its index for distance-based effects
  const currentLineIndex = lyrics.findIndex(l => elapsed >= l.start && elapsed < l.end);
  const currentLine = currentLineIndex >= 0 ? lyrics[currentLineIndex] : null;

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

  // Auto-select pending track from Audio Analysis handoff
  useEffect(() => {
    const pending = consumePendingTrack();
    if (!pending) return;
    // Store in ref so we can match it once libraryFiles loads
    pendingTrackRef.current = pending;
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

  // Demo-mode playback — advance elapsed on a timer when no audio element exists.
  // Without this, Play in "Demo Mode (Sample Lyrics)" toggles state but the
  // preview never advances because nothing drives `elapsed`.
  const demoDuration = selectedTrack?.duration || 60;
  const elapsedRef = useRef(elapsed);
  const demoBaseRef = useRef(0);
  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  useEffect(() => {
    if (!isPlaying || audioUrl) return;
    demoBaseRef.current = performance.now() - elapsedRef.current * 1000;
    const timer = window.setInterval(() => {
      const t = (performance.now() - demoBaseRef.current) / 1000;
      if (t >= demoDuration) {
        setElapsed(0);
        setIsPlaying(false);
      } else {
        elapsedRef.current = t;
        setElapsed(t);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [isPlaying, audioUrl, demoDuration]);

  // Unified seek — works for real audio and demo-mode timer playback.
  const seekTo = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(t, selectedTrack?.duration || 60));
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
    } else {
      elapsedRef.current = clamped;
      if (isPlaying) demoBaseRef.current = performance.now() - clamped * 1000;
    }
    setElapsed(clamped);
  }, [isPlaying, selectedTrack]);

  // Sync volume (re-applied when the audio element remounts on track change)
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted, audioUrl]);

  // Beat detection from analysis data
  useEffect(() => {
    if (!beatPulse || !isPlaying || !selectedTrack?.beatTimes) return;
    const idx = findBeatIndex(selectedTrack.beatTimes, elapsed);
    if (idx >= 0 && idx !== lastBeatIdxRef.current) {
      lastBeatIdxRef.current = idx;
      const lineEl = previewRef.current?.querySelector(".kt-preview-line--active");
      if (lineEl && preset.beatAnimation) {
        preset.beatAnimation(lineEl as HTMLElement);
      }
      const bassEl = previewRef.current?.querySelector(".kt-bass-bar");
      if (bassEl) {
        const el = bassEl as HTMLElement;
        el.style.transform = "scaleY(1.25)";
        el.style.transition = "transform 0.08s ease-out";
        setTimeout(() => {
          if (bassEl) {
            (bassEl as HTMLElement).style.transform = "scaleY(1)";
          }
        }, 100);
      }
    }
  }, [elapsed, beatPulse, isPlaying, selectedTrack, preset]);

  // Keyboard shortcuts (disabled while the lyrics editor modal is open)
  useEffect(() => {
    if (showLyricsEditor) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) return;
      // Space on a focused button already activates it — don't double-toggle.
      if (e.code === "Space" && target instanceof HTMLButtonElement) return;
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
        seekTo(elapsedRef.current - 5);
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        seekTo(elapsedRef.current + 5);
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        seekTo(0);
      }
      if (e.code === "KeyM") {
        e.preventDefault();
        setIsMuted(m => !m);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [seekTo, showLyricsEditor]);

  // Trigger enter animation on line change (animate the newly active line)
  const prevLineRef = useRef<LyricLine | null>(null);
  const prevLineIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (currentLine && currentLine !== prevLineRef.current) {
      prevLineRef.current = currentLine;
      prevLineIndexRef.current = currentLineIndex;
      const el = previewRef.current?.querySelector(".kt-preview-line--active");
      if (el) preset.enterAnimation(el as HTMLElement);
    }
  }, [currentLine, currentLineIndex, preset]);

  // Auto-scroll lyrics to keep current line centered.
  // The scrollable element is .kt-preview-lines (overflow-y: auto);
  // offsets are measured against their common offset parent.
  useEffect(() => {
    const wrapper = lyricsContainerRef.current;
    if (!wrapper || currentLineIndex < 0) return;
    const scroller = wrapper.querySelector<HTMLElement>(".kt-preview-lines");
    const activeEl = wrapper.querySelector<HTMLElement>(`[data-line-index="${currentLineIndex}"]`);
    if (!scroller || !activeEl) return;
    const targetScroll =
      activeEl.offsetTop - scroller.offsetTop - scroller.clientHeight / 2 + activeEl.offsetHeight / 2;
    scroller.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
  }, [currentLineIndex, lyrics]);

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
        setLyricsData(legacyToLyricsData(lines));
        setLyricsSource("database");
        return;
      }
    } catch {
      // No database lyrics found, try LRC
    }

    // Try bundled LRC file (prefer over CSV when available).
    // Public dir first (/audio/*.lrc in vite public), then the backend's
    // audio file endpoint — mirrors Visualizer.tsx's fallback chain.
    try {
      // Try exact track name first, then with spaces normalized
      const candidates = [
        `${trackName}.lrc`,
        `${trackName.replace(/[^a-z0-9]+/gi, " ").trim()}.lrc`,
      ];
      const sources = [
        (f: string) => `/audio/${encodeURIComponent(f)}`,
        (f: string) => `/api/audio/file/${encodeURIComponent(f)}`,
      ];
      for (const lrcFile of candidates) {
        for (const toUrl of sources) {
          const lrcResponse = await fetch(toUrl(lrcFile));
          if (lrcResponse.ok) {
            const lrcContent = await lrcResponse.text();
            const lrcLines = parseLrc(lrcContent);
            if (lrcLines.length > 0) {
              setLyrics(lrcLines);
              setLyricsData(legacyToLyricsData(lrcLines));
              setLyricsSource("lrc");
              return;
            }
          }
        }
      }
    } catch {
      // No LRC file found, try CSV
    }

    // Fallback to CSV parsing
    const parsedLyrics = parseLyricsFromCsv(csvContent, trackName, duration);
    if (parsedLyrics.length > 0) {
      setLyrics(parsedLyrics);
      setLyricsData(legacyToLyricsData(parsedLyrics));
      setLyricsSource("csv");
    } else {
      setLyricsSource("none");
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

  // Transcribe audio and load synced lyrics.
  // transcribeAudio() already returns word-timed segments — use them directly
  // instead of a second fetch (the old /transcript/lyrics endpoint doesn't exist).
  const handleTranscribe = useCallback(async (filename: string) => {
    setIsTranscribing(true);
    setTranscriptionStatus("Starting transcription...");

    try {
      setTranscriptionStatus("Transcribing with Whisper...");
      const result = await transcribeAudio(filename);

      if (result.segments && result.segments.length > 0) {
        const lines: LyricLine[] = result.segments.map((l) => ({
          start: l.start,
          end: l.end,
          text: l.text,
          words: l.words,
          section: l.section || "VERSE",
        }));
        setLyrics(lines);
        setLyricsData(legacyToLyricsData(lines));
        setLyricsSource("database");
        setTranscriptionStatus(`Transcribed ${lines.length} lines (edit to refine)`);
      } else {
        setTranscriptionStatus("Transcription returned no lyrics");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTranscriptionStatus(`Transcription failed: ${msg}`);
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const trackRequestRef = useRef(0);
  const handleTrackSelect = useCallback(async (filename: string) => {
    const file = libraryFiles.find(f => f.filename === filename);
    if (!file) return;

    // Guard against out-of-order responses when switching tracks quickly:
    // only the latest request may update state.
    const requestId = ++trackRequestRef.current;

    // Pause current audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    setSelectedTrack(file);
    setElapsed(0);
    lastBeatIdxRef.current = -1;
    setIsLoadingAnalysis(true);
    setLyricsSource("loading");

    try {
      // Ensure analysis exists (runs if not cached)
      const result = await ensureAnalysis(filename);
      if (trackRequestRef.current !== requestId) return;
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
      if (trackRequestRef.current !== requestId) return;
      // Fallback to basic info
      setSelectedTrack({ ...file, duration: 60 });
    } finally {
      if (trackRequestRef.current === requestId) setIsLoadingAnalysis(false);
    }
  }, [libraryFiles, autoPreset, loadLyricsForTrack]);

  // If the lyrics CSV finished loading after a track was selected (both load
  // in parallel on mount), retry the CSV fallback once instead of leaving
  // stale sample lyrics with source "none".
  useEffect(() => {
    if (csvContent && selectedTrack && lyricsSource === "none") {
      loadLyricsForTrack(selectedTrack.name, selectedTrack.filename, selectedTrack.duration || 60);
    }
  }, [csvContent, selectedTrack, lyricsSource, loadLyricsForTrack]);

  // When library files load, check for pending track from Audio Analysis
  // or auto-select the first real track
  useEffect(() => {
    if (pendingTrackRef.current && libraryFiles.length > 0) {
      const match = libraryFiles.find(f => f.filename === pendingTrackRef.current);
      if (match) {
        handleTrackSelect(match.filename);
        pendingTrackRef.current = null;
        return;
      }
    }
    // Auto-select first real track when library loads and nothing is selected
    if (!selectedTrack && libraryFiles.length > 0) {
      handleTrackSelect(libraryFiles[0].filename);
    }
  }, [libraryFiles.length, handleTrackSelect, selectedTrack]);

  const handlePresetChange = useCallback((id: string) => {
    setAutoPreset(false);
    setActivePreset(id);
  }, []);

  const resetSettings = useCallback(() => {
    setFontSize(40);
    setGlowIntensity(0.7);
    setShowSectionLabel(true);
    setBeatPulse(true);
    setActivePreset("cinematic");
    setAutoPreset(true);
    setVolume(0.8);
    setIsMuted(false);
    setVisualPresetId("default");
    setVideoJob(null);
    setVideoJobError(null);
    setTranscriptionStatus("");
  }, []);

  const toggleSection = useCallback((key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleGenerateVideo = useCallback(async () => {
    if (!selectedTrack) return;
    setIsGeneratingVideo(true);
    setVideoJob(null);
    setVideoJobError(null);
    try {
      const result = await generateKineticVideo({
        audio_filename: selectedTrack.filename,
        duration: selectedTrack.duration || 60,
        preset_id: activePreset,
        lyrics: lyrics,
        prompt: `Kinetic typography lyric video with ${activePreset} preset`,
      });
      setVideoJob(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setVideoJobError(msg);
    } finally {
      setIsGeneratingVideo(false);
    }
  }, [selectedTrack, activePreset, lyrics]);

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
             <div
               className="kt-preview-lyrics"
               ref={lyricsContainerRef}
             >
               {showSectionLabel && currentLine && (
                 <div className="kt-preview-section" style={{ color: currentColor }}>{currentLine.section}</div>
               )}
               <div className="kt-preview-lines">
                 {lyrics.map((line, idx) => {
                   const isCurrent = idx === currentLineIndex;
                   const distance = currentLineIndex >= 0 ? Math.abs(idx - currentLineIndex) : 99;
                   const opacity = distance === 0 ? 1 : distance <= 1 ? 0.55 : distance <= 2 ? 0.25 : 0.08;
                   const scale = distance === 0 ? 1 : distance <= 1 ? 0.97 : 0.94;
                   const filter = distance >= 3 ? "blur(2px)" : distance === 2 ? "blur(1px)" : "none";
                   const isPast = currentLineIndex >= 0 && idx < currentLineIndex;
                   const lineColor = isCurrent ? currentColor : isPast ? `${currentColor}60` : "#52525b";
                   return (
                     <div
                       key={idx}
                       data-line-index={idx}
                       className={`kt-preview-line ${isCurrent ? "kt-preview-line--active" : ""} ${isPast ? "kt-preview-line--past" : ""}`}
                       style={{
                         color: lineColor,
                         fontSize: `${fontSize * scale}px`,
                         opacity,
                         filter,
                         textShadow: isCurrent && glowIntensity > 0
                           ? `0 0 ${20 * glowIntensity}px ${currentColor}, 0 0 ${40 * glowIntensity}px ${currentColor}40`
                           : "none",
                         transition: "opacity 0.35s ease, transform 0.35s ease, filter 0.35s ease, color 0.35s ease, font-size 0.2s ease",
                       }}
                     >
                       {line.words && line.words.length > 0 ? (
                         <WordHighlight line={line} time={elapsed} color={lineColor} glowIntensity={isCurrent ? glowIntensity : 0} />
                       ) : (
                         line.text || (selectedTrack ? "Press Play to start" : "Select a track and press Play")
                       )}
                     </div>
                   );
                 })}
               </div>
             </div>
          </div>

          {/* Transport */}
          <div className="kt-transport" role="group" aria-label="Playback controls">
            <button className="kt-transport-btn" onClick={() => seekTo(0)} aria-label="Restart" title="Restart (R)"><SkipBack size={14} /></button>
            <button className="kt-transport-btn kt-transport-play" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"} title="Play/Pause (Space)">
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="kt-transport-btn" onClick={() => seekTo(elapsedRef.current + 5)} aria-label="Forward 5 seconds" title="Forward 5s (→)"><SkipForward size={14} /></button>
            <div className="kt-scrubber">
              <input
                type="range"
                min="0"
                max={selectedTrack?.duration || 60}
                step="0.1"
                value={Math.min(elapsed, selectedTrack?.duration || 60)}
                onChange={(e) => seekTo(parseFloat(e.target.value))}
                className="kt-scrubber-input"
                aria-label="Seek"
              />
            </div>
            <span className="kt-time">{formatTime(elapsed)} / {formatTime(selectedTrack?.duration || 60)}</span>
            <button className="kt-transport-btn" onClick={() => setIsMuted(m => !m)} aria-label={isMuted ? "Unmute" : "Mute"} title="Mute (M)">
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
              aria-label="Volume"
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
          <div className="kt-section-collapsible">
            <button className="kt-section-toggle" data-open={openSections.track ? "true" : "false"} onClick={() => toggleSection("track")}>
              <ChevronDown size={12} />
              <span>Track Selection</span>
            </button>
            <div className="kt-section-body" data-open={openSections.track ? "true" : "false"}>
              <div className="kt-section">
                <label className="kt-field-label" htmlFor="kt-track-select">Track</label>
                <select
                  id="kt-track-select"
                  className="kt-select"
                  aria-label="Select track"
                  value={selectedTrack?.filename || ""}
                  onChange={(e) => e.target.value ? handleTrackSelect(e.target.value) : setSelectedTrack(null)}
                >
                  <option value="">Demo Mode (Sample Lyrics)</option>
                  {libraryFiles.map(f => (
                    <option key={f.filename} value={f.filename}>{f.name}</option>
                  ))}
                </select>
                {libraryFiles.length === 0 && (
                  <span className="kt-transcription-status">
                    No audio in the library yet — upload a track from Audio Analysis to enable real playback.
                  </span>
                )}
                {selectedTrack && (
                  <div className="kt-track-meta">
                    {selectedTrack.bpm && <span className="kt-badge">{selectedTrack.bpm} BPM</span>}
                    {selectedTrack.duration && <span className="kt-badge">{Math.round(selectedTrack.duration)}s</span>}
                    {selectedTrack.energy && <span className="kt-badge">Energy {(selectedTrack.energy * 100).toFixed(0)}%</span>}
                    {selectedTrack.beatTimes && <span className="kt-badge">{selectedTrack.beatTimes.length} beats</span>}
                  </div>
                )}
                {selectedTrack && lyricsSource !== "none" && lyricsSource !== "loading" && (
                  <span className={`kt-transcription-status ${lyricsSource === "lrc" ? "text-emerald-400" : lyricsSource === "database" ? "text-blue-400" : "text-amber-400"}`}>
                    Lyrics: {lyricsSource === "lrc" ? "LRC file" : lyricsSource === "database" ? "Saved lyrics" : "CSV fallback"}
                  </span>
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
                {selectedTrack && (
                  <button
                    className="kt-btn kt-btn-primary"
                    onClick={handleGenerateVideo}
                    disabled={isGeneratingVideo}
                  >
                    {isGeneratingVideo ? (
                      <><Loader2 size={12} className="kt-spin" /> Generating...</>
                    ) : (
                      <><Film size={12} /> Generate Lyric Video</>
                    )}
                  </button>
                )}
                {videoJob && (
                  <span className="kt-transcription-status text-emerald-400">
                    {videoJob.message || `Queued job ${videoJob.job_id?.slice(0, 8)}`}
                  </span>
                )}
                {videoJobError && (
                  <span className="kt-transcription-status text-red-400">{videoJobError}</span>
                )}
                {transcriptionStatus && (
                  <span className="kt-transcription-status">{transcriptionStatus}</span>
                )}
              </div>
            </div>
          </div>

          {/* Preset Selector */}
          <div className="kt-section-collapsible">
            <button className="kt-section-toggle" data-open={openSections.preset ? "true" : "false"} onClick={() => toggleSection("preset")}>
              <ChevronDown size={12} />
              <span>Animation Preset</span>
            </button>
            <div className="kt-section-body" data-open={openSections.preset ? "true" : "false"}>
              <div className="kt-section">
                <label className="kt-auto-toggle">
                  <input type="checkbox" checked={autoPreset} onChange={(e) => setAutoPreset(e.target.checked)} />
                  Auto
                </label>
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
            </div>
          </div>

          {/* Visual Preset Selector */}
          <div className="kt-section-collapsible">
            <button className="kt-section-toggle" data-open={openSections.visualPreset ? "true" : "false"} onClick={() => toggleSection("visualPreset")}>
              <ChevronDown size={12} />
              <span>Visual Preset</span>
            </button>
            <div className="kt-section-body" data-open={openSections.visualPreset ? "true" : "false"}>
              <div className="kt-section">
                <PresetSelector
                  currentPresetId={visualPresetId}
                  onSelect={(preset) => {
                    setVisualPresetId(preset.id);
                    setFontSize(preset.lyrics.fontSize);
                    setGlowIntensity(preset.lyrics.glowIntensity);
                    applyVisualPreset(preset);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Style Controls */}
          <div className="kt-section-collapsible">
            <button className="kt-section-toggle" data-open={openSections.style ? "true" : "false"} onClick={() => toggleSection("style")}>
              <ChevronDown size={12} />
              <span>Style</span>
            </button>
            <div className="kt-section-body" data-open={openSections.style ? "true" : "false"}>
              <div className="kt-section">
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
            </div>
          </div>

          {/* Display Options */}
          <div className="kt-section-collapsible">
            <button className="kt-section-toggle" data-open={openSections.display ? "true" : "false"} onClick={() => toggleSection("display")}>
              <ChevronDown size={12} />
              <span>Display</span>
            </button>
            <div className="kt-section-body" data-open={openSections.display ? "true" : "false"}>
              <div className="kt-section">
                <label className="kt-toggle">
                  <input type="checkbox" checked={showSectionLabel} onChange={(e) => setShowSectionLabel(e.target.checked)} />
                  <span>Show section labels</span>
                </label>
                <label className="kt-toggle">
                  <input type="checkbox" checked={beatPulse} onChange={(e) => setBeatPulse(e.target.checked)} />
                  <span>Beat pulse animation</span>
                </label>
              </div>
            </div>
          </div>

          {/* Preset Details */}
          <div className="kt-section-collapsible">
            <button className="kt-section-toggle" data-open={openSections.presetDetails ? "true" : "false"} onClick={() => toggleSection("presetDetails")}>
              <ChevronDown size={12} />
              <span>Active Preset: {preset.name}</span>
            </button>
            <div className="kt-section-body" data-open={openSections.presetDetails ? "true" : "false"}>
              <div className="kt-section">
                <p className="kt-preset-detail">{preset.description}</p>
                <div className="kt-preset-genres">
                  {preset.genres.map(g => (
                    <span key={g} className="kt-preset-genre">{g}</span>
                  ))}
                </div>
              </div>
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
