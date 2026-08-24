/**
 * Music Video Workspace - Enhanced audio upload and visualization creation
 * Features: Real-time audio analysis, beat detection, style templates, batch processing
 * Now with backend integration for audio upload and job processing.
 */

import {
    Clock,
    Eye,
    Film,
    Layers,
    ListMusic,
    Music,
    Palette,
    RefreshCw,
    Send,
    Settings,
    Trash2,
    Upload,
    CheckCircle,
    AlertCircle,
    Sparkles,
} from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import {
  AudioVisualizer,
  BeatTimeline,
  StyleTemplateGallery,
  type BeatMarker,
  type StyleTemplate,
} from "../../components/audio";
import { AIVisualsPanel } from "../../components/ai";
import { Card, EmptyState, ProgressBar } from "../../components/common";
import { TrackManager } from "../../components/tracks";
import {
  transformMusicToVisualPrompt,
  type VisualPromptResult,
} from "../../services/promptTransformer";
import {
  estimateVideoGeneration,
  calculateFrameCount,
  formatDuration,
} from "../../services/generationEstimator";
import { useJobStore } from "../../state/jobStore";
import { uploadAudioFile, saveAIVisual } from "../../services/api";

// ============================================================================
// Beat Detection Utilities
// ============================================================================

/**
 * Detect beats from a File object using the Web Audio API.
 */
async function detectBeatsFromFile(file: File): Promise<BeatMarker[]> {
  const arrayBuffer = await file.arrayBuffer();
  return detectBeatsFromBuffer(arrayBuffer);
}

/**
 * Detect beats from an audio URL using the Web Audio API.
 */
async function detectBeats(audioUrl: string): Promise<BeatMarker[]> {
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();
  return detectBeatsFromBuffer(arrayBuffer);
}

/**
 * Core beat detection from an ArrayBuffer.
 * Uses time-domain energy analysis for reliable beat detection.
 */
async function detectBeatsFromBuffer(arrayBuffer: ArrayBuffer): Promise<BeatMarker[]> {
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  // Compute energy envelope using RMS in short windows
  const windowSize = Math.floor(sampleRate * 0.025); // 25ms windows
  const hopSize = Math.floor(windowSize / 2); // 50% overlap
  const energies: number[] = [];
  const times: number[] = [];

  for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      const sample = channelData[i + j];
      sum += sample * sample;
    }
    energies.push(Math.sqrt(sum / windowSize));
    times.push(i / sampleRate);
  }

  // Compute first derivative (energy increase = potential onset)
  const derivative: number[] = [0];
  for (let i = 1; i < energies.length; i++) {
    derivative.push(Math.max(0, energies[i] - energies[i - 1]));
  }

  // Adaptive threshold using local median
  const onsets: number[] = [];
  const windowFrames = 15;

  for (let i = windowFrames; i < derivative.length - windowFrames; i++) {
    const window: number[] = [];
    for (let j = i - windowFrames; j <= i + windowFrames; j++) {
      window.push(derivative[j]);
    }
    window.sort((a, b) => a - b);
    const median = window[Math.floor(window.length / 2)];

    const threshold = Math.max(median * 1.8, 0.001);

    if (derivative[i] > threshold) {
      let isMax = true;
      for (let j = Math.max(0, i - 3); j <= Math.min(derivative.length - 1, i + 3); j++) {
        if (j !== i && derivative[j] > derivative[i]) {
          isMax = false;
          break;
        }
      }
      if (isMax) {
        onsets.push(times[i]);
      }
    }
  }

  // If too few onsets, lower threshold
  if (onsets.length < duration * 0.5) {
    for (let i = 0; i < derivative.length; i++) {
      const avg = derivative.reduce((a, b) => a + b, 0) / derivative.length;
      if (derivative[i] > avg * 2 && !onsets.includes(times[i])) {
        onsets.push(times[i]);
      }
    }
    onsets.sort((a, b) => a - b);
  }

  // Estimate tempo from inter-onset intervals
  const tempo = estimateTempo(onsets, duration);
  const beatInterval = 60 / tempo;

  // Generate beat grid aligned to first onset
  const beats: number[] = [];
  const firstBeat = onsets[0] || 0;
  for (let t = firstBeat; t < duration; t += beatInterval) {
    let closest: number | null = null;
    let minDist = beatInterval * 0.25;

    for (const onset of onsets) {
      const dist = Math.abs(onset - t);
      if (dist < minDist) {
        minDist = dist;
        closest = onset;
      }
    }

    beats.push(closest !== null ? closest : t);
  }

  // Classify beats
  const avgEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
  const highThreshold = avgEnergy * 1.5;

  const markers: BeatMarker[] = beats.map((time, i) => {
    const idx = Math.floor(time / duration * energies.length);
    const energy = energies[Math.min(idx, energies.length - 1)] || 0;
    const beatInMeasure = i % 4;
    const isDownbeat = beatInMeasure === 0;

    return {
      id: `beat-${time.toFixed(3)}`,
      time,
      intensity: energy > highThreshold || isDownbeat ? "high" : "medium",
      type: isDownbeat ? "drop" : "beat",
    };
  });

  await audioCtx.close();
  return markers;
}

