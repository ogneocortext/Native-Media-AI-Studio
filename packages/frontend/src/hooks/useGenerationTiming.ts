/**
 * Hook to track 3D generation timing metrics.
 */

import { useState, useCallback } from "react";

export interface GenerationTiming {
  queueWaitTime: number; // ms
  modelLoadTime: number; // ms
  inferenceTime: number; // ms
  postProcessTime: number; // ms
  totalTime: number; // ms
  vramPeak: number; // MB
}

export function useGenerationTiming() {
  const [timing, setTiming] = useState<GenerationTiming>({
    queueWaitTime: 0,
    modelLoadTime: 0,
    inferenceTime: 0,
    postProcessTime: 0,
    totalTime: 0,
    vramPeak: 0,
  });

  const startGeneration = useCallback(() => {
    setTiming({
      queueWaitTime: 0,
      modelLoadTime: 0,
      inferenceTime: 0,
      postProcessTime: 0,
      totalTime: 0,
      vramPeak: 0,
    });
  }, []);

  const recordPhase = useCallback((phase: keyof GenerationTiming, duration: number) => {
    setTiming((prev) => ({
      ...prev,
      [phase]: duration,
      totalTime: prev.totalTime + duration,
    }));
  }, []);

  const recordVRAMPeak = useCallback((vramMB: number) => {
    setTiming((prev) => ({
      ...prev,
      vramPeak: Math.max(prev.vramPeak, vramMB),
    }));
  }, []);

  return {
    timing,
    startGeneration,
    recordPhase,
    recordVRAMPeak,
  };
}
