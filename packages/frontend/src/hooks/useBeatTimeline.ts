/**
 * useBeatTimeline — Real beat-precise audio reactivity
 *
 * Replaces Math.sin(elapsed * beatPhase) with discrete beat events from
 * real audio analysis (librosa / CUDA onset detection). The animation loop
 * reads `lastBeatTime`, `lastBeatIntensity`, and `nextBeatIn` from this
 * hook to trigger punchy, frame-accurate flashes/scales/camera-shakes
 * instead of smooth sine waves.
 *
 * Fetches analysis from /api/audio/analyze?file=<filename> and caches the
 * beat_times[] array. The animation loop queries `getCurrentBeat(elapsed)`
 * every frame; the returned object gives the caller a clean decision
 * boundary (is this frame within the first 100ms of a beat?) plus the
 * precomputed energy curve for smoothed sub-beat motion.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioAnalysisResult } from "../services/api";

export interface BeatState {
  /** True for the configured window (default 100ms) after a beat onset. */
  isOnBeat: boolean;
  /** Seconds until the next beat onset (negative if currently inside a beat window). */
  nextBeatIn: number;
  /** Seconds since the last beat onset (0 if no beat yet). */
  timeSinceLastBeat: number;
  /** Index of the last beat in the beat_times array. */
  lastBeatIndex: number;
  /** Beat window length in seconds (0.10 = 100ms). */
  beatWindowSec: number;
  /** Smoothed sub-beat energy from amplitude_envelope (0..1). */
  smoothedEnergy: number;
  /** True if the timeline is loaded and ready. */
  ready: boolean;
}

const DEFAULT_BEAT_WINDOW_MS = 100;
const SMOOTH_ENERGY_LERP = 0.25;

/**
 * Relative-URL variant of getAnalysis. The API service uses getApiBase()
 * which returns a full cross-origin URL in dev (http://127.0.0.1:8000).
 * Browser CORS blocks that on the Vite origin (localhost:5173+). Going
 * through the Vite dev proxy with a relative path keeps the request
 * same-origin and works in both dev and production (where the frontend
 * is served by the backend).
 */
async function getAnalysisRelative(filename: string): Promise<AudioAnalysisResult | null> {
  const res = await fetch(`/api/audio/analysis/${encodeURIComponent(filename)}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error("No cached analysis found");
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as AudioAnalysisResult;
  if (!data || !Array.isArray(data.beat_times)) return null;
  return data;
}

export function useBeatTimeline(filename: string | null) {
  const [analysis, setAnalysis] = useState<AudioAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const smoothedEnergyRef = useRef(0);

  // Fetch analysis whenever the selected track changes
  useEffect(() => {
    if (!filename) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    smoothedEnergyRef.current = 0;

    (async () => {
      try {
        // Use a relative path so the request goes through the Vite dev proxy
        // (same-origin). The full backend URL via getApiBase() hits CORS in
        // dev because the backend on 127.0.0.1:8000 doesn't whitelist the
        // Vite origin on localhost:5173+.
        const cached = await getAnalysisRelative(filename);
        if (cancelled) return;
        if (cached) {
          setAnalysis(cached);
        } else {
          setError("Run Audio Analysis first to populate the beat cache");
        }
      } catch (e) {
        if (!cancelled) {
          // 404 throws "No cached analysis found" — turn that into a clear
          // actionable message instead of an opaque error.
          const msg = e instanceof Error ? e.message : "Analysis failed";
          setError(msg.includes("No cached") ? "Run Audio Analysis first" : msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filename]);

  /**
   * Compute the current beat state for a given elapsed time.
   * Stable reference — safe to call from inside a useFrame / RAF loop.
   */
  const getCurrentBeat = useCallback(
    (elapsedSec: number, beatWindowMs: number = DEFAULT_BEAT_WINDOW_MS): BeatState => {
      const ready = !!analysis && !!analysis.beat_times && analysis.beat_times.length > 0;
      if (!ready) {
        return {
          isOnBeat: false,
          nextBeatIn: 0,
          timeSinceLastBeat: 0,
          lastBeatIndex: -1,
          beatWindowSec: beatWindowMs / 1000,
          smoothedEnergy: smoothedEnergyRef.current,
          ready: false,
        };
      }
      const beats = analysis!.beat_times;
      const windowSec = beatWindowMs / 1000;

      // Binary search for the last beat <= elapsedSec
      let lo = 0;
      let hi = beats.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (beats[mid] <= elapsedSec) lo = mid;
        else hi = mid - 1;
      }
      const lastIdx = beats[lo] <= elapsedSec ? lo : -1;
      const lastBeatTime = lastIdx >= 0 ? beats[lastIdx] : -Infinity;
      const timeSinceLastBeat = elapsedSec - lastBeatTime;
      const isOnBeat = timeSinceLastBeat >= 0 && timeSinceLastBeat < windowSec;
      const nextBeatIn = lastIdx + 1 < beats.length ? beats[lastIdx + 1] - elapsedSec : 0;

      // Smoothed sub-beat energy from amplitude_envelope (interpolated)
      if (analysis!.amplitude_envelope && analysis!.amplitude_envelope.length > 0) {
        const duration = analysis!.duration_seconds || 1;
        const envPos = (elapsedSec / duration) * (analysis!.amplitude_envelope.length - 1);
        const envIdx = Math.floor(envPos);
        const envFrac = envPos - envIdx;
        const envA = analysis!.amplitude_envelope[envIdx] ?? 0;
        const envB = analysis!.amplitude_envelope[Math.min(envIdx + 1, analysis!.amplitude_envelope.length - 1)] ?? 0;
        const target = envA + (envB - envA) * envFrac;
        smoothedEnergyRef.current += (target - smoothedEnergyRef.current) * SMOOTH_ENERGY_LERP;
      }

      return {
        isOnBeat,
        nextBeatIn,
        timeSinceLastBeat,
        lastBeatIndex: lastIdx,
        beatWindowSec: windowSec,
        smoothedEnergy: smoothedEnergyRef.current,
        ready: true,
      };
    },
    [analysis]
  );

  return { analysis, loading, error, getCurrentBeat };
}
