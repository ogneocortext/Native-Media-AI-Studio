/**
 * Hook to monitor frame rate and jank for canvas rendering.
 *
 * Tracks FPS, frame time distribution, and jank events (frames > 33ms).
 */

import { useEffect, useRef, useState, useCallback } from "react";

export interface FrameRateMetrics {
  fps: number;
  frameTime: number; // ms
  jankCount: number;
  droppedFrames: number;
  p50FrameTime: number;
  p95FrameTime: number;
  p99FrameTime: number;
  isMonitoring: boolean;
}

const JANK_THRESHOLD_MS = 33.33; // 30 FPS threshold
const MAX_FRAME_SAMPLES = 300; // Keep last 5 seconds at 60fps

export function useFrameRateMonitor(enabled: boolean = true) {
  const [metrics, setMetrics] = useState<FrameRateMetrics>({
    fps: 0,
    frameTime: 0,
    jankCount: 0,
    droppedFrames: 0,
    p50FrameTime: 0,
    p95FrameTime: 0,
    p99FrameTime: 0,
    isMonitoring: false,
  });

  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const jankCountRef = useRef(0);
  const droppedFramesRef = useRef(0);

  const calculateStats = useCallback(() => {
    const times = frameTimesRef.current;
    if (times.length === 0) return { p50: 0, p95: 0, p99: 0 };

    const sorted = [...times].sort((a, b) => a - b);
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }, []);

  const updateMetrics = useCallback(() => {
    const now = performance.now();
    const delta = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    const fps = delta > 0 ? 1000 / delta : 0;

    // Track jank (frames longer than threshold)
    if (delta > JANK_THRESHOLD_MS) {
      jankCountRef.current++;
    }

    // Track dropped frames (assuming 60fps target)
    if (delta > 16.67) {
      droppedFramesRef.current++;
    }

    // Add to frame time history
    frameTimesRef.current.push(delta);
    if (frameTimesRef.current.length > MAX_FRAME_SAMPLES) {
      frameTimesRef.current.shift();
    }

    const stats = calculateStats();

    setMetrics({
      fps,
      frameTime: delta,
      jankCount: jankCountRef.current,
      droppedFrames: droppedFramesRef.current,
      p50FrameTime: stats.p50,
      p95FrameTime: stats.p95,
      p99FrameTime: stats.p99,
      isMonitoring: true,
    });

    // Record to metrics store
    if (typeof window !== 'undefined') {
      const win = window as unknown as Record<string, unknown>;
      const store = win.metricsStore;
      if (store && typeof (store as { record?: (name: string, value: number) => void }).record === 'function') {
        (store as { record: (name: string, value: number) => void }).record('render.fps', fps);
        (store as { record: (name: string, value: number) => void }).record('render.frameTime', delta);
      }
    }

    animationFrameRef.current = requestAnimationFrame(updateMetrics);
  }, [calculateStats]);

  const startMonitoring = useCallback(() => {
    if (animationFrameRef.current) return;
    lastFrameTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(updateMetrics);
  }, [updateMetrics]);

  const stopMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
  }, []);

  const reset = useCallback(() => {
    frameTimesRef.current = [];
    jankCountRef.current = 0;
    droppedFramesRef.current = 0;
    setMetrics({
      fps: 0,
      frameTime: 0,
      jankCount: 0,
      droppedFrames: 0,
      p50FrameTime: 0,
      p95FrameTime: 0,
      p99FrameTime: 0,
      isMonitoring: false,
    });
  }, []);

  useEffect(() => {
    if (enabled) {
      startMonitoring();
    } else {
      stopMonitoring();
    }

    return () => stopMonitoring();
  }, [enabled, startMonitoring, stopMonitoring]);

  return {
    metrics,
    startMonitoring,
    stopMonitoring,
    reset,
  };
}
