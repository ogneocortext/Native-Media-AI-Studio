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
import { useHealthStore } from "../../state/healthStore";

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
  const fetchGPUData = useHealthStore((s) => s.fetchGPUData);
  const fetchVRAMStatus = useHealthStore((s) => s.fetchVRAMStatus);

  const loadData = useCallback(async () => {
    try {
      await Promise.all([fetchGPUData(), fetchVRAMStatus()]);
      const now = Date.now();
      const timeLabel = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const { granular: currentGranular } = useHealthStore.getState();
      const gpuData = currentGranular.gpu.snapshot;
      const vramData = currentGranular.vram as { vram?: { percent?: number; gpu_utilization?: number; temperature?: number } } | null;
      const systemHealth = useHealthStore.getState().systemHealth;
      setHistory((prev) => {
        return [
          ...prev.slice(-MAX_HISTORY_POINTS),
          {
            time: now,
            label: timeLabel,
            gpu: gpuData?.gpu_utilization ?? vramData?.vram?.gpu_utilization ?? 0,
            vram: gpuData?.memory_percent ?? vramData?.vram?.percent ?? 0,
            cpu: systemHealth?.cpu?.usage_percent ?? 0,
            memory: systemHealth?.memory?.percent ?? 0,
            temp: gpuData?.temperature_c ?? vramData?.vram?.temperature ?? 0,
          },
        ];
      });
    } catch (err) {
      console.error('[PerfHistory] loadData error', err);
    }
  }, [fetchGPUData, fetchVRAMStatus]);

  useEffect(() => {
    loadData();
    if (!autoRefresh) return;
    const interval = setInterval(loadData, 10000); // Increased from 5s to 10s
    return () => clearInterval(interval);
  }, [loadData, autoRefresh]);

  const metrics = [
    { key: "gpu", label: "GPU", color: "#8b5cf6", unit: "%", domain: [0, 100] as [number, number] },
    { key: "vram", label: "VRAM", color: "#06b6d4", unit: "%", domain: [0, 100] as [number, number] },
    { key: "cpu", label: "CPU", color: "#10b981", unit: "%", domain: [0, 100] as [number, number] },
    { key: "memory", label: "Memory", color: "#f59e0b", unit: "%", domain: [0, 100] as [number, number] },
    { key: "temp", label: "Temp", color: "#f87171", unit: "°C", domain: "temp" as const },
  ];
  const activeMetric = metrics.find((m) => m.key === activeChart) || metrics[0];

  // Temperature needs its own scale — plotting °C on a 0–100% axis flattens the line.
  const tempDomain: [number, number] = (() => {
    const vals = history.map((d) => d.temp ?? 0).filter((v) => v > 0);
    if (!vals.length) return [0, 100];
    const lo = Math.floor((Math.min(...vals) - 5) / 10) * 10;
    const hi = Math.ceil((Math.max(...vals) + 5) / 10) * 10;
    return [Math.max(0, lo), Math.max(hi, lo + 20)];
  })();
  const yDomain: [number, number] =
    activeMetric.domain === "temp" ? tempDomain : activeMetric.domain;
  const yTick = (v: number | string) => `${v}${activeMetric.unit}`;

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
          <div className="flex items-center gap-1 mb-4 flex-wrap" role="group" aria-label="Performance metric">
            {metrics.map((m) => (
              <button
                key={m.key}
                onClick={() => setActiveChart(m.key)}
                aria-pressed={activeChart === m.key}
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
              <AreaChart data={history} margin={{ top: 5, right: 8, left: -8, bottom: 5 }}>
                <defs>
                  <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={activeMetric.color} stopOpacity={0.5} />
                    <stop offset="50%" stopColor={activeMetric.color} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={activeMetric.color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(ms: number) =>
                    new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                  }
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  tickCount={4}
                  tickMargin={6}
                  axisLine={{ stroke: "#374151" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  domain={yDomain}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={yTick}
                />
                <Tooltip
                  contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                  labelStyle={{ color: "#9ca3af" }}
                  labelFormatter={(ms) =>
                    typeof ms === "number"
                      ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                      : String(ms)
                  }
                  formatter={(value) => [`${value}${activeMetric.unit}`, activeMetric.label]}
                />
                <Area
                  type="monotone"
                  dataKey={activeChart}
                  name={activeMetric.label}
                  unit={activeMetric.unit}
                  stroke={activeMetric.color}
                  strokeWidth={2}
                  fill="url(#perfGradient)"
                  animationDuration={400}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-5 gap-2 mt-3 pt-3 border-t border-white/5">
            {metrics.map((m) => {
              const last = history[history.length - 1]?.[m.key as keyof DataPoint] as number;
              return (
                <button
                  key={m.key}
                  onClick={() => setActiveChart(m.key)}
                  aria-pressed={activeChart === m.key}
                  className={`text-left p-2 rounded-lg ${activeChart === m.key ? "bg-white/5" : "hover:bg-white/5"}`}
                >
                  <span className="text-[10px] text-gray-400 block">{m.label}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: m.color }}>
                    {last?.toFixed(0) ?? "—"}{m.unit}
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
