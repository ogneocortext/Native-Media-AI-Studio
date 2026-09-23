/**
 * StageHero — P1: the stage leads the dashboard.
 * Shows the latest rendered video (muted ambient loop) or, when the library
 * is empty, the signature blue→pink sweep as an invitation.
 */
import { Zap, Play } from "lucide-react";
import type { OutputFile } from "@shared/types";
import { getOutputUrl, formatFileSize } from "../../state/outputStore";

interface StageHeroProps {
  latestVideo: OutputFile | null;
  hasOutputs: boolean;
  onOpenStage: () => void;
}

export function StageHero({ latestVideo, hasOutputs, onOpenStage }: StageHeroProps) {
  return (
    <section aria-label="Stage" className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/30 mb-6">
      {latestVideo ? (
        <>
          <a
            href={getOutputUrl(latestVideo.relative_path)}
            target="_blank"
            rel="noreferrer"
            className="block group"
            aria-label={`Open latest render ${latestVideo.filename}`}
          >
            <video
              src={getOutputUrl(latestVideo.relative_path)}
              className="w-full aspect-video object-cover"
              autoPlay
              muted
              loop
              playsInline
            />
          </a>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          <div className="absolute bottom-0 inset-x-0 p-4 flex items-end justify-between gap-3 pointer-events-none">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-white/60 font-semibold">Latest render</p>
              <p className="text-sm font-semibold text-white truncate" title={latestVideo.filename}>
                {latestVideo.filename}
              </p>
              <p className="text-[11px] text-white/50">{formatFileSize(latestVideo.size_bytes)}</p>
            </div>
            <button onClick={onOpenStage} className="btn btn-primary btn-sm shrink-0 pointer-events-auto">
              <Zap size={14} /> Open stage
            </button>
          </div>
        </>
      ) : (
        <button
          onClick={onOpenStage}
          className="stage-hero-sweep w-full aspect-[21/9] flex flex-col items-center justify-center gap-3 text-center px-6"
          aria-label="Open the visualizer stage"
        >
          <span className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-sm flex items-center justify-center">
            <Play size={20} className="text-white" />
          </span>
          <span>
            <span className="block text-lg font-bold text-white">The stage is dark.</span>
            <span className="block text-sm text-white/70 mt-1">
              {hasOutputs
                ? "Open the visualizer and play something."
                : "Drop a track below to light it up."}
            </span>
          </span>
        </button>
      )}
    </section>
  );
}
