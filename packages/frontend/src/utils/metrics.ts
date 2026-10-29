/**
 * Centralized metrics tracking system for the frontend.
 *
 * Collects and aggregates performance metrics across the application:
 * - API request timing
 * - Frame rate/jank monitoring
 * - Tool execution times
 * - Memory usage
 * - Network metrics
 */

interface MetricSample {
  timestamp: number;
  value: number;
  tags?: Record<string, string>;
}

interface MetricStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

class MetricsStore {
  private metrics: Map<string, MetricSample[]> = new Map();
  private maxSamples: number = 1000;

  record(name: string, value: number, tags?: Record<string, string>) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    const samples = this.metrics.get(name)!;
    samples.push({
      timestamp: Date.now(),
      value,
      tags,
    });

    // Trim to max samples
    if (samples.length > this.maxSamples) {
      samples.shift();
    }
  }

  getStats(name: string, windowMs?: number): MetricStats | null {
    const samples = this.metrics.get(name);
    if (!samples || samples.length === 0) return null;

    let filtered = samples;
    if (windowMs) {
      const cutoff = Date.now() - windowMs;
      filtered = samples.filter((s) => s.timestamp >= cutoff);
    }

    if (filtered.length === 0) return null;

    const values = filtered.map((s) => s.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      min: values[0],
      max: values[values.length - 1],
      avg: sum / values.length,
      p50: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
    };
  }

  getRecent(name: string, count: number = 10): MetricSample[] {
    const samples = this.metrics.get(name);
    if (!samples) return [];
    return samples.slice(-count);
  }

  clear(name?: string) {
    if (name) {
      this.metrics.delete(name);
    } else {
      this.metrics.clear();
    }
  }

  getAllNames(): string[] {
    return Array.from(this.metrics.keys());
  }
}

export const metricsStore = new MetricsStore();

/**
 * Record API request timing
 */
export function recordApiTiming(endpoint: string, duration: number, success: boolean) {
  metricsStore.record(`api.${endpoint}.duration`, duration, { success: success.toString() });
  metricsStore.record(`api.${endpoint}.count`, 1, { success: success.toString() });
}

/**
 * Record frame timing
 */
export function recordFrameTime(fps: number, frameTime: number) {
  metricsStore.record('render.fps', fps);
  metricsStore.record('render.frameTime', frameTime);
}

/**
 * Record tool execution time
 */
export function recordToolExecution(toolName: string, duration: number, success: boolean) {
  metricsStore.record(`tool.${toolName}.duration`, duration, { success: success.toString() });
}

/**
 * Record memory usage
 */
export function recordMemoryUsage(usedJSHeapSize: number, totalJSHeapSize: number, jsHeapSizeLimit: number) {
  metricsStore.record('memory.usedHeap', usedJSHeapSize);
  metricsStore.record('memory.totalHeap', totalJSHeapSize);
  metricsStore.record('memory.heapLimit', jsHeapSizeLimit);
  metricsStore.record('memory.usagePercent', (usedJSHeapSize / jsHeapSizeLimit) * 100);
}

/**
 * Record network metrics
 */
export function recordNetworkMetrics(
  bytesReceived: number,
  bytesSent: number,
  latency: number
) {
  metricsStore.record('network.bytesReceived', bytesReceived);
  metricsStore.record('network.bytesSent', bytesSent);
  metricsStore.record('network.latency', latency);
}

/**
 * Get aggregated metrics for display
 */
export function getMetricsSummary(): Record<string, MetricStats> {
  const summary: Record<string, MetricStats> = {};
  const names = metricsStore.getAllNames();

  for (const name of names) {
    const stats = metricsStore.getStats(name, 60000); // Last 60 seconds
    if (stats) {
      summary[name] = stats;
    }
  }

  return summary;
}
