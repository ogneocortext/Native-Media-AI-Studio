/**
 * Renderer telemetry overlay for the 3D stage.
 *
 * Extracted from Visualizer.tsx — no logic changed. RenderStatsProbe samples
 * once per second inside the R3F frame loop; RenderStatsBadge renders it.
 */
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Activity, Layers, Triangle } from "lucide-react";
import { QualityGovernor } from "../qualityGovernor";

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

/**
 * T-VIZ-18 — adaptive quality governor probe for the R3F stage.
 *
 * Samples real frame delta inside the render loop and steps a DPR ladder
 * (1.5 → 1.25 → 1) with hysteresis. At the bottom rung it also reports
 * `postfx: false` so the scene can drop the EffectComposer chain — the
 * single most expensive pass on weak iGPUs. Replaces the binary
 * PerformanceMonitor decline/incline toggle with the shared governor.
 */
export function QualityGovernorProbe({
  onLevel,
}: {
  onLevel: (dpr: number, postfxEnabled: boolean) => void;
}) {
  const governor = useRef(
    new QualityGovernor({
      budgetMs: 20,
      windowSize: 120,
      breachMs: 2000,
      recoverMs: 10000,
      levels: [1.5, 1.25, 1],
    }),
  );
  const lastIndex = useRef<number | null>(null);
  useFrame((_, delta) => {
    const changed = governor.current.sample(delta * 1000, performance.now());
    const idx = governor.current.levelIndexValue;
    if (changed !== null || lastIndex.current === null) {
      // Bottom rung (index 2, DPR 1) drops the EffectComposer chain.
      onLevel(governor.current.level, idx < 2);
      lastIndex.current = idx;
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
      <Activity size={10} className="mr-1" /> {stats.fps} FPS
      <Layers size={10} className="ml-2 mr-1" /> {stats.calls} calls
      <Triangle size={10} className="ml-2 mr-1" />
      {(stats.triangles / 1000).toFixed(1)}k tris{latency}
    </div>
  );
}
