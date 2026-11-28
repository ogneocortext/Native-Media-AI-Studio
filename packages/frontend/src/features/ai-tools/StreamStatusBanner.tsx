/**
 * StreamStatusBanner — shows the current stream/connection status and a
 * collapsible processing-details log.
 *
 * Extracted from AIToolsPage.tsx. Presentational: derives the status color
 * and label from the stream state and renders the banner + details drawer.
 */

import { Loader2, Brain, Wrench, Activity, Shield } from "lucide-react";
import { Card } from "../../components/common";

export interface StreamEvent {
  time: string;
  event: string;
  detail: string;
}

interface StreamStatusBannerProps {
  streamStatus:
    | "idle"
    | "connecting"
    | "thinking"
    | "executing_tool"
    | "streaming_response"
    | "done";
  streamEvents: StreamEvent[];
  showStreamDetails: boolean;
  setShowStreamDetails: (v: boolean) => void;
  currentTool: string | null;
  toolStep: number;
  totalToolSteps: number;
}

const statusColor = (
  streamStatus: StreamStatusBannerProps["streamStatus"],
): string =>
  streamStatus === "connecting"
    ? "text-emerald-400"
    : streamStatus === "thinking"
      ? "text-purple-400"
      : streamStatus === "executing_tool"
        ? "text-amber-400"
        : streamStatus === "streaming_response"
          ? "text-blue-400"
          : "text-emerald-400";

const statusLabel = (
  streamStatus: StreamStatusBannerProps["streamStatus"],
  currentTool: string | null,
  toolStep: number,
  totalToolSteps: number,
): string =>
  streamStatus === "connecting"
    ? "Connecting…"
    : streamStatus === "thinking"
      ? "Model is thinking…"
      : streamStatus === "executing_tool"
        ? `Executing tool${currentTool ? `: ${currentTool}` : ""}${
            totalToolSteps > 0 ? ` (step ${toolStep + 1}/${totalToolSteps})` : ""
          }`
        : streamStatus === "streaming_response"
          ? "Streaming response…"
          : "Complete";

export function StreamStatusBanner({
  streamStatus,
  streamEvents,
  showStreamDetails,
  setShowStreamDetails,
  currentTool,
  toolStep,
  totalToolSteps,
}: StreamStatusBannerProps) {
  if (streamStatus === "idle") return null;

  const color = statusColor(streamStatus);
  const label = statusLabel(streamStatus, currentTool, toolStep, totalToolSteps);

  return (
    <Card className="mb-2 shrink-0">
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          {streamStatus === "connecting" ? (
            <Loader2 size={13} className="animate-spin text-emerald-400" />
          ) : streamStatus === "thinking" ? (
            <Brain size={13} className="text-purple-400 animate-pulse" />
          ) : streamStatus === "executing_tool" ? (
            <Wrench size={13} className="text-amber-400 animate-pulse" />
          ) : streamStatus === "streaming_response" ? (
            <Activity size={13} className="text-blue-400 animate-pulse" />
          ) : (
            <Shield size={13} className="text-emerald-400" />
          )}
          <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>
            {label}
          </span>
        </div>
        {streamEvents.length > 0 && (
          <details
            className="mt-2 text-xs"
            open={showStreamDetails}
            onToggle={() => setShowStreamDetails(!showStreamDetails)}
          >
            <summary className="cursor-pointer text-muted hover:text-white mb-1">
              Processing details
            </summary>
            <div className="bg-black/20 rounded-lg p-2 font-mono text-xs overflow-x-auto border border-white/10">
              {streamEvents.map((e, i) => (
                <div key={i} className="flex gap-2 mb-1">
                  <span className="text-muted/60 w-12">{e.time}</span>
                  <span className="text-purple-300">{e.event}</span>
                  <span className="text-gray-300/80">{e.detail}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}
