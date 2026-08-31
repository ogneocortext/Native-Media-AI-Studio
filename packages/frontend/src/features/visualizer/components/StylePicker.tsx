import { memo } from "react";
import { VISUALIZATION_OPTIONS, VisualizationStyle } from "../trackConceptAnalyzer";

interface Props {
  active: VisualizationStyle;
  onChange: (style: VisualizationStyle) => void;
}

export const StylePicker = memo(function StylePicker({ active, onChange }: Props) {
  return (
    <div className="viz-style-picker">
      {VISUALIZATION_OPTIONS.map((viz) => (
        <button
          key={viz.id}
          className={`viz-style-btn ${active === viz.id ? "active" : ""}`}
          onClick={() => onChange(viz.id)}
          title={`${viz.name} — ${viz.description}`}
        >
          <span className="viz-style-name">{viz.name}</span>
        </button>
      ))}
    </div>
  );
});
