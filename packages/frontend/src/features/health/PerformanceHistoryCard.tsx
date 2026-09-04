import { useState, useCallback, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "../../components/common";
import { TrendingUp, Play, Pause } from "lucide-react";
import { getGPUSnapshot, getSystemDiagnostics } from "../../services/api";

interface DataPoint {
  time: number;
  label: string;
  gpu?: number;
  vram?: number;
  cpu?: number;
  memory?: number;
  temp?: number;
}

const MAX_HISTORY_POINTS = 60;

export function PerformanceHistoryCard() {
  const [history, setHistory] = useState<DataPoint[]>([]);
  const [activeChart, setActiveChart] = useState<string>("gpu");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [gpuData, sysData] = await Promise.all([
        getGPUSnapshot().catch(() => null),
        getSystemDiagnostics().catch(() => null),
      ]);
      const now = Date.now();
      const timeLabel = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setHistory((prev) => [
        ...prev.slice(-MAX_HISTORY_POINTS),
        {
          time: now,
          label: timeLabel,
          gpu: gpuData?.gpu_utilization ?? 0,
          vram: gpuData?.memory_percent ?? 0,
          cpu: sysData?.cpu?.usage_percent ?? 0,
          memory: sysData?.memory?.percent ?? 0,
          temp: gpuData?.temperature_c ?? 0,
        },
      ]);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadData();
    if (!autoRefresh) return;
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData, autoRefresh]);

  const metrics = [
    { key: "gpu", label: "GPU", color: "#8b5cf6" },
    { key: "vram", label: "VRAM", color: "#06b6d4" },
    { key: "cpu", label: "CPU", color: "#10b981" },
    { key: "memory", label: "Memory", color: "#f59e0b" },
  ];
  const activeMetric = metrics.find((m) => m.key === activeChart) || metrics[0];

  return (
    <Card
      title="Performance History"
      icon={<TrendingUp size={16} className="text-violet-400" />}
      headerActions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-1.5 rounded-lg ${autoRefresh ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-700 text-gray-400"}`}
            title={autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
          >
            {autoRefresh ? <Play size={12} /> : <Pause size={12} />}
          </button>
        </div>
      }
    >
      {history.length > 1 ? (
        <>
          <div className="flex items-center gap-1 mb-4">
            {metrics.map((m) => (
              <button
                key={m.key}
                onClick={() => setActiveChart(m.key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  activeChart === m.key ? "text-white" : "bg-gray-700/50 text-gray-400 hover:bg-gray-700"
                }`}
                style={activeChart === m.key ? { backgroundColor: m.color } : {}}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <defs>
                  <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={activeMetric.color} stopOpacity={0.5} />
                    <stop offset="50%" stopColor={activeMetric.color} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={activeMetric.color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  interval="preserveStartEnd"
                  axisLine={{ stroke: "#374151" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  domain={[0, 100]}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                  labelStyle={{ color: "#9ca3af" }}
                />
                <Area
                  type="monotone"
                  dataKey={activeChart}
                  name={`${activeMetric.label} %`}
                  stroke={activeMetric.color}
                  strokeWidth={2}
                  fill="url(#perfGradient)"
                  animationDuration={400}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/5">
            {metrics.map((m) => {
              const last = history[history.length - 1]?.[m.key as keyof DataPoint] as number;
              return (
                <button
                  key={m.key}
                  onClick={() => setActiveChart(m.key)}
                  className={`text-left p-2 rounded-lg ${activeChart === m.key ? "bg-white/5" : "hover:bg-white/5"}`}
                >
                  <span className="text-[10px] text-gray-400 block">{m.label}</span>
                  <span className="text-sm font-bold" style={{ color: m.color }}>
                    {last?.toFixed(0) ?? "—"}%
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="h-48 flex items-center justify-center text-sm text-muted">Collecting data…</div>
      )}
    </Card>
  );
}
