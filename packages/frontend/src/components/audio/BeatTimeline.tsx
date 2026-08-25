/**
 * BeatTimeline - Interactive beat marker editor for music videos
 * Allows users to add, edit, and delete beat markers on a timeline
 */

import React, { useState, useCallback, useRef } from "react";
import { Plus, Trash2, Music, Zap, SkipForward, PauseCircle } from "lucide-react";
import { formatTime } from "../../utils/format";

export interface BeatMarker {
  id: string;
  time: number;
  intensity: "low" | "medium" | "high";
  type: "beat" | "drop" | "break" | "transition";
  note?: string;
}

interface BeatTimelineProps {
  duration: number;
  markers: BeatMarker[];
  onMarkersChange: (markers: BeatMarker[]) => void;
  currentTime?: number;
  onTimeChange?: (time: number) => void;
  audioElement?: HTMLAudioElement | null;
}

const markerColors = {
  beat: "#6366f1",
  drop: "#ef4444",
  break: "#22c55e",
  transition: "#eab308",
};

export function BeatTimeline({
  duration,
  markers,
  onMarkersChange,
  currentTime = 0,
  onTimeChange,
  audioElement,
}: BeatTimelineProps) {
  const [zoom, setZoom] = useState(50); // pixels per second
  const timelineRef = useRef<HTMLDivElement>(null);
  const [selectedMarker, setSelectedMarker] = useState<BeatMarker | null>(null);
  const [isAddingMarker, setIsAddingMarker] = useState(false);

  const totalWidth = Math.max(duration * zoom, 800);

  // Handle timeline click to add or move playhead
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
      const time = x / zoom;

      if (isAddingMarker) {
        const newMarker: BeatMarker = {
          id: `marker-${Date.now()}`,
          time: Math.max(0, Math.min(time, duration)),
          intensity: "medium",
          type: "beat",
        };
        onMarkersChange([...markers, newMarker].sort((a, b) => a.time - b.time));
        setIsAddingMarker(false);
      } else if (onTimeChange) {
        onTimeChange(Math.max(0, Math.min(time, duration)));
      }
    },
    [isAddingMarker, duration, markers, onMarkersChange, onTimeChange, zoom]
  );

  // Delete marker
  const deleteMarker = (id: string) => {
    onMarkersChange(markers.filter((m) => m.id !== id));
    if (selectedMarker?.id === id) {
      setSelectedMarker(null);
    }
  };

  // Update marker
  const updateMarker = (id: string, updates: Partial<BeatMarker>) => {
    onMarkersChange(
      markers
        .map((m) => (m.id === id ? { ...m, ...updates } : m))
        .sort((a, b) => a.time - b.time)
    );
  };

  // Auto-detect beats using real audio analysis
  const autoDetectBeats = async () => {
    if (!audioElement) return;

    try {
      // Fetch the audio data from the src URL
      const response = await fetch(audioElement.src);
      const arrayBuffer = await response.arrayBuffer();

      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      // Get the first channel's audio data
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;

      // Parameters for beat detection
      const bufferSize = 1024;
      const hopSize = 512;

      // Compute energy in short-time frames
      const energies: number[] = [];
      const times: number[] = [];
      for (let i = 0; i < channelData.length - bufferSize; i += hopSize) {
        let energy = 0;
        for (let j = 0; j < bufferSize; j++) {
          energy += channelData[i + j] * channelData[i + j];
        }
        energy /= bufferSize;
        energies.push(energy);
        times.push(i / sampleRate);
      }

      // Compute spectral flux (difference between consecutive frames)
      const spectralFlux: number[] = [0];
      for (let i = 1; i < energies.length; i++) {
        const diff = energies[i] - energies[i - 1];
        spectralFlux.push(diff > 0 ? diff : 0);
      }

      // Adaptive threshold for onset detection
      const windowSize = 20;
      const thresholdMultiplier = 1.3;
      const onsets: { time: number; energy: number }[] = [];

      for (let i = windowSize; i < spectralFlux.length - windowSize; i++) {
        let localSum = 0;
        for (let j = i - windowSize; j <= i + windowSize; j++) {
          localSum += spectralFlux[j];
        }
        const localMean = localSum / (windowSize * 2 + 1);

        if (
          spectralFlux[i] > localMean * thresholdMultiplier &&
          spectralFlux[i] > 0.001
        ) {
          let isMax = true;
          for (let j = Math.max(0, i - 4); j <= Math.min(spectralFlux.length - 1, i + 4); j++) {
            if (j !== i && spectralFlux[j] > spectralFlux[i]) {
              isMax = false;
              break;
            }
          }
          if (isMax) {
            onsets.push({ time: times[i], energy: energies[i] });
          }
        }
      }

      // Classify beats by energy level
      const avgEnergy = onsets.length > 0 ? onsets.reduce((sum, o) => sum + o.energy, 0) / onsets.length : 0;
      const highEnergyThreshold = avgEnergy * 1.5;

      const newMarkers: BeatMarker[] = onsets.map((onset, i) => {
        const isHighEnergy = onset.energy > highEnergyThreshold;
        const isDownbeat = i % 4 === 0;
        return {
          id: `auto-${onset.time.toFixed(3)}`,
          time: onset.time,
          intensity: isHighEnergy ? "high" : isDownbeat ? "medium" : "low",
          type: isDownbeat ? "drop" : "beat",
        };
      });

      onMarkersChange([...markers, ...newMarkers].sort((a, b) => a.time - b.time));
      await audioCtx.close();
    } catch {
      // Fallback: simple interval-based detection
      const interval = 0.5;
      const newMarkers: BeatMarker[] = [];
      for (let t = 0; t < duration; t += interval) {
        if (Math.floor(t) % 2 === 0) {
          newMarkers.push({
            id: `auto-${t}`,
            time: t,
            intensity: t % 4 === 0 ? "high" : "medium",
            type: t % 8 === 0 ? "drop" : "beat",
          });
        }
      }
      onMarkersChange([...markers, ...newMarkers].sort((a, b) => a.time - b.time));
    }
  };

  // Get marker icon
  const getMarkerIcon = (type: BeatMarker["type"]) => {
    switch (type) {
      case "drop":
        return <Zap size={14} />;
      case "break":
        return <PauseCircle size={14} />;
      case "transition":
        return <SkipForward size={14} />;
      default:
        return <Music size={14} />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddingMarker(!isAddingMarker)}
            className={`btn btn-sm flex items-center gap-1 ${isAddingMarker ? "btn-primary" : "btn-secondary"}`}
          >
            <Plus size={14} />
            {isAddingMarker ? "Click timeline to add" : "Add Marker"}
          </button>

          <button onClick={autoDetectBeats} className="btn btn-secondary btn-sm" disabled={!audioElement}>
            Auto-Detect
          </button>

          {selectedMarker && (
            <button
              onClick={() => deleteMarker(selectedMarker.id)}
              className="btn btn-danger btn-sm flex items-center gap-1"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom(Math.max(20, zoom - 10))}
              className="btn btn-ghost btn-sm p-1"
              title="Zoom out"
            >
              -
            </button>
            <span className="text-xs text-muted w-12 text-center">{zoom}px/s</span>
            <button
              onClick={() => setZoom(Math.min(200, zoom + 10))}
              className="btn btn-ghost btn-sm p-1"
              title="Zoom in"
            >
              +
            </button>
          </div>

          <div className="text-sm text-muted">
            {markers.length} marker{markers.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={timelineRef}
        className="relative h-32 bg-black/20 rounded-lg border border-border overflow-x-auto"
        style={{ cursor: isAddingMarker ? "crosshair" : "pointer" }}
        onClick={handleTimelineClick}
      >
        <div
          className="relative h-full"
          style={{ width: `${totalWidth}px`, minWidth: "100%" }}
        >
          {/* Time grid lines */}
          {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 border-l border-border/30"
              style={{ left: `${i * zoom}px` }}
            >
              <span className="absolute top-1 left-1 text-xs text-muted">{i}s</span>
            </div>
          ))}

          {/* Beat markers */}
          {markers.map((marker) => {
            const left = marker.time * zoom;
            const isSelected = selectedMarker?.id === marker.id;

            return (
              <div
                key={marker.id}
                className={`absolute top-6 bottom-2 w-8 -ml-4 cursor-pointer transition-all ${
                  isSelected ? "z-10" : "z-0"
                }`}
                style={{ left: `${left}px` }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedMarker(isSelected ? null : marker);
                  if (onTimeChange) {
                    onTimeChange(marker.time);
                  }
                }}
              >
                {/* Marker line */}
                <div
                  className="absolute top-0 bottom-0 left-1/2 w-0.5 -translate-x-1/2"
                  style={{
                    backgroundColor: markerColors[marker.type],
                    opacity: isSelected ? 1 : 0.7,
                  }}
                />

                {/* Marker handle */}
                <div
                  className={`absolute top-0 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs transition-transform ${
                    isSelected ? "scale-125 ring-2 ring-white" : ""
                  }`}
                  style={{
                    backgroundColor: markerColors[marker.type],
                    boxShadow: `0 0 ${marker.intensity === "high" ? 10 : marker.intensity === "medium" ? 6 : 3}px ${markerColors[marker.type]}`,
                  }}
                >
                  {getMarkerIcon(marker.type)}
                </div>

                {/* Time label */}
                <div className="absolute top-8 left-1/2 -translate-x-1/2 text-xs text-muted whitespace-nowrap">
                  {formatTime(marker.time)}
                </div>
              </div>
            );
          })}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white z-20 pointer-events-none"
            style={{ left: `${currentTime * zoom}px` }}
          >
            <div className="absolute -top-1 -left-1.5 w-4 h-4 bg-white rounded-full" />
          </div>
        </div>
      </div>

      {/* Marker editor panel */}
      {selectedMarker && (
        <div className="p-4 bg-background/50 rounded-lg border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Edit Marker</h4>
            <button onClick={() => setSelectedMarker(null)} className="text-muted hover:text-foreground">
              ×
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Time (seconds)</label>
              <input
                type="number"
                step="0.1"
                value={selectedMarker.time.toFixed(1)}
                onChange={(e) => updateMarker(selectedMarker.id, { time: parseFloat(e.target.value) })}
                className="input w-full"
              />
            </div>

            <div>
              <label className="label text-xs">Type</label>
              <select
                value={selectedMarker.type}
                onChange={(e) =>
                  updateMarker(selectedMarker.id, { type: e.target.value as BeatMarker["type"] })
                }
                className="select w-full"
              >
                <option value="beat">Beat</option>
                <option value="drop">Drop</option>
                <option value="break">Break</option>
                <option value="transition">Transition</option>
              </select>
            </div>

            <div>
              <label className="label text-xs">Intensity</label>
              <select
                value={selectedMarker.intensity}
                onChange={(e) =>
                  updateMarker(selectedMarker.id, {
                    intensity: e.target.value as BeatMarker["intensity"],
                  })
                }
                className="select w-full"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div>
              <label className="label text-xs">Note</label>
              <input
                type="text"
                value={selectedMarker.note || ""}
                onChange={(e) => updateMarker(selectedMarker.id, { note: e.target.value })}
                placeholder="Optional note..."
                className="input w-full"
              />
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: markerColors.beat }} />
          Beat
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: markerColors.drop }} />
          Drop
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: markerColors.break }} />
          Break
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: markerColors.transition }} />
          Transition
        </span>
      </div>
    </div>
  );
}

export default BeatTimeline;
