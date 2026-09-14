// ---------------------------------------------------------------------------
// gpuHelpers.ts — pure functions for the GPU Monitor page
// ---------------------------------------------------------------------------
import { PROCESS_LABELS, DataPoint } from "./gpuConstants";
import {
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Process → app-function mapping
// ---------------------------------------------------------------------------
export function labelForProcess(name: string): string {
  const lower = name.toLowerCase();
  if (PROCESS_LABELS[name]) return PROCESS_LABELS[name];
  for (const [key, label] of Object.entries(PROCESS_LABELS)) {
    if (lower.includes(key.toLowerCase())) return label;
  }
  if (lower.includes("ollama") || lower.includes("llama")) return "Ollama — AI inference";
  if (lower.includes("comfy")) return "ComfyUI — generation";
  if (lower.includes("unity")) return "Unity — 3D pipeline";
  if (lower.includes("blender")) return "Blender — 3D pipeline";
  if (lower.includes("python")) return "Python — backend service";
  if (lower.includes("node")) return "Node.js — server / tooling";
  if (lower.includes("chrome") || lower.includes("edge") || lower.includes("browser"))
    return "Browser — UI";
  if (lower.includes("ffmpeg")) return "FFmpeg — media encode / decode";
  if (lower.includes("remotion")) return "Remotion — video compositing";
  if (lower.includes("dwm.exe")) return "Desktop Window Manager";
  if (lower.includes("csrss")) return "Windows subsystem";
  if (lower.includes("explorer")) return "Windows Explorer";
  if (lower.includes("code.exe")) return "VS Code";
  if (lower.includes("opencode")) return "OpenCode — agent runtime";
  return "GPU compute";
}

export function iconForProcess(name: string): string {
  const l = name.toLowerCase();
  if (l.includes("python")) return "🐍";
  if (l.includes("unity")) return "🎮";
  if (l.includes("blender")) return "🎨";
  if (l.includes("ollama") || l.includes("llama")) return "🦙";
  if (l.includes("comfy")) return "🖼️";
  if (l.includes("chrome") || l.includes("edge") || l.includes("browser")) return "🌐";
  if (l.includes("node")) return "⬢";
  if (l.includes("ffmpeg") || l.includes("remotion")) return "🎬";
  if (
    l.includes("dwm") ||
    l.includes("csrss") ||
    l.includes("explorer") ||
    l.includes("system") ||
    l.includes("svchost")
  )
    return "🪟";
  return "▣";
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
export function getTempColor(c: number): string {
  if (c >= 85) return "#ef4444";
  if (c >= 75) return "#f97316";
  if (c >= 65) return "#f59e0b";
  return "#22c55e";
}

export function getUsageColor(pct: number): string {
  if (pct < 50) return "#22c55e";
  if (pct < 75) return "#f59e0b";
  return "#ef4444";
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function formatMB(mb?: number | null): string {
  if (mb == null || Number.isNaN(mb)) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb).toLocaleString()} MB`;
}

export function formatMBPair(used?: number | null, total?: number | null): string {
  if (used == null || total == null) return "—";
  const fmt = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)}G` : `${Math.round(v)}M`);
  return `${fmt(used)} / ${fmt(total)}`;
}

// ---------------------------------------------------------------------------
// History storage + downsampling
// ---------------------------------------------------------------------------
export function loadHistory(): DataPoint[] {
  try {
    const raw = localStorage.getItem("gpu:history:v2");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DataPoint[];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return parsed.filter((p) => p.time > cutoff).slice(-17280);
  } catch {
    return [];
  }
}

export function downsample(data: DataPoint[], maxPoints: number): DataPoint[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const out: DataPoint[] = [];
  for (let i = 0; i < data.length; i += step) {
    const bucket = data.slice(i, i + step);
    const avg = (key: keyof DataPoint) => {
      const vals = bucket.map((d) => d[key] as number).filter((v) => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
    };
    out.push({
      time: bucket[Math.floor(bucket.length / 2)].time,
      label: bucket[Math.floor(bucket.length / 2)].label,
      temp: avg("temp"),
      vram: avg("vram"),
      util: avg("util"),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stats + trending
// ---------------------------------------------------------------------------
export interface CalcStatsResult {
  avg: number;
  min: number;
  max: number;
  cur: number;
  trend: "up" | "down" | "flat";
  slope: number;
}

export function calcStats(values: (number | undefined)[]): CalcStatsResult {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (!nums.length) return { avg: 0, min: 0, max: 0, cur: 0, trend: "flat", slope: 0 };
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const cur = nums[nums.length - 1];
  const n = Math.min(nums.length, 40);
  const slice = nums.slice(-n);
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  for (let i = 0; i < slice.length; i++) {
    sumX += i;
    sumY += slice[i];
    sumXY += i * slice[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
  const trend = slope > 0.08 ? "up" : slope < -0.08 ? "down" : "flat";
  return { avg, min, max, cur, trend, slope };
}

export function trendIcon(t: string) {
  if (t === "up") return <TrendingUp size={12} className="text-red-400" />;
  if (t === "down") return <TrendingDown size={12} className="text-emerald-400" />;
  return <Minus size={12} className="text-muted" />;
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------
export function formatFullTime(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${date} ${time}`;
}

/** Range-aware X tick: short windows show HH:MM:SS, long windows show HH:MM (+day when spanning midnight). */
export function makeTimeTick(rangeMs: number) {
  const long = rangeMs >= 6 * 60 * 60 * 1000;
  return (ms: number) => {
    const d = new Date(ms);
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (!long) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const day = d.toLocaleDateString([], { month: "numeric", day: "numeric" });
    return `${day} ${hm}`;
  };
}

/** Nice round-number ticks (every 10°C) spanning the visible temp domain. */
export function niceTempTicks(min: number, max: number): number[] {
  const lo = Math.floor(Math.min(min, max) / 10) * 10;
  const hi = Math.ceil(Math.max(min, max) / 10) * 10;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += 10) ticks.push(t);
  return ticks.length ? ticks : [lo];
}

// ---------------------------------------------------------------------------
// Tooltip component
// ---------------------------------------------------------------------------
export interface ChartTipProps {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: number | string;
  unit?: string;
}

export function ChartTooltip({ active, payload, label }: ChartTipProps) {
  if (!active || !payload?.length) return null;
  const ms = typeof label === "number" ? label : payload[0]?.payload?.time;
  return (
    <div style={{"background": "rgba(13,14,19,0.97)","border": "1px solid rgba(255,255,255,0.12)","borderRadius": 10,"fontSize": 12,"padding": "8px 10px","boxShadow": "0 8px 24px rgba(0,0,0,0.5)"} as any}>
      {typeof ms === "number" && (
        <p style={{ color: "#e5e7eb", fontSize: 11, marginBottom: 6, whiteSpace: "nowrap" }}>{formatFullTime(ms)}</p>
      )}
      {payload.map((p, i) => (
        <p key={i} style={{ color: "#e5e7eb", fontSize: 12, margin: "2px 0", whiteSpace: "nowrap" }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 4,
              background: p.color || p.stroke,
              marginRight: 6,
            }}
          />
          {p.name}: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{p.value}{p.unit}</strong>
        </p>
      ))}
    </div>
  );
}
