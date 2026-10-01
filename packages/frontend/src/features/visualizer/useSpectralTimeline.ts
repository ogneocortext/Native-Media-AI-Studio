import { useEffect, useRef, useState, useCallback } from "react";

export interface SpectralFrame {
  frame: number;
  time: number;
  sub: number;
  mid: number;
  high: number;
  transient: number;
  centroid: number;
  rms: number;
}

export interface SpectralTimeline {
  audio_file: string;
  duration_seconds: number;
  sample_rate: number;
  fps: number;
  hop_length: number;
  n_fft: number;
  frame_count: number;
  bands: { sub: number[]; mid: number[]; high: number[] };
  timeline: SpectralFrame[];
}

export interface SpectralTimelineState {
  timeline: SpectralTimeline | null;
  loading: boolean;
  error: string | null;
  sampleAtTime: (time: number) => SpectralFrame | null;
}

export function useSpectralTimeline(
  filename: string | null,
  fps: number = 24,
): SpectralTimelineState {
  const [timeline, setTimeline] = useState<SpectralTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timelineRef = useRef<SpectralTimeline | null>(null);

  useEffect(() => {
    if (!filename) {
      setTimeline(null);
      timelineRef.current = null;
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const encoded = encodeURIComponent(filename);
    fetch(`/api/audio/spectral-timeline/${encoded}?fps=${fps}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch spectral timeline: ${res.status}`);
        return res.json();
      })
      .then((data: SpectralTimeline) => {
        if (cancelled) return;
        setTimeline(data);
        timelineRef.current = data;
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filename, fps]);

  const sampleAtTime = useCallback((time: number): SpectralFrame | null => {
    const tl = timelineRef.current;
    if (!tl || !tl.timeline || tl.timeline.length === 0) return null;

    const frameIndex = Math.floor(time * tl.fps);
    const clamped = Math.max(0, Math.min(frameIndex, tl.timeline.length - 1));
    return tl.timeline[clamped] ?? null;
  }, []);

  return { timeline, loading, error, sampleAtTime };
}
