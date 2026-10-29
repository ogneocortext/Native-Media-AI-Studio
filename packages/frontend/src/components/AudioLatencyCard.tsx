/**
 * Component to display audio latency metrics.
 */

import { Clock } from "lucide-react";
import { Card } from "./common";
import { useAudioLatencyMetrics } from "../hooks/useAudioLatencyMetrics";

interface AudioLatencyCardProps {
  audioCtx: AudioContext | null;
}

export function AudioLatencyCard({ audioCtx }: AudioLatencyCardProps) {
  const metrics = useAudioLatencyMetrics(audioCtx);

  const getLatencyColor = (latency: number) => {
    if (latency < 10) return "text-emerald-400";
    if (latency < 25) return "text-yellow-400";
    return "text-red-400";
  };

  if (!audioCtx) {
    return (
      <Card title="Audio Latency" icon={<Clock size={16} className="text-violet-400" />}>
        <div className="text-sm text-muted">Audio context not initialized</div>
      </Card>
    );
  }

  return (
    <Card title="Audio Latency" icon={<Clock size={16} className="text-violet-400" />}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Total Latency</span>
          <span className={`text-sm font-bold tabular-nums ${getLatencyColor(metrics.totalLatency)}`}>
            {metrics.totalLatency.toFixed(1)} ms
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Output Latency</span>
          <span className="text-sm tabular-nums text-gray-300">
            {metrics.outputLatency.toFixed(1)} ms
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Base Latency</span>
          <span className="text-sm tabular-nums text-gray-300">
            {metrics.baseLatency.toFixed(1)} ms
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Sample Rate</span>
          <span className="text-sm tabular-nums text-gray-300">
            {metrics.sampleRate} Hz
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">State</span>
          <span className="text-sm tabular-nums text-gray-300 capitalize">
            {metrics.contextState}
          </span>
        </div>
      </div>
    </Card>
  );
}