/**
 * Estimate tempo from inter-onset intervals.
 */
function estimateTempo(onsets: number[], duration: number): number {
  if (onsets.length < 4) return 120;

  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const interval = onsets[i] - onsets[i - 1];
    if (interval > 0.15 && interval < 1.5) {
      intervals.push(interval);
    }
  }

  if (intervals.length === 0) return 120;

  const histogram = new Map<number, number>();
  for (const interval of intervals) {
    const quantized = Math.round(interval * 100) / 100;
    histogram.set(quantized, (histogram.get(quantized) || 0) + 1);
  }

  let maxCount = 0;
  let beatInterval = 0.5;
  for (const [interval, count] of histogram) {
    if (count > maxCount) {
      maxCount = count;
      beatInterval = interval;
    }
  }

  let bpm = 60 / beatInterval;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;

  return Math.round(bpm);
}

/**
 * Generate fallback beat markers.
 */
function generateFallbackMarkers(duration: number): BeatMarker[] {
  const bpm = 120;
  const beatInterval = 60 / bpm;
  const markers: BeatMarker[] = [];
  for (let t = 0; t < duration; t += beatInterval) {
    const isDownbeat = Math.floor(t / beatInterval) % 4 === 0;
    markers.push({
      id: `beat-${t.toFixed(2)}`,
      time: t,
      intensity: isDownbeat ? "high" : "medium",
      type: isDownbeat ? "drop" : "beat",
    });
  }
  return markers;
}

/**
 * Estimate BPM from audio duration (simple fallback).
 */
function estimateBpm(duration: number): number {
  const commonBpms = [90, 100, 110, 120, 128, 130, 140, 150, 160, 170, 180];
  const index = Math.floor((duration * 13.37) % commonBpms.length);
  return commonBpms[Math.abs(index) % commonBpms.length];
}

/**
 * Generate an optimized default prompt for AI visual generation
 * based on audio metadata (filename, duration, beat patterns).
 */
function generateDefaultPrompt(
  fileName: string,
  duration: number,
  beatMarkers: BeatMarker[]
): string {
  // Clean filename: remove extension, replace separators with spaces
  const cleanName = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Detect energy level from beat density
  const beatDensity = duration > 0 ? beatMarkers.length / duration : 0;
  const highEnergy = beatDensity > 2;
  const medEnergy = beatDensity > 1;

  // Detect tempo feel from duration patterns
  const isLongForm = duration > 180;
  const isShortForm = duration < 60;

  // Build style descriptors based on audio characteristics
  const energyWords = highEnergy
    ? "high-energy, dynamic, intense"
    : medEnergy
      ? "rhythmic, flowing, pulsating"
      : "atmospheric, ambient, meditative";

  const paceWords = isLongForm
    ? "cinematic, expansive, evolving"
    : isShortForm
      ? "punchy, impactful, staccato"
      : "balanced, steady, groovy";

  // Construct the prompt with rich descriptive language
  return `Music video visual for "${cleanName}" — ${energyWords}, ${paceWords} style. Abstract visuals with synchronized light trails, particle systems, and color shifts that react to the beat. Deep vibrant colors, volumetric lighting, lens flares, motion blur, 4K, ultra detailed, professional music video aesthetic, audio-reactive elements, synchronized to rhythm`;
}


interface AudioFile {
  file: File;
  name: string;
  size: number;
  duration?: number;
  previewUrl?: string;
  storedPath?: string;
  analysisJobId?: string;
}

interface VisualizationConfig {
  style: "abstract" | "waveform" | "particles" | "geometric";
  duration: "30s" | "60s" | "90s" | "full";
  resolution: "720p" | "1080p" | "4k";
  fps: 30 | 60;
  colorScheme: "auto" | "warm" | "cool" | "neon" | "monochrome";
  quality: "draft" | "standard" | "high";
}

