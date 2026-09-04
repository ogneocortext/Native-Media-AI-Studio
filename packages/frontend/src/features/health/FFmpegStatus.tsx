import { useState, useEffect } from "react";
import { Terminal } from "lucide-react";
import { Card } from "../../components/common";
import { getFFmpegStatus } from "../../services/api";

interface FFmpegStatusData {
  running: boolean;
  count: number;
  processes: Record<string, unknown>[];
}

export function FFmpegStatus() {
  const [ffmpeg, setFfmpeg] = useState<FFmpegStatusData>({
    running: false,
    count: 0,
    processes: [],
  });

  const fetchStatus = async () => {
    try {
      const status = await getFFmpegStatus();
      setFfmpeg(status);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!ffmpeg.running) return null;

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <Terminal size={20} className="text-red-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">FFmpeg</h3>
            <p className="text-xs text-muted">
              {ffmpeg.count} process{ffmpeg.count > 1 ? "es" : ""} running
            </p>
          </div>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400 font-medium">
          Active
        </span>
      </div>
      {ffmpeg.processes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
          {ffmpeg.processes.map((p: Record<string, unknown>, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-muted">PID {String((p as { Id?: number }).Id ?? "")}</span>
              <span className="text-white">{Math.round(Number((p as { CPU?: number }).CPU || 0))}s CPU</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
