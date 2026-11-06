/**
 * Component to display audio latency metrics.
 */

import { useEffect, useState } from "react";
import { Clock, RotateCcw } from "lucide-react";
import { Card } from "./common";
import { useAudioLatencyMetrics } from "../hooks/useAudioLatencyMetrics";

interface AudioLatencyCardProps {
  /**
   * The shared AudioContext lives in a ref, so `ref.current` is not reactive —
   * reading it during render goes stale whenever the parent stops re-rendering
   * (e.g. shader mode idles the scene's onAudioData). The card polls the ref
   * once per second instead.
   */
  audioCtxRef: React.RefObject<AudioContext | null>;
}

export function AudioLatencyCard({ audioCtxRef }: AudioLatencyCardProps) {
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(audioCtxRef.current);

  useEffect(() => {
    const sync = () => setAudioCtx(audioCtxRef.current);
    sync();
    const id = setInterval(sync, 1000);
    return () => clearInterval(id);
  }, [audioCtxRef]);

  const metrics = useAudioLatencyMetrics(audioCtx);

  const getLatencyColor = (latency: number) => {
    if (latency < 10) return "text-emerald-400";
    if (latency < 25) return "text-yellow-400";
    return "text-red-400";
  };

  if (!audioCtx) {
    return (
      <Card title="Audio Latency" icon={<Clock size={16} className="text-violet-400" />}>
        <div className="space-y-3">
          <div className="text-sm text-muted">Audio context not initialized</div>
          <button
            onClick={() => {
              // Trigger context resume via the hook's retry mechanism
              window.dispatchEvent(new CustomEvent("viz-audio-ctx-retry"));
            }}
            className="px-3 py-1.5 text-xs font-medium bg-white/10 border border-white/20 rounded hover:bg-white/20 transition-colors"
          >
            <RotateCcw size={12} className="mr-1.5" /> Retry
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Audio Latency" icon={<Clock size={16} className="text-violet-400" />}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Total Latency</span>
          <span
            className={`text-sm font-bold tabular-nums ${getLatencyColor(metrics.totalLatency)}`}
          >
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
          <span className="text-sm tabular-nums text-gray-300">{metrics.sampleRate} Hz</span>
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