interface BatchJob {
  id: string;
  audioFile: AudioFile;
  config: VisualizationConfig;
  styleTemplate: StyleTemplate | null;
  beatMarkers: BeatMarker[];
  status: "pending" | "processing" | "complete" | "error";
  progress: number;
  outputUrl?: string;
}

const defaultConfig: VisualizationConfig = {
  style: "abstract",
  duration: "60s",
  resolution: "1080p",
  fps: 30,
  colorScheme: "auto",
  quality: "standard",
};

export function MusicVideo() {
  // Audio state
  const [audioFile, setAudioFile] = useState<AudioFile | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [beatMarkers, setBeatMarkers] = useState<BeatMarker[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // AI Visuals state
  const [musicGenerationPrompt, setMusicGenerationPrompt] = useState("");
  const [aiVisualPrompt, setAiVisualPrompt] = useState("");
  const [selectedVisual, setSelectedVisual] = useState<string | null>(null);

  // Job submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Visualization config
  const [config, setConfig] = useState<VisualizationConfig>(defaultConfig);
  const [selectedStyle, setSelectedStyle] = useState<StyleTemplate | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<
    "tracks" | "audio" | "ai-visuals" | "style" | "timeline" | "batch"
  >("tracks");

  // Batch processing state
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  const [showBatchPanel, setShowBatchPanel] = useState(false);

  // Job store
  const { createJob, jobs, isLoading: jobLoading } = useJobStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Handle file selection
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      const validTypes = [
        "audio/mpeg",
        "audio/wav",
        "audio/flac",
        "audio/ogg",
        "audio/mp4",
        "audio/x-m4a",
      ];
      if (
        !validTypes.includes(file.type) &&
        !file.name.match(/\.(mp3|wav|flac|ogg|m4a)$/i)
      ) {
        setSubmitError(
          "Please select a valid audio file (MP3, WAV, FLAC, OGG, M4A)",
        );
        return;
      }

      // Create preview URL
      const previewUrl = URL.createObjectURL(file);

      const newAudioFile: AudioFile = {
        file,
        name: file.name,
        size: file.size,
        previewUrl,
      };

      setAudioFile(newAudioFile);
      setSubmitError(null);
      setSubmitSuccess(false);
      setPreviewUrl(null);
      setBeatMarkers([]);

      // Upload to backend
      await uploadAndAnalyzeAudio(newAudioFile);
    },
    [],
  );

  // Upload audio file to backend and start analysis
  const uploadAndAnalyzeAudio = useCallback(async (audio: AudioFile) => {
    setIsUploading(true);
    setUploadProgress(0);
    setIsAnalyzing(true);
    setAnalyzeProgress(0);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      // Upload file to backend
      const response = await uploadAudioFile(audio.file);

      clearInterval(progressInterval);
      setUploadProgress(100);

      // Update audio file with stored path
      setAudioFile((prev) =>
        prev ? { ...prev, storedPath: response.stored_path } : null,
      );

      // Get audio duration
      if (audio.previewUrl) {
        const audioEl = new Audio(audio.previewUrl);
        audioRef.current = audioEl;

        await new Promise<void>((resolve) => {
          audioEl.addEventListener("loadedmetadata", () => {
            setAudioFile((prev) =>
              prev ? { ...prev, duration: audioEl.duration } : null,
            );
            setAudioDuration(audioEl.duration);
            resolve();
          });
          audioEl.addEventListener("error", () => resolve());
        });
      }

      // Simulate analysis progress (real analysis happens via job)
      for (let i = 0; i <= 100; i += 5) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        setAnalyzeProgress(i);
      }

      // Auto-detect beat markers using real audio analysis
      const autoMarkers: BeatMarker[] = [];
      if (audioDuration > 0 && audio.file) {
        try {
          const markers = await detectBeatsFromFile(audio.file);
          if (markers.length === 0) throw new Error("No beats detected");
          setBeatMarkers(markers);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Beat detection failed";
          setSubmitError(`${msg} — check audio file or use Analyze tab for server-side librosa. Falling back to 120 BPM grid.`);
          const bpm = estimateBpm(audioDuration);
          const beatInterval = 60 / bpm;
          for (let t = 0; t < audioDuration; t += beatInterval) {
            autoMarkers.push({
              id: `beat-${t.toFixed(2)}`,
              time: t,
              intensity: t % (beatInterval * 4) < beatInterval / 2 ? "high" : "medium",
              type: t % (beatInterval * 8) < beatInterval / 2 ? "drop" : "beat",
            });
          }
          setBeatMarkers(autoMarkers);
        }
      }

      // Create audio analysis job on backend
      if (response.stored_path) {
        const job = await createJob("audio_feature_extraction", {
          audio_path: response.stored_path,
          audio_filename: audio.name,
        });
        setAudioFile((prev) =>
          prev ? { ...prev, analysisJobId: job.id } : null,
        );
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to upload audio",
      );
    } finally {
      setIsUploading(false);
      setIsAnalyzing(false);
    }
  }, [audioDuration, createJob]);

  // Handle beat detection
  const handleBeatDetected = useCallback((time: number, intensity: number) => {
    console.log("Beat detected:", time, intensity);
  }, []);

  // Generate preview video
  const handleGeneratePreview = useCallback(async () => {
    if (!audioFile) return;

    setIsGeneratingPreview(true);
    setPreviewProgress(0);

    try {
      // Create a preview job on the backend
      const job = await createJob("music_video_preview", {
        audio_path: audioFile.storedPath || audioFile.name,
        audio_filename: audioFile.name,
        visualization: {
          style: config.style,
          duration: config.duration,
          resolution: "720p", // Preview is always 720p
          fps: 30,
          color_scheme: config.colorScheme,
          quality: "draft",
        },
        style_template: selectedStyle?.id,
        beat_markers: beatMarkers.slice(0, 50), // Limit markers for preview
      });

      // Simulate progress while waiting for job
      for (let i = 0; i <= 90; i += 5) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        setPreviewProgress(i);
      }

      setPreviewProgress(100);
      // Preview URL would come from job result
      setPreviewUrl(`/output/previews/${job.id}.mp4`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to generate preview",
      );
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [audioFile, config, selectedStyle, beatMarkers, createJob]);

  // Add to batch
  const addToBatch = useCallback(() => {
    if (!audioFile) return;

    const newJob: BatchJob = {
      id: `batch-${Date.now()}`,
      audioFile,
      config: { ...config },
      styleTemplate: selectedStyle,
      beatMarkers: [...beatMarkers],
      status: "pending",
      progress: 0,
    };

    setBatchJobs((prev) => [...prev, newJob]);
    setShowBatchPanel(true);

    // Clear current
    setAudioFile(null);
    setBeatMarkers([]);
    setSelectedStyle(null);
    setPreviewUrl(null);
  }, [audioFile, config, selectedStyle, beatMarkers]);

  // Remove from batch
  const removeFromBatch = useCallback((id: string) => {
    setBatchJobs((prev) => prev.filter((job) => job.id !== id));
  }, []);

  // Process batch
  const processBatch = useCallback(async () => {
    for (const job of batchJobs.filter((j) => j.status === "pending")) {
      setBatchJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: "processing" } : j)),
      );

      await createJob("music_video", {
        audio_path: job.audioFile.storedPath || job.audioFile.name,
        audio_filename: job.audioFile.name,
        visualization: {
          style: job.config.style,
          duration: job.config.duration,
          resolution: job.config.resolution,
          fps: job.config.fps,
          color_scheme: job.config.colorScheme,
          quality: job.config.quality,
        },
        style_template: job.styleTemplate?.id,
        beat_markers: job.beatMarkers,
      });

      setBatchJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, status: "complete", progress: 100 } : j,
        ),
      );
    }
  }, [batchJobs, createJob]);

  // Handle job submission
  const handleSubmit = useCallback(async () => {
    if (!audioFile) {
      setSubmitError("Please upload an audio file first");
      return;
    }
    if (!audioFile.storedPath) {
      setSubmitError("Audio file is still uploading. Please wait.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      // Submit music video generation job to queue
      await createJob("music_video", {
        audio_path: audioFile.storedPath,
        audio_filename: audioFile.name,
        audio_size: audioFile.size,
        visualization: {
          style: config.style,
          duration: config.duration,
          resolution: config.resolution,
          fps: config.fps,
          color_scheme: config.colorScheme,
          quality: config.quality,
        },
        style_template: selectedStyle?.id,
        beat_markers: beatMarkers,
      }, 3);

      setSubmitSuccess(true);

      // Reset success state after 3 seconds
      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to submit job",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [audioFile, config, selectedStyle, beatMarkers, createJob]);

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Format duration
  const formatDuration = (seconds?: number): string => {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Get recent music video jobs
  const musicVideoJobs = jobs
    .filter((j) => j.job_type === "music_video" || j.job_type === "music_video_preview")
    .slice(0, 5);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Music Video Studio</h1>
          <p className="text-muted mt-1">
            Create AI-powered music visualizations with ComfyUI
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBatchPanel(!showBatchPanel)}
            className={`btn btn-secondary flex items-center gap-2 ${showBatchPanel ? "btn-primary" : ""}`}
          >
            <Layers size={18} />
            Batch ({batchJobs.length})
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {submitError && (
        <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg flex items-center gap-2 text-error">
          <AlertCircle size={16} />
          <span className="text-sm">{submitError}</span>
          <button
            onClick={() => setSubmitError(null)}
            className="ml-auto text-error hover:text-error/80"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
      {submitSuccess && (
        <div className="mb-4 p-3 bg-success/10 border border-success/20 rounded-lg flex items-center gap-2 text-success">
          <CheckCircle size={16} />
          <span className="text-sm">Job submitted successfully!</span>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-border pb-2">
        {[
          { id: "tracks", label: "Tracks", icon: ListMusic },
          { id: "audio", label: "Audio & Analysis", icon: Music },
          { id: "ai-visuals", label: "AI Visuals", icon: Sparkles },
          { id: "style", label: "Visual Style", icon: Palette },
          { id: "timeline", label: "Beat Timeline", icon: Clock },
          { id: "batch", label: "Batch Queue", icon: Layers },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              activeTab === id
                ? "bg-primary text-primary-foreground"
                : "text-muted hover:text-foreground hover:bg-background"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* Left Column - Main Content */}
        <div className="lg:col-span-2 space-y-4 lg:space-y-6">
        {/* Tracks Tab */}
        {activeTab === "tracks" && (
          <Card title="Track Library" icon={<ListMusic size={18} className="text-blue-400" />}>
            <TrackManager
              onSelectTrack={(track) => {
                // Load the selected track into the audio tab
                // Note: We can't create a real File from a path, so we store the path for reference
                // The user will need to upload the actual file for processing
                setAudioFile({
                  file: new File([], track.filename),
                  name: track.title,
                  size: track.size_mb * 1024 * 1024,
                  duration: track.duration_seconds,
                  previewUrl: track.source_path,
                  storedPath: track.source_path,
                });
                setAudioDuration(track.duration_seconds);
                setMusicGenerationPrompt(track.music_prompt);
                // Switch to AI Visuals tab since we have the prompt data
                setAiVisualPrompt(track.music_prompt || "");
                setActiveTab("ai-visuals");
              }}
            />
          </Card>
        )}

        {/* Audio Tab — Upload & Analysis */}
        {activeTab === "audio" && (
            <>
              {/* Audio Input */}
              <Card title="Audio Input">
                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="audio-upload"
                    disabled={isSubmitting || isUploading}
                  />

                  {audioFile ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3">
                        <Music size={32} className="text-primary" />
                        <div className="text-left min-w-0">
                          <p className="font-medium truncate">{audioFile.name}</p>
                          <p className="text-sm text-muted">
                            {formatSize(audioFile.size)}
                            {audioFile.duration &&
                              ` • ${formatDuration(audioFile.duration)}`}
                          </p>
                          {audioFile.storedPath && (
                            <p className="text-xs text-success mt-1 flex items-center gap-1">
                              <CheckCircle size={12} />
                              Uploaded to server
                            </p>
                          )}
                        </div>
                      </div>

                      <label
                        htmlFor="audio-upload"
                        className={`btn btn-ghost text-sm inline-flex items-center gap-2 cursor-pointer ${isSubmitting || isUploading ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <Upload size={14} />
                        Change Audio
                      </label>
                    </div>
                  ) : (
                    <label
                      htmlFor="audio-upload"
                      className="cursor-pointer block"
                    >
                      <Upload size={48} className="mx-auto text-muted mb-4" />
                      <p className="text-muted">Click to upload audio file</p>
                      <p className="text-xs text-muted mt-1">
                        MP3, WAV, FLAC, OGG, M4A supported (max 500 MB)
                      </p>
                    </label>
                  )}
                </div>

                {/* Upload Progress */}
                {isUploading && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-muted">Uploading audio...</span>
                      <span className="font-medium">
                        {Math.round(uploadProgress)}%
                      </span>
                    </div>
                    <ProgressBar progress={uploadProgress / 100} />
                  </div>
                )}

                {/* Analysis Progress */}
                {isAnalyzing && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-muted">Analyzing audio...</span>
                      <span className="font-medium">
                        {Math.round(analyzeProgress)}%
                      </span>
                    </div>
                    <ProgressBar progress={analyzeProgress / 100} />
                  </div>
                )}
              </Card>

              {/* Audio Visualizer */}
              {audioFile?.previewUrl && (
                <Card title="Audio Waveform & Beat Detection" className="mb-6">
                  <AudioVisualizer
                    audioUrl={audioFile.previewUrl}
                    onBeatDetected={handleBeatDetected}
                    beatMarkers={beatMarkers}
                    onMarkerClick={(marker) =>
                      console.log("Marker clicked:", marker)
                    }
                  />
                </Card>
              )}

              {/* Quick Settings */}
              <Card title="Quick Settings" icon={<Settings size={18} />}>
                <div className="grid grid-cols-2 gap-3 lg:gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted uppercase tracking-wide">Duration</label>
                    <select
                      className="select w-full"
                      value={config.duration}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          duration: e.target
                            .value as VisualizationConfig["duration"],
                        })
                      }
                      disabled={isSubmitting}
                    >
                      <option value="30s">30s</option>
                      <option value="60s">60s</option>
                      <option value="90s">90s</option>
                      <option value="full">Full</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted uppercase tracking-wide">Resolution</label>
                    <select
                      className="select w-full"
                      value={config.resolution}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          resolution: e.target
                            .value as VisualizationConfig["resolution"],
                        })
                      }
                      disabled={isSubmitting}
                    >
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                      <option value="4k">4K</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted uppercase tracking-wide">Frame Rate</label>
                    <select
                      className="select w-full"
                      value={config.fps}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          fps: Number(
                            e.target.value,
                          ) as VisualizationConfig["fps"],
                        })
                      }
                      disabled={isSubmitting}
                    >
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted uppercase tracking-wide">Quality</label>
                    <select
                      className="select w-full"
                      value={config.quality}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          quality: e.target
                            .value as VisualizationConfig["quality"],
                        })
                      }
                      disabled={isSubmitting}
                    >
                      <option value="draft">Draft</option>
                      <option value="standard">Standard</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>
              </Card>

              {/* Submit Button */}
              <Card>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={handleSubmit}
                      disabled={isSubmitting || !audioFile?.storedPath || isUploading}
                      className="btn btn-primary btn-lg flex-1 flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw size={18} className="animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <Send size={18} />
                          Generate Music Video
                        </>
                      )}
                    </button>
                    <button
                      onClick={addToBatch}
                      disabled={!audioFile?.storedPath || isUploading}
                      className="btn btn-ghost flex items-center gap-2"
                    >
                      <Layers size={16} />
                      Add to Batch
                    </button>
                  </div>
                  {!audioFile?.storedPath && audioFile && (
                    <p className="text-xs text-muted">
                      Waiting for upload to complete before submission...
                    </p>
                  )}
                </div>
              </Card>

              {/* Recent Jobs */}
              {musicVideoJobs.length > 0 && (
                <Card title="Recent Music Video Jobs">
                  <div className="space-y-2">
                    {musicVideoJobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between p-3 bg-background rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Film size={16} className="text-muted" />
                          <div>
                            <p className="text-sm font-medium">
                              {job.job_type.replace(/_/g, " ")}
                            </p>
                            <p className="text-xs text-muted">
                              {job.message || "Processing..."}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted">
                            {Math.round(job.progress * 100)}%
                          </span>
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              job.status === "completed"
                                ? "bg-success/20 text-success"
                                : job.status === "running"
                                  ? "bg-primary/20 text-primary"
                                  : job.status === "failed"
                                    ? "bg-error/20 text-error"
                                    : "bg-yellow-500/20 text-yellow-400"
                            }`}
                          >
                            {job.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}

          {/* AI Visuals Tab — ComfyUI integration */}
          {activeTab === "ai-visuals" && (
            <>
              {/* Music Generation Prompt Input */}
              <Card title="Music Generation Prompt" icon={<Sparkles size={18} className="text-purple-400" />}>
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">
                    Paste the prompt you used to generate this track (e.g., from Suno, Udio) for highly accurate visual matching.
                  </p>
                  <textarea
                    value={musicGenerationPrompt}
                    onChange={(e) => {
                      setMusicGenerationPrompt(e.target.value);
                      if (e.target.value.trim() && audioFile) {
                        const result = transformMusicToVisualPrompt(
                          e.target.value,
                          audioFile.name.replace(/\.[^.]+$/, "")
                        );
                        setAiVisualPrompt(result.positive);
                      }
                    }}
                    placeholder="e.g., synthwave, upbeat, electronic, 80s aesthetic, retro-futuristic..."
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-purple-500"
                    rows={3}
                  />
                  {musicGenerationPrompt.trim() && aiVisualPrompt && (
                    <div className="p-2 bg-purple-900/20 border border-purple-800/50 rounded">
                      <p className="text-xs text-purple-300 font-medium mb-1">Transformed Visual Prompt:</p>
                      <p className="text-xs text-gray-300">{aiVisualPrompt}</p>
                    </div>
                  )}
                </div>
              </Card>

              {/* Frame Estimate */}
              {audioFile?.duration && (
                <Card title="Generation Estimate" icon={<Clock size={18} className="text-blue-400" />}>
                  <div className="space-y-2">
                    {(() => {
                      const fps = config.fps;
                      const totalFrames = calculateFrameCount(audioFile.duration, fps);
                      const estimate = estimateVideoGeneration({
                        audioDurationSeconds: audioFile.duration,
                        fps,
                        width: config.resolution === "4k" ? 3840 : config.resolution === "1080p" ? 1920 : 1280,
                        height: config.resolution === "4k" ? 2160 : config.resolution === "1080p" ? 1080 : 720,
                        steps: config.quality === "high" ? 25 : config.quality === "draft" ? 15 : 20,
                        keyframeInterval: 15,
                      });
                      return (
                        <>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2 bg-gray-800/50 rounded">
                              <p className="text-gray-400">Total Frames</p>
                              <p className="text-lg font-bold text-blue-300">{totalFrames.toLocaleString()}</p>
                            </div>
                            <div className="p-2 bg-gray-800/50 rounded">
                              <p className="text-gray-400">Keyframes</p>
                              <p className="text-lg font-bold text-purple-300">{estimate.keyframeCount}</p>
                            </div>
                            <div className="p-2 bg-gray-800/50 rounded">
                              <p className="text-gray-400">Est. Time</p>
                              <p className="text-lg font-bold text-green-300">{estimate.estimatedTotalTimeFormatted}</p>
                            </div>
                            <div className="p-2 bg-gray-800/50 rounded">
                              <p className="text-gray-400">Est. Size</p>
                              <p className="text-lg font-bold text-yellow-300">{Math.round(estimate.estimatedOutputSizeMB)} MB</p>
                            </div>
                          </div>
                          {estimate.warnings.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {estimate.warnings.map((w, i) => (
                                <p key={i} className="text-xs text-yellow-400">⚠ {w}</p>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </Card>
              )}

              {/* AI Visual Generation Panel */}
              <Card
                title="AI Visual Generation"
                icon={<Sparkles size={18} className="text-purple-400" />}
              >
                <AIVisualsPanel
                  onSelectImage={(imageUrl) => {
                    setSelectedVisual(imageUrl);
                    // Save to backend for persistence
                    saveAIVisual({
                      style_id: selectedStyle?.id || "auto",
                      stored_path: imageUrl,
                      is_selected: true,
                    }).catch(console.error);
                  }}
                  defaultPrompt={
                    audioFile
                      ? aiVisualPrompt || generateDefaultPrompt(audioFile.name, audioDuration, beatMarkers)
                      : ""
                  }
                  negativePrompt="blurry, low quality, distorted, deformed, ugly, bad anatomy, watermark, text, logo, oversaturated, underexposed, noisy, grainy, jpeg artifacts, compression artifacts, cropped, out of frame, duplicate, morbid, mutilated, extra fingers, mutated hands, poorly drawn, poorly drawn hands, poorly drawn face, mutation, dehydrated, bad proportions, gross proportions, cloned face, disfigured, malformed limbs, missing arms, missing legs, extra arms, extra legs, fused fingers, too many fingers, long neck, username, artist name"
                />
              </Card>
            </>
          )}

          {activeTab === "style" && (
            <Card title="Visual Style Templates">
              <StyleTemplateGallery
                selectedTemplate={selectedStyle}
                onSelect={setSelectedStyle}
              />
            </Card>
          )}

          {activeTab === "timeline" && audioFile?.previewUrl && (
            <Card title="Beat Timeline Editor">
              <BeatTimeline
                duration={audioFile.duration || 0}
                markers={beatMarkers}
                onMarkersChange={setBeatMarkers}
                currentTime={currentTime}
                onTimeChange={setCurrentTime}
                audioElement={audioRef.current}
              />
            </Card>
          )}

          {activeTab === "timeline" && !audioFile?.previewUrl && (
            <Card title="Beat Timeline Editor">
              <EmptyState
                title="No audio loaded"
                description="Upload an audio file in the Audio tab to use the timeline editor"
              />
            </Card>
          )}

          {activeTab === "batch" && (
            <Card title="Batch Processing Queue">
              {batchJobs.length === 0 ? (
                <EmptyState
                  title="No batch jobs"
                  description="Add multiple audio files to process them as a batch"
                />
              ) : (
                <div className="space-y-3">
                  {batchJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between p-3 bg-background rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Music size={16} className="text-muted" />
                        <div>
                          <p className="text-sm font-medium">
                            {job.audioFile.name}
                          </p>
                          <p className="text-xs text-muted">
                            {job.styleTemplate?.name || "No style"} •{" "}
                            {job.config.resolution}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            job.status === "pending"
                              ? "bg-yellow-500/20 text-yellow-400"
                              : job.status === "processing"
                                ? "bg-blue-500/20 text-blue-400"
                                : job.status === "complete"
                                  ? "bg-green-500/20 text-green-400"
                                  : "bg-red-500/20 text-red-400"
                          }`}
                        >
                          {job.status}
                        </span>
                        <button
                          onClick={() => removeFromBatch(job.id)}
                          className="p-1 text-muted hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {batchJobs.some((j) => j.status === "pending") && (
                    <button
                      onClick={processBatch}
                      className="btn btn-primary w-full mt-4"
                    >
                      Process{" "}
                      {batchJobs.filter((j) => j.status === "pending").length}{" "}
                      Pending Jobs
                    </button>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Right Column - Preview & Submit */}
        <div className="space-y-6">
          {/* Video Preview */}
          <Card title="Video Preview" className="min-h-[300px]">
            {audioFile ? (
              <div className="space-y-4">
                {previewUrl ? (
                  <video
                    src={previewUrl}
                    controls
                    className="w-full rounded-lg"
                    style={{ maxHeight: "250px" }}
                  />
                ) : (
                  <div className="bg-black/20 rounded-lg aspect-video flex items-center justify-center border border-border">
                    <div className="text-center">
                      <Film size={48} className="mx-auto text-muted mb-4" />
                      <p className="text-muted">Preview not generated yet</p>
                      <p className="text-xs text-muted mt-2">
                        {selectedStyle?.name || config.style} • {config.resolution} • {config.fps} FPS
                      </p>
                    </div>
                  </div>
                )}

                {/* Generate Preview Button */}
                <button
                  onClick={handleGeneratePreview}
                  disabled={isGeneratingPreview || !audioFile.storedPath}
                  className="btn btn-secondary w-full flex items-center justify-center gap-2"
                >
                  {isGeneratingPreview ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      Generating {previewProgress}%
                    </>
                  ) : (
                    <>
                      <Eye size={16} />
                      Generate Preview (5s Draft)
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="text-center py-12">
                <Film size={48} className="mx-auto text-muted mb-4" />
                <p className="text-muted">No audio loaded</p>
                <p className="text-xs text-muted mt-2">Upload an audio file to preview</p>
              </div>
            )}
          </Card>

          {/* Selected Style Summary */}
          {selectedStyle && (
            <Card title="Selected Style">
              <div className="flex items-start gap-3">
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center text-white"
                  style={{ background: selectedStyle.previewGradient }}
                >
                  {selectedStyle.icon}
                </div>
                <div className="flex-1">
                  <h4 className="font-medium">{selectedStyle.name}</h4>
                  <p className="text-xs text-muted">{selectedStyle.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 bg-primary/20 rounded">
                      Motion: {Math.round(selectedStyle.params.motionStrength * 100)}%
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-primary/20 rounded">
                      Reactivity: {Math.round(selectedStyle.params.beatReactivity * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Quick Stats */}
          <Card title="Session Stats">
            {beatMarkers.length === 0 && batchJobs.length === 0 && musicVideoJobs.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-muted text-sm">No activity yet</p>
                <p className="text-muted text-xs mt-1">Upload audio and generate a video to see stats</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 lg:gap-4">
                <div className="p-4 bg-background rounded-lg text-center">
                  <p className="text-2xl font-bold text-primary">{beatMarkers.length}</p>
                  <p className="text-xs text-muted mt-1">Beat Markers</p>
                </div>
                <div className="p-4 bg-background rounded-lg text-center">
                  <p className="text-2xl font-bold text-primary">{batchJobs.length}</p>
                  <p className="text-xs text-muted mt-1">Batch Jobs</p>
                </div>
                <div className="p-4 bg-background rounded-lg text-center">
                  <p className="text-2xl font-bold text-primary">{musicVideoJobs.length}</p>
                  <p className="text-xs text-muted mt-1">Total Jobs</p>
                </div>
                <div className="p-4 bg-background rounded-lg text-center">
                  <p className="text-2xl font-bold text-success">
                    {musicVideoJobs.filter((j) => j.status === "completed").length}
                  </p>
                  <p className="text-xs text-muted mt-1">Completed</p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
