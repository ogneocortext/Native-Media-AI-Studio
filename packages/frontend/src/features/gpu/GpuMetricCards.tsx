// ---------------------------------------------------------------------------
// GpuMetricCards.tsx — 4 KPI cards: temp / VRAM / util / thermal headroom
// ---------------------------------------------------------------------------
import { Card } from "../../components/common";
import type { ReactNode } from "react";
import {
  Thermometer,
  MemoryStick,
  Activity,
  Zap,
} from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
} from "recharts";
import { getTempColor, getUsageColor, formatMB } from "./gpuHelpers";
import { THROTTLE_TEMP } from "./gpuConstants";

interface MetricCardsProps {
  snapshot: {
    temperature_c: number;
    memory_percent: number;
    memory_used_mb: number;
    memory_total_mb: number;
    memory_free_mb: number;
    memory_controller_utilization?: number;
    gpu_utilization: number;
    available: boolean;
    name?: string;
  };
  history: { time: number; temp?: number; vram?: number; util?: number }[];
  windowHistory: { time: number; temp?: number; vram?: number; util?: number }[];
  tempStats: { cur: number };
  vramStats: { cur: number };
  utilStats: { cur: number };
  historyLength: number;
}

export function GpuMetricCards({
  snapshot,
  windowHistory,
  historyLength,
}: MetricCardsProps) {
  const temp = snapshot.temperature_c;
  const memPct = snapshot.memory_percent;
  const util = snapshot.gpu_utilization;
  const tempColor = getTempColor(temp);

  const thermalStatus = (() => {
    if (!snapshot.available) return { text: "Unavailable", color: "text-muted", icon: null as ReactNode };
    if (temp >= 90) return { text: "Critical", color: "text-red-400", icon: null };
    if (temp >= 80) return { text: "Hot", color: "text-orange-400", icon: null };
    if (temp >= 70) return { text: "Warm", color: "text-amber-400", icon: null };
    if (temp >= 50) return { text: "Normal", color: "text-emerald-400", icon: null };
    return { text: "Cool", color: "text-emerald-400", icon: null };
  })();

  const headroom = Math.max(0, THROTTLE_TEMP - temp);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {/* Temperature */}
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Thermometer size={14} className="text-rose-400" />
          <span className="text-xs text-muted">Temperature</span>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-muted">
            {historyLength} samples
          </span>
        </div>
        <p className="text-2xl font-bold" style={{ color: tempColor }}>
          {temp.toFixed(0)}°C
        </p>
        <p className={`text-xs mt-1 flex items-center gap-1 ${thermalStatus.color}`}>
          {thermalStatus.icon}
          {thermalStatus.text}
        </p>
        <div className="h-[36px] mt-2 -mx-1 opacity-90">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={windowHistory.slice(-30)} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Area
                type="monotone"
                dataKey="temp"
                stroke={tempColor}
                strokeWidth={1.5}
                fill={tempColor + "33"}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* VRAM */}
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <MemoryStick size={14} className="text-violet-400" />
          <span className="text-xs text-muted">VRAM</span>
          <span className="ml-auto text-[11px] text-muted tabular-nums">
            {formatMB(snapshot.memory_used_mb)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-2xl font-bold" style={{ color: getUsageColor(memPct) }}>
            {memPct.toFixed(1)}%
          </p>
          {/* donut */}
          <svg width={36} height={36} viewBox="0 0 36 36" className="ml-auto shrink-0">
            <circle cx={18} cy={18} r={14} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
            <circle
              cx={18}
              cy={18}
              r={14}
              fill="none"
              stroke={getUsageColor(memPct)}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={`${(memPct / 100) * 87.96} 87.96`}
              transform="rotate(-90 18 18)"
              className="transition-all"
            />
          </svg>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden relative">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(memPct, 100)}%`, background: getUsageColor(memPct) }}
          />
          <div className="absolute top-0 bottom-0 w-0.5 bg-white/30" style={{ left: "75%" }} title="75% warn" />
        </div>
        <p className="text-[11px] text-muted mt-1.5 flex items-center gap-1">
          <Zap size={11} className="text-violet-400" /> {formatMB(snapshot.memory_free_mb)} free
        </p>
        <div className="h-[28px] mt-1 -mx-1 opacity-90">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={windowHistory.slice(-30)} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Area
                type="monotone"
                dataKey="vram"
                stroke="#a855f7"
                strokeWidth={1.5}
                fill="#a855f733"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* GPU Utilization */}
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Activity size={14} className="text-emerald-400" />
          <span className="text-xs text-muted">GPU Utilization</span>
        </div>
        <p className="text-2xl font-bold" style={{ color: getUsageColor(util) }}>
          {util.toFixed(0)}%
        </p>
        <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(util, 100)}%`, background: getUsageColor(util) }}
          />
        </div>
        <p className="text-xs text-muted mt-1.5">Mem ctrl: {snapshot.memory_controller_utilization ?? 0}%</p>
        <div className="h-[36px] mt-2 -mx-1 opacity-90">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={windowHistory.slice(-30)} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Area
                type="monotone"
                dataKey="util"
                stroke="#22c55e"
                strokeWidth={1.5}
                fill="#22c55e33"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Thermal headroom */}
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Activity size={14} className="text-amber-400" />
          <span className="text-xs text-muted">Thermal Headroom</span>
          <span className="ml-auto text-[11px] text-muted tabular-nums">
            {headroom.toFixed(0)}°C to throttle
          </span>
        </div>
        <p className="text-2xl font-bold text-white">{temp >= 85 ? "Low" : temp >= 70 ? "Medium" : "High"}</p>
        <div
          className="mt-2 flex gap-1"
          role="img"
          aria-label={`Thermal headroom ${temp >= 85 ? "low" : temp >= 70 ? "medium" : "high"}, ${headroom.toFixed(0)} degrees below ${THROTTLE_TEMP} degree throttle point`}
        >
          <div className={`h-1.5 flex-1 rounded-full ${temp < 65 ? "bg-emerald-500" : "bg-emerald-500/25"}`} title="Cool zone (<65°C)" />
          <div
            className={`h-1.5 flex-1 rounded-full ${temp >= 85 ? "bg-amber-500/30" : temp >= 65 ? "bg-amber-500" : "bg-white/10"}`}
            title="Warm zone (65–85°C)"
          />
          <div
            className={`h-1.5 flex-1 rounded-full ${temp >= 85 ? "bg-red-500" : "bg-white/10"}`}
            title={`Hot zone (≥85°C, throttle at ${THROTTLE_TEMP}°C)`}
          />
        </div>
        <p className="text-xs text-muted mt-1.5">
          {temp >= 85
            ? "Approaching throttle — reduce concurrent workloads"
            : temp >= 70
              ? "Warm — fan curve active"
              : "Cool — safe for sustained loads"}
        </p>
      </Card>
    </div>
  );
}
