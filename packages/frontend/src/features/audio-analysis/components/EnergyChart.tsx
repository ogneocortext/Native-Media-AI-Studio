/**
 * EnergyChart — displays energy curve over time
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
      <h3 className="text-sm font-semibold text-foreground">Energy Curve</h3>
      <div className="h-32 bg-surface/50 rounded-lg overflow-hidden">
        {/* Chart implementation would go here */}
        <p className="text-xs text-muted p-4">Energy curve visualization</p>
      </div>
    </div>
  );
}
