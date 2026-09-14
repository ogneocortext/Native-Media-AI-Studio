// ---------------------------------------------------------------------------
// GpuCharts.tsx — Temperature history + VRAM/GPU utilization history charts
// ---------------------------------------------------------------------------
import { Card } from "../../components/common";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Line,
  ResponsiveContainer,
} from "recharts";
import { AXIS_TICK, THROTTLE_TEMP } from "./gpuConstants";
import { ChartTooltip, makeTimeTick, niceTempTicks } from "./gpuHelpers";

interface ChartsProps {
  rangeMs: number;
  chartData: { time: number; label: string; temp?: number; vram?: number; util?: number }[];
  tempStats: { min: number; max: number };
  vramStats: { min: number; max: number };
  utilStats: { min: number; max: number };
  rangeLabel: string;
}

export function GpuCharts({
  rangeMs,
  chartData,
  tempStats,
  vramStats,
  utilStats,
  rangeLabel,
}: ChartsProps) {
  const tempDomain = [Math.max(0, Math.floor(tempStats.min - 5)), Math.min(100, Math.ceil(Math.max(tempStats.max, THROTTLE_TEMP - 15) + 5))] as [number, number];
  const tempTicks = niceTempTicks(tempDomain[0], tempDomain[1]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* Temperature history */}
      <Card title={`Temperature — ${rangeLabel}`} className="!p-4" headerActions={
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="w-2 h-2 rounded-full bg-[#f87171]" />
          Temp °C
          <span className="text-muted/50">• throttle {THROTTLE_TEMP}°C</span>
        </span>
      }>
        {chartData.length < 2 ? (
          <div className="h-48 flex items-center justify-center text-xs text-muted">
            Collecting data… {chartData.length}/2 points
          </div>
        ) : (
          <div className="h-64" role="img" aria-label={`Temperature trend over ${rangeLabel}, throttle at ${THROTTLE_TEMP} degrees`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} syncId="gpu">
                <defs>
                  <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={makeTimeTick(rangeMs)}
                  tick={AXIS_TICK}
                  tickCount={5}
                  tickMargin={8}
                  stroke="rgba(255,255,255,0.15)"
                />
                <YAxis
                  domain={tempDomain}
                  ticks={tempTicks}
                  interval={0}
                  tick={AXIS_TICK}
                  width={44}
                  stroke="rgba(255,255,255,0.15)"
                  label={{ value: "°C", angle: -90, position: "insideLeft", fill: "#a8b0bd", fontSize: 11 }}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.25)", strokeWidth: 1 }} />
                <ReferenceLine y={THROTTLE_TEMP} stroke="#f97316" strokeWidth={1.5} strokeDasharray="6 4" label={{ value: `${THROTTLE_TEMP}°C throttle`, position: "insideTopRight", fill: "#fb923c", fontSize: 10 }} />
                <Area
                  type="monotone"
                  dataKey="temp"
                  stroke="#f87171"
                  strokeWidth={2.5}
                  fill="url(#tempGrad)"
                  name="Temp"
                  unit="°C"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 1, stroke: "#fff" }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-[11px] text-muted/60 mt-2 tabular-nums">
          {chartData.length} samples • {tempStats.min.toFixed(0)}–{tempStats.max.toFixed(0)}°C in view
          {rangeMs < 6 * 60 * 60 * 1000 ? " • zoom with the window buttons above" : " • zoom with the overview brush below"}
        </p>
      </Card>

      {/* VRAM & Utilization history */}
      <Card
        title={`VRAM & Utilization — ${rangeLabel}`}
        className="!p-4"
        headerActions={
          <span className="flex items-center gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#c084fc]" />VRAM %
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-4 rounded-full bg-[#4ade80]" style={{ height: 2, width: 12, borderRadius: 2 }} />GPU %
            </span>
          </span>
        }
      >
        {chartData.length < 2 ? (
          <div className="h-48 flex items-center justify-center text-xs text-muted">Collecting data… {chartData.length}/2 points</div>
        ) : (
          <div className="h-64" role="img" aria-label={`VRAM and GPU utilization over ${rangeLabel}, warning at 75 percent`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} syncId="gpu">
                <defs>
                  <linearGradient id="vramGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#c084fc" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#c084fc" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={makeTimeTick(rangeMs)}
                  tick={AXIS_TICK}
                  tickCount={5}
                  tickMargin={8}
                  stroke="rgba(255,255,255,0.15)"
                />
                <YAxis domain={[0, 100]} tick={AXIS_TICK} tickCount={6} width={44} stroke="rgba(255,255,255,0.15)" label={{ value: "%", angle: -90, position: "insideLeft", fill: "#a8b0bd", fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.25)", strokeWidth: 1 }} />
                <ReferenceLine y={75} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.8} label={{ value: "75% warn", position: "insideTopRight", fill: "#fbbf24", fontSize: 10 }} />
                <Area
                  type="monotone"
                  dataKey="vram"
                  stroke="#c084fc"
                  strokeWidth={2.5}
                  fill="url(#vramGrad)"
                  name="VRAM"
                  unit="%"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 1, stroke: "#fff" }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="util"
                  stroke="#22c55e"
                  strokeWidth={2}
                  name="GPU"
                  unit="%"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 1, stroke: "#fff" }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-[11px] text-muted/60 mt-2 tabular-nums">
          VRAM {vramStats.min.toFixed(0)}–{vramStats.max.toFixed(0)}% • GPU {utilStats.min.toFixed(0)}–{utilStats.max.toFixed(0)}% in view
        </p>
      </Card>
    </div>
  );
}
