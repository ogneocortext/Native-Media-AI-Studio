/**
 * useAudioAnalysisWorker — offloads frequency-band + beat analysis to a Web Worker.
 *
 * The worker mirrors the main-thread `useRealAudio` analysis path so results are
 * semantically identical, but runs off the render thread. When the worker is
 * unavailable or disabled, the hook returns `null` and the caller falls back to
 * the existing inline analysis path.
 */

import { useEffect, useRef, useCallback } from "react";
import type { AudioData, PerceptualScale } from "./types";
import type { WorkerAudioData, AnalyzeMessage } from "./audioAnalysis.worker";

export interface UseAudioAnalysisWorkerOptions {
  enabled?: boolean;
  perceptualScale?: PerceptualScale;
  numPerceptualBands?: number;
}

export interface UseAudioAnalysisWorkerResult {
  data: React.MutableRefObject<AudioData>;
  send: (
    freq: Uint8Array,
    sampleRate: number,
    elapsed: number,
    duration: number,
    beatTimes?: number[],
    downbeatTimes?: number[],
    energyCurve?: number[]
  ) => void;
  destroy: () => void;
}

const emptyAudioData: AudioData = {
  bass: 0,
  mid: 0,
  treble: 0,
  overall: 0,
  beat: false,
  peak: 0,
  energy: 0,
  drumType: null,
  nextBeatIn: 0,
  analyzedEnergy: 0,
  isDownbeat: false,
};

export function useAudioAnalysisWorker({
  enabled = true,
  perceptualScale = "mel",
  numPerceptualBands = 40,
}: UseAudioAnalysisWorkerOptions = {}): UseAudioAnalysisWorkerResult | null {
  const dataRef = useRef<AudioData>({ ...emptyAudioData });
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(false);
  // Watchdog: if a result never arrives (worker exception, postMessage failure,
  // GC pause), `pendingRef` used to stay true forever and the worker's output
  // froze silently — the 3D scene kept rendering against a stale AudioData.
  const watchdogRef = useRef<number | null>(null);
  const RESULT_TIMEOUT_MS = 500;

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof Worker === "undefined") return;

    let worker: Worker | null = null;
    try {
      worker = new Worker(
        new URL("./audioAnalysis.worker.ts", import.meta.url),
        { type: "module" }
      );
    } catch {
      // Unsupported bundler/runtime — fall back silently.
      return;
    }

    worker.onmessage = (ev: MessageEvent<{ type: string; data: WorkerAudioData }>) => {
      if (ev.data.type === "result") {
        const d = ev.data.data;
        dataRef.current = {
          bass: d.bass,
          mid: d.mid,
          treble: d.treble,
          overall: d.overall,
          beat: d.beat,
          peak: d.peak,
          energy: d.energy,
          drumType: d.drumType,
          nextBeatIn: d.nextBeatIn,
          beatPhase: d.beatPhase,
          isDownbeat: d.isDownbeat,
          analyzedEnergy: d.analyzedEnergy,
          perceptualBands: d.perceptualBands,
          perceptualScale: d.perceptualScale as PerceptualScale,
        };
        pendingRef.current = false;
        clearWatchdog();
      }
    };

    worker.onerror = (e) => {
      console.error("[audioAnalysisWorker]", e);
      // Unblock the pipeline: the caller falls back to inline analysis only by
      // being constructed without a worker, so at minimum keep it responsive.
      pendingRef.current = false;
      clearWatchdog();
    };

    workerRef.current = worker;

    return () => {
      clearWatchdog();
      worker.terminate();
      workerRef.current = null;
      pendingRef.current = false;
    };
  }, [enabled, clearWatchdog]);

  const send = useCallback(
    (
      freq: Uint8Array,
      sampleRate: number,
      elapsed: number,
      duration: number,
      beatTimes?: number[],
      downbeatTimes?: number[],
      energyCurve?: number[]
    ) => {
      const worker = workerRef.current;
      if (!worker || pendingRef.current) return;
      pendingRef.current = true;
      const msg: AnalyzeMessage = {
        type: "analyze",
        payload: {
          freq,
          sampleRate,
          elapsed,
          duration,
          beatTimes,
          downbeatTimes,
          energyCurve,
          perceptualScale,
          numPerceptualBands,
        },
      };
      worker.postMessage(msg);
      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        // No result within the window — allow the next frame through so analysis
        // resumes instead of wedging on one lost message.
        pendingRef.current = false;
        watchdogRef.current = null;
      }, RESULT_TIMEOUT_MS);
    },
    [perceptualScale, numPerceptualBands, clearWatchdog]
  );

  const destroy = useCallback(() => {
    clearWatchdog();
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    pendingRef.current = false;
  }, [clearWatchdog]);

  return { data: dataRef, send, destroy };
}
