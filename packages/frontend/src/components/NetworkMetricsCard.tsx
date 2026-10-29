/**
 * Component to display network/connection metrics.
 */

import { Wifi, WifiOff } from "lucide-react";
import { Card } from "./common";

interface NetworkMetricsCardProps {
  uptime: number;
  reconnectionCount: number;
  averageLatency: number;
  bytesReceived: number;
  bytesSent: number;
  messageDropRate: number;
  connected: boolean;
}

export function NetworkMetricsCard({
  uptime,
  reconnectionCount,
  averageLatency,
  bytesReceived,
  bytesSent,
  messageDropRate,
  connected,
}: NetworkMetricsCardProps) {
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  const getLatencyColor = (ms: number) => {
    if (ms < 50) return "text-emerald-400";
    if (ms < 200) return "text-yellow-400";
    return "text-red-400";
  };

  const getDropRateColor = (rate: number) => {
    if (rate === 0) return "text-emerald-400";
    if (rate < 1) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <Card
      title="Network Metrics"
      icon={connected ? <Wifi size={16} className="text-emerald-400" /> : <WifiOff size={16} className="text-red-400" />}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Status</span>
          <span className={`text-sm font-medium ${connected ? "text-emerald-400" : "text-red-400"}`}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Uptime</span>
          <span className="text-sm tabular-nums text-gray-300">
            {formatUptime(uptime)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Reconnections</span>
          <span className="text-sm tabular-nums text-gray-300">
            {reconnectionCount}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Avg Latency</span>
          <span className={`text-sm tabular-nums ${getLatencyColor(averageLatency)}`}>
            {averageLatency.toFixed(0)} ms
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Bytes Received</span>
          <span className="text-sm tabular-nums text-gray-300">
            {formatBytes(bytesReceived)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Bytes Sent</span>
          <span className="text-sm tabular-nums text-gray-300">
            {formatBytes(bytesSent)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Message Drop Rate</span>
          <span className={`text-sm tabular-nums ${getDropRateColor(messageDropRate)}`}>
            {messageDropRate.toFixed(2)}%
          </span>
        </div>
      </div>
    </Card>
  );
}
