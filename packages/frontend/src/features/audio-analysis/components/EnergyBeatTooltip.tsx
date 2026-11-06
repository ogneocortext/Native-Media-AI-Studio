/**
 * EnergyBeatTooltip — tooltip for energy chart.
 *
 * Energy is a normalized intensity value from 0 (quiet/sparse) to
 * 1 (dense/intense), computed from the audio's spectral features.
 */

export const EnergyBeatTooltip = ({
  active,
  payload,
}: {
  active: boolean;
  payload?: { payload: unknown }[];
}) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload as {
    time: number;
    energy: number;
  };
  const energyPct = (data.energy * 100).toFixed(0);
  return (
    <div className="bg-surface border border-border rounded-lg p-3 shadow-lg">
      <p className="text-xs font-semibold text-foreground">Time: {data.time.toFixed(1)}s</p>
      <p className="text-xs text-muted">
        Energy: {energyPct}% (
        {data.energy > 0.6 ? "intense" : data.energy > 0.3 ? "moderate" : "quiet"})
      </p>
    </div>
  );
};
