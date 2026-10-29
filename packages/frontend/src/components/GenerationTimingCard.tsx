/**
 * Component to display 3D generation timing metrics.
 */

import { Clock, Cpu } from "lucide-react";
import { Card } from "./common";

interface GenerationTimingCardProps {
  queueWaitTime: number;
  modelLoadTime: number;
  inferenceTime: number;
  postProcessTime: number;
  totalTime: number;
  vramPeak: number;
}

export function GenerationTimingCard({
  queueWaitTime,
  modelLoadTime,
  inferenceTime,
  postProcessTime,
  totalTime,
  vramPeak,
}: GenerationTimingCardProps) {
  const getTimeColor = (ms: number) => {
    if (ms < 30000) return "text-emerald-400";
    if (ms < 60000) return "text-yellow-400";
    return "text-red-400";
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  };

  return (
    <Card title="Generation Timing" icon={<Clock size={16} className="text-violet-400" />}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Total Time</span>
          <span className={`text-sm font-bold tabular-nums ${getTimeColor(totalTime)}`}>
            {formatTime(totalTime)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Queue Wait</span>
          <span className="text-sm tabular-nums text-gray-300">
            {formatTime(queueWaitTime)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Model Load</span>
          <span className="text-sm tabular-nums text-gray-300">
            {formatTime(modelLoadTime)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Inference</span>
          <span className="text-sm tabular-nums text-gray-300">
            {formatTime(inferenceTime)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Post-Process</span>
          <span className="text-sm tabular-nums text-gray-300">
            {formatTime(postProcessTime)}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-white/5 pt-2 mt-2">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Cpu size={10} />
            VRAM Peak
          </span>
          <span className="text-sm tabular-nums text-gray-300">
            {vramPeak.toFixed(0)} MB
          </span>
        </div>
      </div>
    </Card>
  );
}
