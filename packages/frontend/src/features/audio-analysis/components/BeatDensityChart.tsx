/**
 * BeatDensityChart — displays beat density per bar
 */

export interface BeatDensityPoint {
  bar: number;
  time: number;
  count: number;
  section: string;
  energy: number;
}

const BEATS_PER_BAR = 4;

export function buildBeatDensity(
  beats: number[],
  sections: { type: string; start: number; end: number; energy: number }[],
): BeatDensityPoint[] {
  const barMap = new Map<number, { count: number; section: string; energy: number }>();

  // Count beats per bar
  for (const beat of beats) {
    const bar = Math.floor(beat / BEATS_PER_BAR);
    const existing = barMap.get(bar) || { count: 0, section: "", energy: 0 };
    barMap.set(bar, { count: existing.count + 1, section: existing.section, energy: existing.energy });
  }

  // Assign sections and energy
  for (const section of sections) {
    const startBar = Math.floor(section.start / BEATS_PER_BAR);
    const endBar = Math.floor(section.end / BEATS_PER_BAR);
    for (let bar = startBar; bar <= endBar; bar++) {
      const existing = barMap.get(bar) || { count: 0, section: "", energy: 0 };
      barMap.set(bar, { count: existing.count, section: section.type, energy: section.energy });
    }
  }

  return Array.from(barMap.entries()).map(([bar, data]) => ({
    bar,
    time: bar * BEATS_PER_BAR,
    count: data.count,
    section: data.section,
    energy: data.energy,
  }));
}

export function getEnergyColor(energy: number): string {
  if (energy < 0.3) return "#3b82f6";
  if (energy < 0.6) return "#f59e0b";
  return "#ef4444";
}

export function BeatDensityChart(_props: { data: BeatDensityPoint[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Beat Density per Bar</h3>
      <div className="h-32 bg-surface/50 rounded-lg overflow-hidden">
        {/* Chart implementation would go here */}
        <p className="text-xs text-muted p-4">Beat density visualization</p>
      </div>
    </div>
  );
}
