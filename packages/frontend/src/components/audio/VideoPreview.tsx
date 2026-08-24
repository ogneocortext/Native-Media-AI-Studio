/**
 * VideoPreview - Frame-by-frame preview with scrubbing for music videos
 */

import {
  Download,
  Film,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { formatTime } from "../../utils/format";

interface VideoPreviewProps {
  previewUrl?: string;
  duration?: number;
  isGenerating?: boolean;
  progress?: number;
  onGenerate?: () => void;
  onDownload?: () => void;
  frames?: string[]; // Array of frame URLs for scrubbing
}

export function VideoPreview({
  previewUrl,
  duration = 0,
  isGenerating = false,
  progress = 0,
  onGenerate,
  onDownload,
  frames = [],
}: VideoPreviewProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [showFrames, setShowFrames] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);

  // Update current time from video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateTime = () => setCurrentTime(video.currentTime);
    const handleEnded = () => setIsPlaying(false);

    video.addEventListener("timeupdate", updateTime);
    video.addEventListener("ended", handleEnded);

    return () => {
      video.removeEventListener("timeupdate", updateTime);
      video.removeEventListener("ended", handleEnded);
    };
  }, [previewUrl]);

  // Sync frame display with video time
  useEffect(() => {
    if (frames.length > 0 && duration > 0) {
      const frameIndex = Math.floor((currentTime / duration) * frames.length);
      setCurrentFrame(Math.min(frameIndex, frames.length - 1));
    }
  }, [currentTime, duration, frames.length]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleScrub = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
    ) => {
      if (!scrubberRef.current || duration === 0) return;

      const rect = scrubberRef.current.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const percentage = x / rect.width;
      const newTime = percentage * duration;

      setCurrentTime(newTime);

      if (videoRef.current) {
        videoRef.current.currentTime = newTime;
      }
    },
    [duration],
  );

  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = Math.max(
      0,
      Math.min(video.currentTime + seconds, duration),
    );
  };

  // Generate placeholder frames if none provided
  const displayFrames =
    frames.length > 0
      ? frames
      : Array.from({ length: 10 }, (_, i) => `frame-${i}`);

  return (
    <div className="space-y-3">
      {/* Main preview area */}
      <div className="relative aspect-video bg-black/40 rounded-lg overflow-hidden">
        {isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 text-primary animate-spin mb-3" />
            <p className="text-sm text-muted">Generating preview...</p>
            <div className="w-48 h-2 bg-background rounded-full mt-3 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted mt-2">{Math.round(progress)}%</p>
          </div>
        ) : previewUrl ? (
          <>
            {/* Video element */}
            <video
              ref={videoRef}
              src={previewUrl}
              className="w-full h-full object-contain"
              onClick={togglePlay}
              playsInline
            />

            {/* Frame overlay (when paused and showing frames) */}
            {!isPlaying &&
              showFrames &&
              displayFrames.length > 0 &&
              currentFrame < displayFrames.length && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <img
                    src={displayFrames[currentFrame]}
                    alt={`Frame ${currentFrame + 1}`}
                    className="max-w-full max-h-full object-contain opacity-80"
                  />
                </div>
              )}

            {/* Playback controls overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent p-4 opacity-0 hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => skip(-5)}
                  className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white"
                >
                  <SkipBack size={18} />
                </button>

                <button
                  onClick={togglePlay}
                  className="p-3 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>

                <button
                  onClick={() => skip(5)}
                  className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white"
                >
                  <SkipForward size={18} />
                </button>

                <span className="text-sm text-white ml-2">
                  {formatTime(currentTime, true)} / {formatTime(duration, true)}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Film className="w-12 h-12 text-muted mb-3" />
            <p className="text-muted text-sm">No preview available</p>
            <p className="text-xs text-muted mt-1">
              Generate a preview to see your video
            </p>
          </div>
        )}
      </div>

      {/* Frame strip / Scrubber */}
      {(previewUrl || isGenerating) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Frame Scrubber</span>
            <button
              onClick={() => setShowFrames(!showFrames)}
              className="text-xs text-primary hover:underline"
            >
              {showFrames ? "Hide" : "Show"} frames
            </button>
          </div>

          {showFrames && (
            <div
              ref={scrubberRef}
              className="relative h-16 bg-black/20 rounded-lg overflow-hidden cursor-pointer"
              onClick={handleScrub}
              onMouseMove={(e) => e.buttons === 1 && handleScrub(e)}
              onTouchMove={handleScrub}
            >
              {/* Frame thumbnails */}
              <div className="absolute inset-0 flex">
                {displayFrames.map((frame, i) => (
                  <div
                    key={i}
                    className="flex-1 border-r border-border/30 bg-background/50 flex items-center justify-center"
                    style={{
                      backgroundImage: frame.startsWith("http")
                        ? `url(${frame})`
                        : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    {!frame.startsWith("http") && (
                      <span className="text-xs text-muted">{i + 1}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary z-10 pointer-events-none"
                style={{
                  left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                }}
              >
                <div className="absolute -top-1 -left-1.5 w-4 h-4 bg-primary rounded-full" />
              </div>
            </div>
          )}

          {/* Time slider */}
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={currentTime}
            onChange={(e) => {
              const newTime = parseFloat(e.target.value);
              setCurrentTime(newTime);
              if (videoRef.current) {
                videoRef.current.currentTime = newTime;
              }
            }}
            className="w-full"
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {!previewUrl && !isGenerating && (
          <button
            onClick={onGenerate}
            className="btn btn-primary flex-1 flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} />
            Generate Preview
          </button>
        )}

        {previewUrl && (
          <>
            <button
              onClick={onGenerate}
              className="btn btn-secondary flex items-center gap-2"
            >
              <RefreshCw size={16} />
              Regenerate
            </button>

            <button
              onClick={onDownload}
              className="btn btn-primary flex-1 flex items-center justify-center gap-2"
            >
              <Download size={16} />
              Download
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default VideoPreview;
