/**
 * Hook to track frontend memory usage metrics.
 *
 * Monitors JS heap size and usage percentage using performance.memory API.
 */

import { useEffect, useState, useCallback } from "react";

export interface MemoryMetrics {
  usedJSHeapSize: number; // bytes
  totalJSHeapSize: number; // bytes
  jsHeapSizeLimit: number; // bytes
  usagePercent: number;
  usedMB: number;
  totalMB: number;
  limitMB: number;
  available: boolean;
}

export function useMemoryMetrics(pollInterval: number = 2000) {
  const [metrics, setMetrics] = useState<MemoryMetrics>({
    usedJSHeapSize: 0,
    totalJSHeapSize: 0,
    jsHeapSizeLimit: 0,
    usagePercent: 0,
    usedMB: 0,
    totalMB: 0,
    limitMB: 0,
    available: false,
  });

  const updateMetrics = useCallback(() => {
    if (
      typeof performance === "undefined" ||
      !(performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory ||
      !(performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize
    ) {
      setMetrics((prev) => ({ ...prev, available: false }));
      return;
    }

    const memory = (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const usedJSHeapSize = memory.usedJSHeapSize;
    const totalJSHeapSize = memory.totalJSHeapSize;
    const jsHeapSizeLimit = memory.jsHeapSizeLimit;
    const usagePercent = (usedJSHeapSize / jsHeapSizeLimit) * 100;

    const metricsData: MemoryMetrics = {
      usedJSHeapSize,
      totalJSHeapSize,
      jsHeapSizeLimit,
      usagePercent,
      usedMB: usedJSHeapSize / (1024 * 1024),
      totalMB: totalJSHeapSize / (1024 * 1024),
      limitMB: jsHeapSizeLimit / (1024 * 1024),
      available: true,
    };

    setMetrics(metricsData);

    // Record to metrics store
    if (typeof window !== 'undefined') {
      const win = window as unknown as Record<string, unknown>;
      const store = win.metricsStore;
      if (store && typeof (store as { recordMemoryUsage?: (a: number, b: number, c: number) => void }).recordMemoryUsage === 'function') {
        (store as { recordMemoryUsage: (a: number, b: number, c: number) => void }).recordMemoryUsage(
          usedJSHeapSize,
          totalJSHeapSize,
          jsHeapSizeLimit
        );
      }
    }
  }, []);

  useEffect(() => {
    updateMetrics();
    const interval = setInterval(updateMetrics, pollInterval);
    return () => clearInterval(interval);
  }, [updateMetrics, pollInterval]);

  return metrics;
}
