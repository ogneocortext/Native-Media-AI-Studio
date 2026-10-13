/**
 * Renderer telemetry overlay for the 3D stage.
 *
 * Extracted from Visualizer.tsx — no logic changed. RenderStatsProbe samples
 * once per second inside the R3F frame loop; RenderStatsBadge renders it.
 */
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

export interface RenderStats {
  fps: number;
  calls: number;
  triangles: number;
  /**
   * Plan 2.5 — audio→visual pipeline latency in ms: the age of
   * the freshest audio frame at the stats tick. Target is a
   * locked ~30 ms band (20–40 ms visual lead). `null` when no
   * audio clock is wired (e.g. no audio feed yet).
   */
  audioToVisualMs: number | null;
}

export function RenderStatsProbe({
  enabled,
  onStats,
  getAudioDataAgeMs,
}: {
  enabled: boolean;
  onStats: (stats: RenderStats) => void;
  /** Plan 2.5 — returns the age (ms) of the freshest audio frame. */
  getAudioDataAgeMs?: () => number | null;
}) {
  const { gl } = useThree();
  const frames = useRef(0);
  const last = useRef(performance.now());
  useFrame(() => {
    if (!enabled) return;
    frames.current += 1;
    const now = performance.now();
    if (now - last.current >= 1000) {
      onStats({
        fps: Math.round((frames.current * 1000) / (now - last.current)),
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        audioToVisualMs: getAudioDataAgeMs ? getAudioDataAgeMs() : null,
      });
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}

export function RenderStatsBadge({ stats }: { stats: RenderStats | null }) {
  if (!stats) return null;
  const latency =
    stats.audioToVisualMs !== null && Number.isFinite(stats.audioToVisualMs)
      ? ` · Δ ${Math.round(stats.audioToVisualMs)} ms`
      : "";
  return (
    <div
      className="viz-backend-badge"
      aria-live="off"
      title="Renderer telemetry: frames per second, draw calls, triangles, audio→visual latency (target: ~30 ms locked band, 20–40 ms visual lead)"
    >
      {stats.fps} FPS · {stats.calls} calls · {(stats.triangles / 1000).toFixed(1)}k tris{latency}
    </div>
  );
}
