/**
 * BeatDensityTooltip — tooltip for beat density chart
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
  payload?: Array<{ payload: unknown }>;
}) => {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload as {
    bar: number;
    time: number;
    count: number;
    section: string;
    energy: number;
  };
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
      <p className="text-xs text-muted">Energy: {(data.energy * 100).toFixed(0)}%</p>
    </div>
  );
};
