import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

export interface WaveformDisplayProps {
  peaks: number[];
  duration?: number | null;
  audioElement?: HTMLAudioElement | null;
  height?: number;
  className?: string;
}

export function WaveformDisplay({
  peaks,
  duration,
  audioElement,
  height = 80,
  className = "",
}: WaveformDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current || !peaks?.length) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor: "rgba(139, 92, 246, 0.35)",
      progressColor: "rgba(139, 92, 246, 0.7)",
      cursorColor: "rgba(255, 255, 255, 0.8)",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      barMinHeight: 1,
      normalize: true,
      fillParent: true,
      interact: !!audioElement,
      media: audioElement ?? undefined,
      peaks: [peaks],
      duration: duration ?? 0,
    });

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [peaks, duration, height, audioElement]);

  if (!peaks?.length) {
    return (
      <div className={`bg-black/40 rounded-lg border border-white/5 flex items-center justify-center text-xs text-muted ${className}`} style={{ height }}>
        No waveform data
      </div>
    );
  }

  return <div ref={containerRef} className={className} />;
}
