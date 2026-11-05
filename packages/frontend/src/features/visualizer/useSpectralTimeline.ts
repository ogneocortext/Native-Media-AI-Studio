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

// Module-level cache: the timeline is deterministic per (filename, fps) and
// the payload is thousands of frames — refetching on every FX-mode remount or
// A→B→A track switch was pure waste. Backend disk-caches the compute; this
// avoids even the multi-hundred-KB JSON round-trip within the session.
const timelineCache = new Map<string, SpectralTimeline>();
const inflight = new Map<string, Promise<SpectralTimeline>>();

export function useSpectralTimeline(
  filename: string | null,
  fps = 24,
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

    const cacheKey = `${filename}|${fps}`;
    const cached = timelineCache.get(cacheKey);
    if (cached) {
      setTimeline(cached);
      timelineRef.current = cached;
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const encoded = encodeURIComponent(filename);
    let promise = inflight.get(cacheKey);
    if (!promise) {
      promise = fetch(`/api/audio/spectral-timeline/${encoded}?fps=${fps}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to fetch spectral timeline: ${res.status}`);
          return res.json() as Promise<SpectralTimeline>;
        })
        .then((data: SpectralTimeline) => {
          timelineCache.set(cacheKey, data);
          return data;
        })
        .finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, promise);
    }
    promise
      .then((data) => {
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
    if (!tl?.timeline || tl.timeline.length === 0) return null;

    const frameIndex = Math.floor(time * tl.fps);
    const clamped = Math.max(0, Math.min(frameIndex, tl.timeline.length - 1));
    return tl.timeline[clamped] ?? null;
  }, []);

  return { timeline, loading, error, sampleAtTime };
}
