/**
 * ChannelStrip — one vertical channel strip per stem.
 *
 * Layout (top → bottom):
 *   - Channel name + bus route selector
 *   - VU meter (RMS + peak)
 *   - Pan knob (rotary)
 *   - Fader (vertical slider)
 *   - Mute / Solo buttons
 *   - EQ quick presets
 *   - Compressor preset
 *   - Reverb / Delay send knobs
 *
 * DAW-style, dark theme, compact.
 */

import { useRef } from "react";
import { COMPRESSOR_PRESETS } from "./types";
import { BUS_LABELS, type BusName, type StemRouting } from "./stemBus";
import type { StemName } from "../components/StemMixer";
import type { ChannelStripState } from "./types";
// Was redefined here, byte-identical to the exported copy in useProfessionalMixer.
// useProfessionalMixer does not import ChannelStrip, so importing back is not a
// cycle - and a divergent copy here would mean the strip and the mixer disagreed
// about what 0.5 gain reads as on screen.
import { linearToDb } from "./useProfessionalMixer";

interface ChannelStripProps {
  name: StemName;
  state: ChannelStripState;
  meters: { rms: number; peak: number; dBFS: number };
  soloCount: number;
  routing: StemRouting;
  accent?: string;
  onVolume: (v: number) => void;
  onPan: (p: number) => void;
  onMute: () => void;
  onSolo: () => void;
  onCompressorPreset: (preset: string) => void;
  onSend: (send: "reverbSend" | "delaySend", v: number) => void;
  onRouting: (bus: BusName) => void;
  compact?: boolean;
}

export function ChannelStrip({
  name,
  state,
  meters,
  soloCount,
  routing,
  accent = "#a855f7",
  onVolume,
  onPan,
  onMute,
  onSolo,
  onCompressorPreset,
  onSend,
  onRouting,
  compact = false,
}: ChannelStripProps) {
  const meterRef = useRef<HTMLDivElement>(null);

  const dB = linearToDb(state.volume);
  const isAudible = soloCount > 0 ? state.solo : !state.muted;

  if (compact) {
    return (
      <div
        className="flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all"
        style={{
          borderColor: isAudible ? `${accent}44` : "rgba(255,255,255,0.08)",
          background: isAudible ? `${accent}0a` : "rgba(0,0,0,0.2)",
          opacity: isAudible ? 1 : 0.5,
        }}
      >
        <div className="w-2 h-16 bg-white/5 rounded-full overflow-hidden relative">
          <div
            className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-75"
            style={{
              height: `${Math.min(100, meters.rms * 200)}%`,
              background: meters.dBFS > -6 ? `linear-gradient(to top, #ef4444, ${accent})` : `${accent}88`,
            }}
          />
        </div>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 truncate w-full text-center">
          {name}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          className="w-full h-1 accent-violet-500"
          aria-label={`${name} volume`}
        />
        <div className="flex gap-0.5">
          <button
            onClick={onMute}
            className={`text-[8px] px-1 py-0.5 rounded border transition-colors ${
              state.muted ? "bg-red-500/30 border-red-500/50 text-red-300" : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
            }`}
          >
            M
          </button>
          <button
            onClick={onSolo}
            className={`text-[8px] px-1 py-0.5 rounded border transition-colors ${
              state.solo ? "bg-yellow-500/30 border-yellow-500/50 text-yellow-300" : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
            }`}
          >
            S
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all min-w-[72px]"
      style={{
        borderColor: isAudible ? `${accent}33` : "rgba(255,255,255,0.06)",
        background: isAudible ? `${accent}0d` : "rgba(0,0,0,0.2)",
        opacity: isAudible ? 1 : 0.4,
      }}
    >
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/80 truncate w-full text-center">
          {name}
        </span>
        <select
          value={routing[name]}
          onChange={(e) => onRouting(e.target.value as BusName)}
          className="text-[8px] bg-black/40 border border-white/10 rounded px-1 py-0.5 text-white/60 w-full text-center cursor-pointer"
          aria-label={`${name} bus route`}
        >
          {(["vocals", "drums", "bass", "other"] as BusName[]).map((bus) => (
            <option key={bus} value={bus}>
              {BUS_LABELS[bus]}
            </option>
          ))}
        </select>
      </div>

      <div ref={meterRef} className="w-3 h-20 bg-white/5 rounded-full overflow-hidden relative">
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-75"
          style={{
            height: `${Math.min(100, meters.rms * 250)}%`,
            background: meters.dBFS > -6
              ? "linear-gradient(to top, #ef4444, #f59e0b)"
              : meters.dBFS > -18
                ? `linear-gradient(to top, ${accent}88, ${accent}44)`
                : `${accent}44`,
          }}
        />
        <div
          className="absolute left-0 right-0 h-0.5 bg-white/60 transition-all duration-150"
          style={{ bottom: `${Math.min(100, meters.peak * 250)}%` }}
        />
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[8px] text-white/40 uppercase tracking-wider">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={state.pan}
          onChange={(e) => onPan(parseFloat(e.target.value))}
          className="w-12 h-1 accent-violet-500"
          aria-label={`${name} pan`}
        />
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[8px] text-white/40 uppercase">Vol</span>
        <div className="h-24 flex flex-col items-center">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.volume}
            onChange={(e) => onVolume(parseFloat(e.target.value))}
            className="h-full w-3 accent-violet-500 appearance-none bg-transparent"
            style={{ writingMode: "vertical-lr", direction: "rtl" }}
            aria-label={`${name} volume`}
          />
        </div>
        <span className="text-[9px] text-white/50 font-mono">
          {dB <= -60 ? "-∞" : `${dB.toFixed(0)}`}
        </span>
      </div>

      <div className="flex gap-1">
        <button
          onClick={onMute}
          className={`w-7 h-7 rounded-md border text-[10px] font-bold transition-all ${
            state.muted
              ? "bg-red-500/30 border-red-500/60 text-red-300 shadow-lg shadow-red-500/20"
              : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
          }`}
          title={`Mute ${name}`}
        >
          M
        </button>
        <button
          onClick={onSolo}
          className={`w-7 h-7 rounded-md border text-[10px] font-bold transition-all ${
            state.solo
              ? "bg-yellow-500/30 border-yellow-500/60 text-yellow-300 shadow-lg shadow-yellow-500/20"
              : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
          }`}
          title={`Solo ${name}`}
        >
          S
        </button>
      </div>

      <div className="flex flex-col gap-0.5 w-full">
        <span className="text-[8px] text-white/40 uppercase tracking-wider text-center">Comp</span>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onCompressorPreset(e.target.value);
          }}
          className="text-[8px] bg-black/40 border border-white/10 rounded px-1 py-0.5 text-white/60 w-full cursor-pointer"
        >
          <option value="">—</option>
          {Object.entries(COMPRESSOR_PRESETS).map(([key, preset]) => (
            <option key={key} value={key}>{preset.label}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-1">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[8px] text-white/40">Rev</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.reverbSend}
            onChange={(e) => onSend("reverbSend", parseFloat(e.target.value))}
            className="h-10 w-1 accent-sky-400 appearance-none bg-transparent"
            style={{ writingMode: "vertical-lr", direction: "rtl" }}
            aria-label={`${name} reverb send`}
          />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[8px] text-white/40">Dly</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.delaySend}
            onChange={(e) => onSend("delaySend", parseFloat(e.target.value))}
            className="h-10 w-1 accent-teal-400 appearance-none bg-transparent"
            style={{ writingMode: "vertical-lr", direction: "rtl" }}
            aria-label={`${name} delay send`}
          />
        </div>
      </div>
    </div>
  );
}

