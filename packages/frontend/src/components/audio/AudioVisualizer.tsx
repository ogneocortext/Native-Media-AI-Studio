/**
 * AudioVisualizer - Real-time waveform and beat detection visualization
 * Uses Web Audio API for analysis
 */

import React, { useRef, useEffect, useCallback, useState } from "react";
import { formatTime } from "../../utils/format";

interface AudioVisualizerProps {
  audioUrl: string;
  width?: number;
  height?: number;
  onBeatDetected?: (time: number, intensity: number) => void;
  onAudioBufferLoaded?: (buffer: AudioBuffer, duration: number) => void;
  beatMarkers?: BeatMarker[];
  onMarkerClick?: (marker: BeatMarker) => void;
}

export interface BeatMarker {
  time: number;
  intensity: "low" | "medium" | "high";
  type: "beat" | "drop" | "break" | "transition";
  note?: string;
}

export function AudioVisualizer({
  audioUrl,
  width = 800,
  height = 200,
  onBeatDetected,
  onAudioBufferLoaded,
  beatMarkers = [],
  onMarkerClick,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const beatHistoryRef = useRef<number[]>([]);

  // Initialize Web Audio API and analyze audio file
  useEffect(() => {
    if (!audioUrl) return;

    const initAudio = async () => {
      try {
        // Create audio element
        const audio = new Audio(audioUrl);
        audio.crossOrigin = "anonymous";
        audioRef.current = audio;

        // Wait for metadata to load
        await new Promise<void>((resolve) => {
          audio.addEventListener("loadedmetadata", () => {
            setDuration(audio.duration);
            resolve();
          });
          audio.addEventListener("error", () => resolve());
        });

        // Create audio context
        const audioContext = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        audioContextRef.current = audioContext;

        // Create analyser
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        // Create source
        const source = audioContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        sourceRef.current = source;

        // Decode audio data for waveform
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
        setAudioBuffer(decodedBuffer);

        // Extract waveform data with normalization
        const channelData = decodedBuffer.getChannelData(0);
        const samples = 800;
        const blockSize = Math.floor(channelData.length / samples);
        const waveform: number[] = [];
        let maxAmplitude = 0;

        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(channelData[i * blockSize + j] || 0);
          }
          const avg = sum / blockSize;
          waveform.push(avg);
          if (avg > maxAmplitude) maxAmplitude = avg;
        }

        // Normalize waveform to use full canvas height
        const normalized = maxAmplitude > 0
          ? waveform.map(v => Math.max(0.05, v / maxAmplitude))
          : waveform;
        setWaveformData(normalized);

        if (onAudioBufferLoaded) {
          onAudioBufferLoaded(decodedBuffer, audio.duration);
        }

        // Start time update listener
        const updateTime = () => {
          setCurrentTime(audio.currentTime);
          if (!audio.paused) {
            requestAnimationFrame(updateTime);
          }
        };
        audio.addEventListener("play", () => {
          setIsPlaying(true);
          updateTime();
        });
        audio.addEventListener("pause", () => setIsPlaying(false));
        audio.addEventListener("ended", () => setIsPlaying(false));
      } catch (error) {
        console.error("Error initializing audio visualizer:", error);
      }
    };

    initAudio();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContextRef.current?.state !== "closed") {
        audioContextRef.current?.close();
      }
      audioRef.current?.pause();
    };
  }, [audioUrl, onAudioBufferLoaded]);

  // Draw waveform on canvas
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || waveformData.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, width, height);

    const barWidth = width / waveformData.length;
    const centerY = height / 2;

    // Draw waveform bars with glow effect
    waveformData.forEach((amplitude, i) => {
      const barHeight = Math.max(2, amplitude * height * 0.7);
      const x = i * barWidth;

      // Gradient based on amplitude
      const gradient = ctx.createLinearGradient(0, centerY - barHeight / 2, 0, centerY + barHeight / 2);
      gradient.addColorStop(0, "#00ffff");
      gradient.addColorStop(0.4, "#6366f1");
      gradient.addColorStop(0.6, "#8b5cf6");
      gradient.addColorStop(1, "#00ffff");

      ctx.fillStyle = gradient;
      ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);

      // Add glow for high amplitude
      if (amplitude > 0.6) {
        ctx.shadowColor = "#00ffff";
        ctx.shadowBlur = 4;
        ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
        ctx.shadowBlur = 0;
      }
    });

    // Draw playhead
    if (duration > 0) {
      const playheadX = (currentTime / duration) * width;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }

    // Draw beat markers
    beatMarkers.forEach((marker) => {
      const markerX = (marker.time / duration) * width;
      const color =
        marker.type === "drop"
          ? "#ff4444"
          : marker.type === "break"
            ? "#44ff44"
            : marker.type === "transition"
              ? "#ffff44"
              : "#ffffff";

      ctx.strokeStyle = color;
      ctx.lineWidth = marker.intensity === "high" ? 3 : marker.intensity === "medium" ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(markerX, 0);
      ctx.lineTo(markerX, height);
      ctx.stroke();

      // Draw marker handle
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(markerX, 10, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [waveformData, width, height, currentTime, duration, beatMarkers]);

  // Animation loop for real-time visualization
  useEffect(() => {
    const animate = () => {
      if (isPlaying && analyserRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Beat detection
        const bassRange = dataArray.slice(0, 10);
        const bassAverage = bassRange.reduce((a, b) => a + b, 0) / bassRange.length;

        beatHistoryRef.current.push(bassAverage);
        if (beatHistoryRef.current.length > 10) {
          beatHistoryRef.current.shift();
        }

        const average =
          beatHistoryRef.current.reduce((a, b) => a + b, 0) / beatHistoryRef.current.length;
        const threshold = average * 1.3;

        if (bassAverage > threshold && bassAverage > 150) {
          if (audioRef.current && onBeatDetected) {
            onBeatDetected(audioRef.current.currentTime, bassAverage / 255);
          }
        }
      }

      drawWaveform();
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, drawWaveform, onBeatDetected]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / width) * duration;

    // Check if clicking near a marker
    const clickThreshold = 10;
    const clickedMarker = beatMarkers.find((marker) => {
      const markerX = (marker.time / duration) * width;
      return Math.abs(markerX - x) < clickThreshold;
    });

    if (clickedMarker && onMarkerClick) {
      onMarkerClick(clickedMarker);
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const togglePlay = async () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      // Resume audio context if suspended (browser autoplay policy)
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume();
      }
      await audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg overflow-hidden bg-black/40 border border-border">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full cursor-pointer"
          style={{ width: "100%", height: `${height}px` }}
          onClick={handleCanvasClick}
        />
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={togglePlay}
          className="btn btn-secondary flex items-center gap-2"
          disabled={!audioRef.current}
        >
          {isPlaying ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
              Pause
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play
            </>
          )}
        </button>

        <div className="text-sm text-muted">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>

      {/* Beat marker legend */}
      {beatMarkers.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-white" />
            Beat
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            Drop
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            Break
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            Transition
          </span>
        </div>
      )}
    </div>
  );
}

export default AudioVisualizer;
