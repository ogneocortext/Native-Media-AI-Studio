/**
 * Component to display frame rate and jank metrics.
 */

import { Activity, Gauge } from "lucide-react";
import { Card } from "./common";

interface FrameRateCardProps {
  fps: number;
  frameTime: number;
  jankCount: number;
  droppedFrames: number;
  p95FrameTime: number;
  isMonitoring: boolean;
  onToggle?: () => void;
  onReset?: () => void;
}

export function FrameRateCard({
  fps,
  frameTime,
  jankCount,
  droppedFrames,
  p95FrameTime,
  isMonitoring,
  onToggle,
  onReset,
}: FrameRateCardProps) {
  const getFpsColor = (fps: number) => {
    if (fps >= 55) return "text-emerald-400";
    if (fps >= 30) return "text-yellow-400";
    return "text-red-400";
  };

  const getJankColor = (count: number) => {
    if (count === 0) return "text-emerald-400";
    if (count < 10) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <Card
      title="Frame Rate"
      icon={<Activity size={16} className="text-violet-400" />}
      headerActions={
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="p-1.5 rounded-lg bg-gray-700 text-gray-400 hover:bg-gray-600"
            title="Reset"
          >
            <Gauge size={12} />
          </button>
          <button
            onClick={onToggle}
            className={`p-1.5 rounded-lg ${isMonitoring ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-700 text-gray-400"}`}
            title={isMonitoring ? "Monitoring ON" : "Monitoring OFF"}
          >
            <Activity size={12} className={isMonitoring ? "animate-pulse" : ""} />
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">FPS</span>
          <span className={`text-sm font-bold tabular-nums ${getFpsColor(fps)}`}>
            {fps.toFixed(1)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Frame Time</span>
          <span className="text-sm tabular-nums text-gray-300">
            {frameTime.toFixed(1)} ms
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">P95 Frame Time</span>
          <span className="text-sm tabular-nums text-gray-300">
            {p95FrameTime.toFixed(1)} ms
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Jank Count</span>
          <span className={`text-sm tabular-nums ${getJankColor(jankCount)}`}>
            {jankCount}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Dropped Frames</span>
          <span className="text-sm tabular-nums text-gray-300">
            {droppedFrames}
          </span>
        </div>
      </div>
    </Card>
  );
}
