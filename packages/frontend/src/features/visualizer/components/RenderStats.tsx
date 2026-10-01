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
}

export function RenderStatsProbe({
  enabled,
  onStats,
}: {
  enabled: boolean;
  onStats: (stats: RenderStats) => void;
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
      });
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}

export function RenderStatsBadge({ stats }: { stats: RenderStats | null }) {
  if (!stats) return null;
  return (
    <div
      className="viz-backend-badge"
      aria-live="off"
      title="Renderer telemetry: frames per second, draw calls, triangles"
    >
      {stats.fps} FPS · {stats.calls} calls · {(stats.triangles / 1000).toFixed(1)}k tris
    </div>
  );
}
