/**
 * SectionsDisplay — displays detected song sections.
 *
 * Sections are structural parts of the track (intro, verse, chorus, etc.)
 * detected by the backend analysis pipeline. Energy is a normalized value
 * from 0 (quiet/sparse) to 1 (dense/intense).
 */
import { coalesceSections, type DisplaySection } from "../utils/sectionCoalescer";
import { getEnergyColor } from "./EnergyChart";
import { HelpCircle } from "lucide-react";

export function SectionsDisplay({ sections }: { sections: DisplaySection[] }) {
  const coalesced = coalesceSections(sections);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Detected Sections</h3>
        <span className="flex items-center gap-1" title="Structural sections detected by audio analysis">
          <HelpCircle size={14} className="text-muted" />
          <span className="text-[10px] text-muted">?</span>
        </span>
      </div>
      <p className="text-xs text-muted">
        Sections help you sync visuals to song structure. Energy shows relative
        intensity (0 = quiet, 1 = intense).
      </p>
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
                  {section.start.toFixed(1)}s – {section.end.toFixed(1)}s
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
