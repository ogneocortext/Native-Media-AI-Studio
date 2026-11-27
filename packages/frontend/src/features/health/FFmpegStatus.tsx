import { useState, useEffect } from "react";
import { Terminal } from "lucide-react";
import { Card } from "../../components/common";
import { useHealthStore } from "../../state/healthStore";
import { usePolling } from "../../hooks";
import type { FFmpegProcessInfo } from "../../services/api";

interface FFmpegStatusData {
  running: boolean;
  count: number;
  processes: FFmpegProcessInfo[];
}

interface FFmpegBinaryInfo {
  found: boolean;
  path: string | null;
  version: string | null;
}

export function FFmpegStatus() {
  const [ffmpeg, setFfmpeg] = useState<FFmpegStatusData>({
    running: false,
    count: 0,
    processes: [],
  });
  const fetchFFmpegData = useHealthStore((s) => s.fetchFFmpegData);
  const granular = useHealthStore((s) => s.granular);
  const ffmpegBinary = useHealthStore((s) => s.ffmpegBinary);
  const ffprobeBinary = useHealthStore((s) => s.ffprobeBinary);

  usePolling(fetchFFmpegData, { intervalMs: 10000, leaderChannel: "health-ffmpeg" });

  useEffect(() => {
    const data = granular.ffmpeg;
    if (data) {
      setFfmpeg({ running: data.running, count: data.count, processes: data.processes });
    }
  }, [granular.ffmpeg]);

  const ffmpegInfo: FFmpegBinaryInfo = {
    found: ffmpegBinary?.found ?? false,
    path: ffmpegBinary?.path ?? null,
    version: ffmpegBinary?.version ?? null,
  };
  const ffprobeInfo: FFmpegBinaryInfo = {
    found: ffprobeBinary?.found ?? false,
    path: ffprobeBinary?.path ?? null,
    version: ffprobeBinary?.version ?? null,
  };
  const anyFound = ffmpegInfo.found || ffprobeInfo.found;

  // No ffmpeg binary at all — show degraded missing state.
  if (!anyFound && !ffmpeg.running) {
    return (
      <Card className="mb-4 border-red-500/20 bg-red-500/5">
        <div className="flex items-start gap-3 p-4">
          <Terminal size={20} className="text-red-400 mt-0.5" />
          <div>
            <h3 className="font-semibold text-sm text-red-400">FFmpeg not found</h3>
            <p className="text-xs text-red-300 mt-1">
              ffmpeg not found on PATH. Library probe, loudness, and mastering
              are unavailable until ffmpeg is installed and on PATH.
            </p>
            {ffprobeInfo.found && (
              <p className="text-xs text-red-300 mt-1">
                ffprobe found at {ffprobeInfo.path} ({ffprobeInfo.version}),
                but ffmpeg is required for media processing.
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Binary found — show status card.
  const binary = ffmpegInfo.found ? ffmpegInfo : ffprobeInfo;
  return (
    <Card className="mb-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <Terminal size={20} className="text-green-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">FFmpeg</h3>
            <p className="text-xs text-muted">
              Binary found at{" "}
              <span className="text-white font-mono">{binary.path ?? "on PATH"}</span>{" "}
              ({binary.version ?? "version unknown"})
            </p>
            {ffmpeg.running && (
              <p className="text-xs text-muted mt-1">
                {ffmpeg.count} process{ffmpeg.count > 1 ? "es" : ""} running
              </p>
            )}
          </div>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400 font-medium">
          {ffmpeg.running ? "Active" : "Ready"}
        </span>
      </div>
      {ffmpeg.processes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
          {ffmpeg.processes.map((p: FFmpegProcessInfo, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-muted">PID {String(p.pid)}</span>
              <span className="text-white">{Math.round(Number(p.cpu ?? 0))}% CPU</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
