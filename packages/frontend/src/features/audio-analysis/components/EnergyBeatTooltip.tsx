/**
 * EnergyBeatTooltip — tooltip for energy chart
 */

export const EnergyBeatTooltip = ({
  active,
  payload,
}: {
  active: boolean;
  payload?: Array<{ payload: unknown }>;
}) => {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload as {
    time: number;
    energy: number;
  };
  return (
    <div className="bg-surface border border-border rounded-lg p-3 shadow-lg">
      <p className="text-xs font-semibold text-foreground">Time: {data.time.toFixed(1)}s</p>
      <p className="text-xs text-muted">Energy: {(data.energy * 100).toFixed(0)}%</p>
    </div>
  );
};
