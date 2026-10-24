import { ChevronUp, Settings, X } from "lucide-react";
import { DS } from "../../../styles/designSystem";

interface AdvancedSettingsProps {
  show: boolean;
  onToggle: () => void;
  duration: number;
  onDurationChange: (v: number) => void;
  verticalFirst: boolean;
  onVerticalFirstChange: (v: boolean) => void;
  scheduler: string;
  onSchedulerChange: (v: string) => void;
  onRandomSeed: () => void;
  fps: number;
  onFpsChange: (v: number) => void;
  resolution: string;
  onResolutionChange: (v: string) => void;
  batchCount: number;
  onBatchCountChange: (v: number) => void;
}

export function AdvancedSettings({
  show,
  onToggle,
  duration,
  onDurationChange,
  verticalFirst,
  onVerticalFirstChange,
  scheduler,
  onSchedulerChange,
  onRandomSeed,
  fps,
  onFpsChange,
  resolution,
  onResolutionChange,
  batchCount,
  onBatchCountChange,
}: AdvancedSettingsProps) {
  if (!show) return null;

  return (
    <div className={`${DS.card} border-primary/30`} style={{ padding: 16 }}>
      <div className="flex items-center gap-2 mb-3">
        <Settings size={16} />
        <h3 className="text-sm font-semibold text-white">Advanced</h3>
        <button onClick={onToggle} className="text-xs text-muted hover:text-white">
          <ChevronUp size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={DS.textLabel}>Duration (s)</label>
          <input
            type="number"
            value={duration}
            onChange={(e) => onDurationChange(Number(e.target.value))}
            className={DS.inputSm}
            min={1}
            max={15}
          />
        </div>
        <div>
          <label className={DS.textLabel}>FPS</label>
          <select
            value={fps}
            onChange={(e) => onFpsChange(Number(e.target.value))}
            className={DS.selectSm}
          >
            <option value={8}>8 — draft</option>
            <option value={12}>12</option>
            <option value={16}>16 — balanced</option>
            <option value={24}>24 — smooth</option>
          </select>
        </div>
        <div>
          <label className={DS.textLabel}>Resolution</label>
          <select
            value={resolution}
            onChange={(e) => onResolutionChange(e.target.value)}
            className={DS.selectSm}
          >
            <option value="480p">480p — 832×480 (8GB safe)</option>
            <option value="720p">720p — 1280×720 (needs 12GB+)</option>
          </select>
        </div>
        <div>
          <label className={DS.textLabel}>Batch</label>
          <input
            type="number"
            value={batchCount}
            onChange={(e) =>
              onBatchCountChange(Math.max(1, Math.min(10, Number(e.target.value))))
            }
            min={1}
            max={10}
            className={DS.inputSm}
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={onRandomSeed}
            className={`${DS.btnSecondary} px-3 text-xs`}
          >
            <X size={14} /> Random
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <label className="text-xs text-muted">Vertical first?</label>
          <input
            type="checkbox"
            checked={verticalFirst}
            onChange={(e) => onVerticalFirstChange(e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-violet-500 focus:ring-violet-500"
          />
      </div>
      <div className="flex items-center justify-between mt-1">
        <label className="text-xs text-muted">Scheduler</label>
        <select
          value={scheduler}
          onChange={(e) => onSchedulerChange(e.target.value)}
          className={DS.selectSm}
        >
          <option value="normal">Normal</option>
          <option value="mm_sd15">AnimateDiff SD 1.5</option>
          <option value="v2_lora">AnimateDiff LoRA</option>
        </select>
      </div>
      <p className="text-[10px] text-muted mt-2">
        {scheduler === "normal"
          ? "Tip: Start at 20 steps, re-render keepers at 25–30."
          : scheduler === "mm_sd15"
          ? "Tip: AnimateDiff SD 1.5 — 49–97 frames (2–4s) per clip."
          : "Tip: AnimateDiff LoRA — camera movements (zoom, pan)."}
      </p>
    </div>
  );
}
