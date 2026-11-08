/**
 * Preview Page — Standalone filmstrip view for preview clips.
 * Accessed from Art Direction page to view output previews.
 *
 * Fetches real video outputs from /api/outputs via the shared outputStore,
 * renders them in a filmstrip grid, and plays the selected clip in a modal
 * with a real <video> element (Play/Pause, Download).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Download, Play, Pause, Maximize2, X, RefreshCw, AlertCircle } from "lucide-react";
import { Card } from "../../components/common";
import { useOutputs, useOutputLoading, useOutputError } from "../../state/outputStore";
import { useOutputStore } from "../../state/outputStore";
import { getOutputUrl } from "../../utils/url";

interface PreviewClip {
  id: string;
  name: string;
  duration: string;
  frames: number;
  thumbnail: string;
  videoUrl: string;
  relativePath: string;
}

export function Preview() {
  const outputs = useOutputs();
  const isLoading = useOutputLoading();
  const error = useOutputError();

  // Stable store reference for fetchOutputs (avoids useOutputActions() which
  // returns a new object every render and would cause an infinite loop).
  const fetchOutputs = useOutputStore((s) => s.fetchOutputs);

  // Load video outputs on mount and when refreshed.
  useEffect(() => {
    void fetchOutputs();
  }, [fetchOutputs]);

  // Video outputs only, sorted newest first (backend already returns most
  // recently modified first). Fall back to the full list if no videos.
  const videoOutputs = outputs.filter((o) => o.file_type === "video");

  const clips: PreviewClip[] = videoOutputs.map((o) => {
    const durationSec = Math.max(0, (o.size_bytes / 1_000_000) * 0.8); // rough estimate
    const minutes = Math.floor(durationSec / 60);
    const seconds = Math.floor(durationSec % 60);
    return {
      id: o.relative_path,
      name: o.filename,
      duration: `${minutes}:${seconds.toString().padStart(2, "0")}`,
      frames: 0, // backend does not expose frame count; keep placeholder
      thumbnail: getOutputUrl(o.relative_path),
      videoUrl: getOutputUrl(o.relative_path),
      relativePath: o.relative_path,
    };
  });

  const [selectedClip, setSelectedClip] = useState<PreviewClip | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Derive playing state from the video element so it stays in sync.
  const [isPlaying, setIsPlaying] = useState(false);

  // Close fullscreen on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sync isPlaying with the actual video element's paused state.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const handleFullscreen = useCallback((clip: PreviewClip) => {
    setSelectedClip(clip);
    setFullscreen(true);
    // Reset video to start when a new clip is selected.
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }, []);

  const handleDownload = useCallback((e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleRefresh = useCallback(() => {
    void fetchOutputs();
  }, [fetchOutputs]);

  // Loading state
  if (isLoading && clips.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Film size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Preview Filmstrip</h1>
              <p className="text-sm text-muted">
                Output preview clips at different production stages
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="text-xs text-muted hover:text-violet-400 transition-colors"
              aria-label="Refresh preview clips"
            >
              <RefreshCw size={13} className="animate-spin" />
            </button>
          </div>
        </div>
        <Card className="p-12 text-center">
          <RefreshCw size={32} className="mx-auto mb-4 animate-spin text-muted" />
          <h3 className="text-lg font-medium mb-2">Loading preview clips…</h3>
        </Card>
      </div>
    );
  }

  // Error state
  if (error && clips.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Film size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Preview Filmstrip</h1>
              <p className="text-sm text-muted">
                Output preview clips at different production stages
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="text-xs text-muted hover:text-violet-400 transition-colors"
              aria-label="Refresh preview clips"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
        <Card className="p-12 text-center border-destructive/20">
          <AlertCircle size={48} className="mx-auto mb-4 text-destructive" />
          <h3 className="text-lg font-medium mb-2">Failed to load preview clips</h3>
          <p className="text-sm text-muted mb-4">{error}</p>
          <button
            onClick={handleRefresh}
            className="text-xs text-violet-400 underline underline-offset-4 hover:text-violet-300"
          >
            <RefreshCw size={13} className="mr-1" /> Try again
          </button>
        </Card>
      </div>
    );
  }

  // Empty state
  if (clips.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Film size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Preview Filmstrip</h1>
              <p className="text-sm text-muted">
                Output preview clips at different production stages
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="text-xs text-muted hover:text-violet-400 transition-colors"
              aria-label="Refresh preview clips"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
        <Card className="p-12 text-center">
          <Film size={48} className="mx-auto mb-4 text-muted" />
          <h3 className="text-lg font-medium mb-2">No Preview Clips</h3>
          <p className="text-sm text-muted">
            Generate preview clips from the Art Direction page to see them here.
          </p>
          <button
            onClick={handleRefresh}
            className="mt-4 text-xs text-violet-400 underline underline-offset-4 hover:text-violet-300"
          >
            <RefreshCw size={13} className="mr-1" /> Refresh
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Film size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Preview Filmstrip</h1>
            <p className="text-sm text-muted">
              Output preview clips at different production stages
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted px-2 py-1 bg-background rounded">
            {clips.length} clips
          </span>
          <button
            onClick={handleRefresh}
            className="text-xs text-muted hover:text-violet-400 transition-colors"
            aria-label="Refresh preview clips"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Filmstrip Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clips.map((clip) => (
          <Card
            key={clip.id}
            className="overflow-hidden group cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
            onClick={() => handleFullscreen(clip)}
          >
            {/* Thumbnail — real video poster */}
            <div
              className="aspect-video relative flex items-center justify-center overflow-hidden"
              style={{ backgroundColor: "#111" }}
            >
              <img
                src={clip.thumbnail}
                alt={clip.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                onError={(e) => {
                  // Fallback to a solid color if the image fails to load
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Play size={20} className="text-white ml-0.5" />
                </div>
              </div>
              <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 rounded text-xs text-white">
                {clip.duration}
              </div>
            </div>

            {/* Info */}
            <div className="p-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">{clip.name}</h3>
                <span className="text-xs text-muted">{clip.frames} frames</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <a
                  href={clip.videoUrl}
                  className="flex-1 text-center text-xs py-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  onClick={(e) => handleDownload(e, clip.videoUrl)}
                  download
                >
                  <Download size={12} className="inline mr-1" />
                  Download
                </a>
                <button
                  className="flex-1 text-center text-xs py-1.5 rounded border border-border hover:bg-muted/50 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFullscreen(clip);
                  }}
                >
                  <Maximize2 size={12} className="inline mr-1" />
                  Fullscreen
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Fullscreen Modal */}
      {fullscreen && selectedClip && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            onClick={() => setFullscreen(false)}
          >
            <X size={20} className="text-white" />
          </button>
          <div className="max-w-5xl w-full mx-4">
            <div
              className="aspect-video rounded-lg overflow-hidden flex items-center justify-center"
              style={{ backgroundColor: "#000" }}
            >
              <video
                ref={videoRef}
                src={selectedClip.videoUrl}
                className="w-full h-full object-contain"
                poster={selectedClip.thumbnail}
                preload="metadata"
              />
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={togglePlay}
                    className="w-16 h-16 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors"
                  >
                    <Play size={32} className="text-white ml-1" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-col items-center justify-center gap-4 mt-4">
              <div className="text-center text-white">
                <p className="text-lg font-medium">{selectedClip.name}</p>
                <p className="text-sm opacity-60">
                  {selectedClip.duration} • {selectedClip.frames} frames
                </p>
              </div>
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={togglePlay}
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm flex items-center gap-2 transition-colors"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <a
                  href={selectedClip.videoUrl}
                  onClick={(e) => handleDownload(e, selectedClip.videoUrl)}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/80 text-white text-sm flex items-center gap-2 transition-colors"
                  download
                >
                  <Download size={16} />
                  Download
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
