/**
 * MasterChannel — the final output fader + meters.
 *
 * Reads from `mixerState.master` and `mixerState.meters.master`.
 * Writes via `setMasterVolume`, `setMasterEQ`, `setMasterCompressor`.
 */

interface MasterChannelProps {
  volume: number;
  meter: { rms: number; peak: number; dBFS: number };
  onVolume: (v: number) => void;
  onEQ?: (bands: any[]) => void;
  onCompressorPreset?: (preset: string) => void;
  compressorThreshold?: number;
  compressorRatio?: number;
}

export function MasterChannel({
  volume,
  meter,
  onVolume,
  compressorThreshold = -6,
  compressorRatio = 2,
}: MasterChannelProps) {
  const dB = 20 * Math.log10(Math.max(volume, 0.001));

  return (
    <div className="flex flex-col items-center gap-1 p-2 rounded-xl border border-red-500/20 bg-red-950/10 min-w-[72px]">
      {/* Header */}
      <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">
        Master
      </span>

      {/* VU Meter */}
      <div className="w-4 h-28 bg-white/5 rounded-full overflow-hidden relative">
        {/* RMS level */}
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-75"
          style={{
            height: `${Math.min(100, meter.rms * 250)}%`,
            background: meter.dBFS > -3
              ? "linear-gradient(to top, #ef4444, #dc2626)"
              : meter.dBFS > -12
                ? "linear-gradient(to top, #f59e0b, #ef4444)"
                : "linear-gradient(to top, #22c55e88, #22c55e44)",
          }}
        />
        {/* Peak hold */}
        <div
          className="absolute left-0 right-0 h-0.5 bg-white/80 transition-all duration-150"
          style={{ bottom: `${Math.min(100, meter.peak * 250)}%` }}
        />
        {/* -12dB / -6dB marks */}
        <div className="absolute left-0 right-0 h-px bg-white/20" style={{ bottom: "20%" }} title="-12 dBFS" />
        <div className="absolute left-0 right-0 h-px bg-white/20" style={{ bottom: "40%" }} title="-6 dBFS" />
      </div>

      {/* Volume fader */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[8px] text-white/40 uppercase">Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          className="h-24 w-3 accent-red-500 appearance-none bg-transparent"
          style={{ writingMode: "vertical-lr", direction: "rtl" }}
          aria-label="Master volume"
        />
        <span className="text-[10px] text-white/60 font-mono font-bold">
          {dB <= -60 ? "-∞" : `${dB.toFixed(0)}`}
        </span>
      </div>

      {/* Compressor info */}
      <div className="text-[8px] text-white/30 text-center space-y-0.5">
        <div>Thr: {compressorThreshold} dB</div>
        <div>Ratio: {compressorRatio}:1</div>
      </div>
    </div>
  );
}
