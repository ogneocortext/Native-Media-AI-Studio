/**
 * Preview Page — Standalone filmstrip view for preview clips.
 * Accessed from Art Direction page to view output previews.
 */

import { useState, useEffect } from "react";
import { Film, Download, Play, Pause, Maximize2, X } from "lucide-react";
import { Card } from "../../components/common";

interface PreviewClip {
  id: string;
  name: string;
  duration: string;
  frames: number;
  thumbnail: string;
  videoUrl: string;
}

// Sample preview clips — in production these would come from the backend
const SAMPLE_CLIPS: PreviewClip[] = [
  {
    id: "intro-5s",
    name: "5s Intro",
    duration: "5s",
    frames: 150,
    thumbnail: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
    videoUrl: "/output/previews/intro-5s.mp4",
  },
  {
    id: "silicon-10s",
    name: "10s Silicon",
    duration: "10s",
    frames: 300,
    thumbnail: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
    videoUrl: "/output/previews/silicon-10s.mp4",
  },
  {
    id: "crown-10s",
    name: "10s Crown",
    duration: "10s",
    frames: 300,
    thumbnail: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)",
    videoUrl: "/output/previews/take-crown-10s.mp4",
  },
];

export function Preview() {
  const [selectedClip, setSelectedClip] = useState<PreviewClip | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

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
            {SAMPLE_CLIPS.length} clips
          </span>
        </div>
      </div>

      {/* Filmstrip Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SAMPLE_CLIPS.map((clip) => (
          <Card
            key={clip.id}
            className="overflow-hidden group cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
            onClick={() => setSelectedClip(clip)}
          >
            {/* Thumbnail */}
            <div
              className="aspect-video relative flex items-center justify-center"
              style={{ background: clip.thumbnail }}
            >
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
                  onClick={(e) => e.stopPropagation()}
                  download
                >
                  <Download size={12} className="inline mr-1" />
                  Download
                </a>
                <button
                  className="flex-1 text-center text-xs py-1.5 rounded border border-border hover:bg-muted/50 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedClip(clip);
                    setFullscreen(true);
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

      {/* Empty State */}
      {SAMPLE_CLIPS.length === 0 && (
        <Card className="p-12 text-center">
          <Film size={48} className="mx-auto mb-4 text-muted" />
          <h3 className="text-lg font-medium mb-2">No Preview Clips</h3>
          <p className="text-sm text-muted">
            Generate preview clips from the Art Direction page to see them here.
          </p>
        </Card>
      )}

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
              style={{ background: selectedClip.thumbnail }}
            >
              <div className="text-center text-white">
                <Play size={48} className="mx-auto mb-4 opacity-80" />
                <p className="text-lg font-medium">{selectedClip.name}</p>
                <p className="text-sm opacity-60">
                  {selectedClip.duration} • {selectedClip.frames} frames
                </p>
              </div>
            </div>
            <div className="flex items-center justify-center gap-4 mt-4">
              <button
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm flex items-center gap-2 transition-colors"
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                {isPlaying ? "Pause" : "Play"}
              </button>
              <a
                href={selectedClip.videoUrl}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/80 text-white text-sm flex items-center gap-2 transition-colors"
                download
              >
                <Download size={16} />
                Download
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
