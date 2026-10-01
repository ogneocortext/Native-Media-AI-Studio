/**
 * BusChannel — a submix bus channel strip.
 *
 * Buses aggregate stems (e.g. all rhythm stems → drums bus) so the user
 * can treat related tracks as one fader. The master bus is the final
 * output stage and is rendered by `MasterChannel` instead.
 */

import { BUS_LABELS, type BusName } from "./stemBus";
import type { BusChannelState } from "./types";

interface BusChannelProps {
  name: Exclude<BusName, "master">;
  state: BusChannelState;
  meter: { rms: number; peak: number; dBFS: number };
  soloCount: number;
  accent: string;
  onVolume: (v: number) => void;
  onPan: (p: number) => void;
  onMute: () => void;
  onSolo: () => void;
  onCompressorPreset: (preset: string) => void;
  collapsed?: boolean;
  onToggleCollapse: () => void;
}

export function BusChannel({
  name,
  state,
  meter,
  soloCount,
  accent,
  onVolume,
  onPan,
  onMute,
  onSolo,
  onCompressorPreset,
  collapsed = false,
  onToggleCollapse,
}: BusChannelProps) {
  const isAudible = soloCount > 0 ? state.solo : !state.muted;
  const dB = 20 * Math.log10(Math.max(state.volume, 0.001));

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-0.5 p-1 rounded-lg border border-white/5 bg-black/20">
        <button
          onClick={onToggleCollapse}
          className="text-[9px] text-white/50 hover:text-white/80 transition-colors"
          title={`Expand ${BUS_LABELS[name]} bus`}
        >
          ▶
        </button>
        <div
          className="w-2 h-24 bg-white/5 rounded-full overflow-hidden relative"
          title={BUS_LABELS[name]}
        >
          <div
            className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-75"
            style={{
              height: `${Math.min(100, meter.rms * 250)}%`,
              background: isAudible ? accent : "transparent",
              opacity: isAudible ? 0.8 : 0.2,
            }}
          />
        </div>
        <span className="text-[8px] font-semibold uppercase tracking-wider text-white/60">
          {BUS_LABELS[name]}
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1.5 p-2 rounded-xl border transition-all min-w-[80px]"
      style={{
        borderColor: isAudible ? `${accent}33` : "rgba(255,255,255,0.06)",
        background: isAudible ? `${accent}0d` : "rgba(0,0,0,0.2)",
        opacity: isAudible ? 1 : 0.4,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>
          {BUS_LABELS[name]}
        </span>
        <button
          onClick={onToggleCollapse}
          className="text-[8px] text-white/40 hover:text-white/70 transition-colors"
          title="Collapse bus"
        >
          ◀
        </button>
      </div>

      <div className="w-3 h-16 bg-white/5 rounded-full overflow-hidden relative mx-auto">
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-75"
          style={{
            height: `${Math.min(100, meter.rms * 250)}%`,
            background: meter.dBFS > -6
              ? "linear-gradient(to top, #ef4444, #f59e0b)"
              : `linear-gradient(to top, ${accent}88, ${accent}44)`,
          }}
        />
        <div
          className="absolute left-0 right-0 h-0.5 bg-white/60 transition-all duration-150"
          style={{ bottom: `${Math.min(100, meter.peak * 250)}%` }}
        />
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[8px] text-white/40 uppercase">Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          className="h-16 w-1.5 appearance-none bg-transparent accent-violet-500"
          style={{ writingMode: "vertical-lr", direction: "rtl" }}
          aria-label={`${name} bus volume`}
        />
        <span className="text-[9px] text-white/50 font-mono">
          {dB <= -60 ? "-∞" : `${dB.toFixed(0)}`}
        </span>
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[8px] text-white/40 uppercase">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={state.pan}
          onChange={(e) => onPan(parseFloat(e.target.value))}
          className="w-12 h-1 accent-violet-500"
          aria-label={`${name} bus pan`}
        />
      </div>

      <div className="flex gap-0.5">
        <button
          onClick={onMute}
          className={`w-7 h-7 rounded-md border text-[10px] font-bold transition-all ${
            state.muted
              ? "bg-red-500/30 border-red-500/60 text-red-300"
              : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
          }`}
        >
          M
        </button>
        <button
          onClick={onSolo}
          className={`w-7 h-7 rounded-md border text-[10px] font-bold transition-all ${
            state.solo
              ? "bg-yellow-500/30 border-yellow-500/60 text-yellow-300"
              : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
          }`}
        >
          S
        </button>
      </div>

      <div className="flex flex-col gap-0.5 w-full">
        <span className="text-[8px] text-white/40 uppercase tracking-wider text-center">Comp</span>
        <select
          value=""
          onChange={(e) => e.target.value && onCompressorPreset(e.target.value)}
          className="text-[8px] bg-black/40 border border-white/10 rounded px-1 py-0.5 text-white/60 w-full text-center cursor-pointer"
        >
          <option value="">—</option>
          {Object.entries({
            gentle: "Gentle",
            vocal: "Vocal",
            drum: "Drum",
            bass: "Bass",
            master: "Bus Comp",
            limiter: "Limiter",
          }).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
