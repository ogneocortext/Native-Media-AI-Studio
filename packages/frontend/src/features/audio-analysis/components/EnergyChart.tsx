/**
 * EnergyChart — displays energy curve over time.
 *
 * Energy is a normalized intensity value from 0 (quiet/sparse) to
 * 1 (dense/intense), computed from the audio's spectral features.
 * Use it to identify high-energy moments for visual emphasis.
 */

export interface EnergyPoint {
  time: number;
  energy: number;
}

export function getEnergyColor(energy: number): string {
  if (energy < 0.3) return "#3b82f6";
  if (energy < 0.6) return "#f59e0b";
  return "#ef4444";
}

export function EnergyChart(_props: { data: EnergyPoint[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Energy Curve</h3>
        <span className="text-xs text-muted">0 (quiet) – 1 (intense)</span>
      </div>
      <p className="text-xs text-muted">
        Shows relative audio intensity over time. Higher peaks are good candidates for visual
        emphasis or beat-synced events.
      </p>
      <div className="h-32 bg-surface/50 rounded-lg overflow-hidden">
        {/* Chart implementation would go here */}
        <p className="text-xs text-muted p-4">Energy curve visualization</p>
      </div>
    </div>
  );
}
