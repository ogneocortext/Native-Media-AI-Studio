/**
 * VizInspector — the visualizer's right-side tabbed drawer.
 *
 * Replaces the scattered always-visible panels (settings aside, AI prompt,
 * bottom-bar mixer/EQ/remix stack) with one docked surface: a slim icon tab
 * bar on top and a scrollable body that hosts whichever panel is active.
 *
 * All panels stay mounted while the drawer is open (inactive ones get the
 * `hidden` attribute) so mixer/audio-graph state survives tab switches.
 * The drawer itself unmounts when closed, which is what gates expensive
 * panels like RemixPanel's stem probes.
 */
import type { ReactNode } from "react";
import { AudioLines, Palette, SlidersHorizontal, Sparkles, AudioWaveform } from "lucide-react";

export type VizInspectorTab = "scene" | "tuning" | "mixer" | "eq" | "ai";

const TABS: {
  id: VizInspectorTab;
  label: string;
  icon: typeof Palette;
  /** Requires a loaded track before the panel can do anything. */
  needsTrack?: boolean;
}[] = [
  { id: "scene", label: "Scene", icon: Palette },
  { id: "tuning", label: "Tuning", icon: SlidersHorizontal },
  { id: "mixer", label: "Mixer", icon: AudioLines, needsTrack: true },
  { id: "eq", label: "EQ", icon: AudioWaveform, needsTrack: true },
  { id: "ai", label: "AI", icon: Sparkles },
];

interface VizInspectorProps {
  open: boolean;
  tab: VizInspectorTab;
  onTabChange: (tab: VizInspectorTab) => void;
  /** Panel content keyed by tab. Missing entries render an empty state. */
  panels: Partial<Record<VizInspectorTab, ReactNode>>;
  /** True once a track is loaded — gates the track-dependent tabs. */
  trackLoaded: boolean;
}

export function VizInspector({ open, tab, onTabChange, panels, trackLoaded }: VizInspectorProps) {
  if (!open) return null;

  return (
    <aside className="viz-inspector" aria-label="Visualizer inspector">
      <div className="viz-inspector-tabs" role="tablist" aria-label="Inspector panels">
        {TABS.map(({ id, label, icon: Icon, needsTrack }) => {
          const disabled = !!needsTrack && !trackLoaded;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              aria-disabled={disabled}
              title={disabled ? `${label} — load a track first` : `${label} panel`}
              className={`viz-inspector-tab ${tab === id ? "active" : ""} ${
                disabled ? "disabled" : ""
              }`}
              onClick={() => {
                if (!disabled) onTabChange(id);
              }}
            >
              <Icon size={15} />
              <span className="viz-inspector-tab-label">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="viz-inspector-body">
        {TABS.map(({ id, label, needsTrack }) => {
          const disabled = !!needsTrack && !trackLoaded;
          const content = panels[id];
          return (
            <div key={id} role="tabpanel" hidden={tab !== id} className="viz-inspector-panel">
              {disabled ? (
                <p className="viz-inspector-empty">Load a track to use the {label} panel.</p>
              ) : (
                (content ?? <p className="viz-inspector-empty">Nothing here yet.</p>)
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
