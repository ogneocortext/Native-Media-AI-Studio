import { Zap } from "lucide-react";

interface TrackInfoBarProps {
  beatSync: boolean;
  bpm: number;
  beatAnalysis: any;
  beatLoading: boolean;
  beatError: string | null;
  beatPunch: number;
  focusMode: boolean;
  onBpmChange: (bpm: number) => void;
  onBeatSyncToggle: () => void;
  onBeatPunchChange: (value: number) => void;
}

export function TrackInfoBar({
  beatSync,
  bpm,
  beatAnalysis,
  beatLoading,
  beatError,
  beatPunch,
  focusMode,
  onBpmChange,
  onBeatSyncToggle,
  onBeatPunchChange,
}: TrackInfoBarProps) {
  return (
    <div
      className={`track-info-bar flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 bg-[#0f0f17]/80 backdrop-blur-xl border-b border-white/5 shrink-0 text-sm overflow-x-auto ${focusMode ? "hidden" : ""}`}
    >
      <div className="flex items-center gap-2 shrink-0">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${beatSync ? "bg-amber-500/20" : "bg-white/5"}`}>
          <Zap size={14} className={beatSync ? "text-amber-400" : "text-white/40"} />
        </div>
        <input
          type="number"
          value={bpm}
          onChange={(e) => onBpmChange(Number(e.target.value))}
          className="w-14 bg-black/30 text-white rounded-xl px-2 py-1 text-center font-mono border border-white/10 focus:border-violet-500/50 focus:outline-none transition-colors"
          min={60}
          max={220}
        />
        <span className="text-white/60 text-xs">BPM</span>
      </div>
      <button
        onClick={onBeatSyncToggle}
        className={`px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 transition-all hover:scale-105 active:scale-95 ${beatSync ? "bg-violet-600 text-white shadow-lg shadow-violet-500/20" : "bg-white/5 hover:bg-white/10 text-white/70 border border-white/5"}`}
      >
        {beatSync ? "Sync ON" : "Sync OFF"}
      </button>
      <div className="text-gray-400 shrink-0">
        Beats:{" "}
        <span
          className={
            beatAnalysis
              ? "text-amber-300 font-mono"
              : "text-gray-500 font-mono"
          }
        >
          {beatLoading
            ? "loading…"
            : beatAnalysis
              ? beatAnalysis.beat_count
              : beatError
                ? "0"
                : "—"}
        </span>
      </div>
      {beatAnalysis && (
        <div className="flex items-center gap-2 shrink-0 bg-black/20 px-3 py-1.5 rounded-xl border border-white/5">
          <span className="text-white/60 text-xs">Punch</span>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            value={beatPunch}
            onChange={(e) => onBeatPunchChange(Number(e.target.value))}
            className="w-28 accent-amber-400 h-1.5"
          />
          <span className="text-amber-300 font-mono w-7 text-right text-xs">
            {beatPunch.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}
