/**
 * BeatDensityTooltip — tooltip for beat density chart.
 *
 * Energy is a normalized intensity value from 0 (quiet/sparse) to
 * 1 (dense/intense), computed from the audio's spectral features.
 */

const SECTION_HEX: Record<string, string> = {
  intro: "#3b82f6",
  verse: "#22c55e",
  chorus: "#8b5cf6",
  bridge: "#f97316",
  solo: "#ec4899",
  drop: "#06b6d4",
  outro: "#6b7280",
};

export const BeatDensityTooltip = ({
  active,
  payload,
}: {
  active: boolean;
  payload?: { payload: unknown }[];
}) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload as {
    bar: number;
    time: number;
    count: number;
    section: string;
    energy: number;
  };
  const energyPct = (data.energy * 100).toFixed(0);
  return (
    <div className="bg-surface border border-border rounded-lg p-3 shadow-lg">
      <p className="text-xs font-semibold text-foreground">Bar {data.bar}</p>
      <p className="text-xs text-muted">Time: {data.time.toFixed(1)}s</p>
      <p className="text-xs text-muted">Beats: {data.count}</p>
      <div className="flex items-center gap-2 mt-1">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: SECTION_HEX[data.section] || "#888" }}
        />
        <p className="text-xs text-muted capitalize">{data.section}</p>
      </div>
      <p className="text-xs text-muted">
        Energy: {energyPct}% (
        {data.energy > 0.6 ? "intense" : data.energy > 0.3 ? "moderate" : "quiet"}
        )
      </p>
    </div>
  );
};
