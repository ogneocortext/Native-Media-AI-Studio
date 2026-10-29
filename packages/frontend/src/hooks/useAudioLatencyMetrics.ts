/**
 * Hook to track and display audio latency metrics.
 *
 * Monitors AudioContext latency, clock interpolation accuracy,
 * and displays the metrics in a user-friendly format.
 */

import { useEffect, useState } from "react";
import { estimateOutputLatency } from "../features/visualizer/audioTiming";

export interface AudioLatencyMetrics {
  outputLatency: number; // ms
  baseLatency: number; // ms
  totalLatency: number; // ms
  sampleRate: number; // Hz
  contextState: string;
  lastUpdate: number;
}

export function useAudioLatencyMetrics(audioCtx: AudioContext | null) {
  const [metrics, setMetrics] = useState<AudioLatencyMetrics>({
    outputLatency: 0,
    baseLatency: 0,
    totalLatency: 0,
    sampleRate: 0,
    contextState: "closed",
    lastUpdate: 0,
  });

  useEffect(() => {
    if (!audioCtx) return;

    const updateMetrics = () => {
      const outputLatency = estimateOutputLatency(audioCtx);
      const baseLatency = (audioCtx as AudioContext).baseLatency ?? 0;
      const totalLatency = outputLatency + baseLatency;

      setMetrics({
        outputLatency: outputLatency * 1000, // Convert to ms
        baseLatency: baseLatency * 1000,
        totalLatency: totalLatency * 1000,
        sampleRate: audioCtx.sampleRate,
        contextState: audioCtx.state,
        lastUpdate: Date.now(),
      });
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 1000); // Update every second

    return () => clearInterval(interval);
  }, [audioCtx]);

  return metrics;
}
