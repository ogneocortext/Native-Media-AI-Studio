/**
 * SectionsDisplay — displays detected song sections
 */
import { coalesceSections, type DisplaySection } from "../utils/sectionCoalescer";
import { getEnergyColor } from "./EnergyChart";

export function SectionsDisplay({ sections }: { sections: DisplaySection[] }) {
  const coalesced = coalesceSections(sections);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Detected Sections</h3>
      <div className="space-y-2">
        {coalesced.map((section, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 bg-surface rounded-lg border border-border"
          >
            <div
              className="w-1 h-8 rounded-full"
              style={{ backgroundColor: getEnergyColor(section.energy) }}
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground capitalize">
                  {section.type}
                </span>
                <span className="text-xs text-muted">
                  {section.start.toFixed(1)}s - {section.end.toFixed(1)}s
                </span>
              </div>
              <p className="text-xs text-muted">
                Energy: {(section.energy * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
