import { useState, useCallback } from "react";
import {
  PRESET_LIBRARY,
  type VisualPreset,
  getPresetById,
} from "./visualPreset";

export type { VisualPreset } from "./visualPreset";

interface PresetSelectorProps {
  currentPresetId: string;
  onSelect: (preset: VisualPreset) => void;
}

export function PresetSelector({ currentPresetId, onSelect }: PresetSelectorProps) {
  const [selectedId, setSelectedId] = useState(currentPresetId);

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const preset = getPresetById(id);
      if (preset) onSelect(preset);
    },
    [onSelect]
  );

  return (
    <div className="kt-preset-selector">
      <div className="kt-preset-tabs">
        {PRESET_LIBRARY.map((preset) => (
          <button
            key={preset.id}
            className={`kt-preset-tab ${selectedId === preset.id ? "active" : ""}`}
            onClick={() => handleSelect(preset.id)}
          >
            <span
              className="kt-preset-tab-dot"
              style={{ background: preset.theme.primary }}
            />
            <span className="kt-preset-tab-name">{preset.name}</span>
          </button>
        ))}
      </div>
      {selectedId && (
        <PresetPreview preset={getPresetById(selectedId)!} />
      )}
    </div>
  );
}

function PresetPreview({ preset }: { preset: VisualPreset }) {
  return (
    <div className="kt-preset-preview">
      <div className="kt-preset-preview-colors">
        {Object.entries(preset.theme)
          .filter(([key]) => key !== "background" && key !== "text")
          .map(([key, color]) => (
            <div
              key={key}
              className="kt-preset-preview-swatch"
              style={{ background: color }}
              title={`${key}: ${color}`}
            />
          ))}
      </div>
      <div className="kt-preset-preview-tags">
        {preset.tags.map((tag) => (
          <span key={tag} className="kt-preset-preview-tag">
            {tag}
          </span>
        ))}
      </div>
      <p className="kt-preset-preview-desc">{preset.description}</p>
      <div className="kt-preset-preview-details">
        <span>Visualizer: {preset.visualizer.style}</span>
        <span>Camera: {preset.camera.mode}</span>
        <span>Lyrics: {preset.lyrics.style}</span>
      </div>
    </div>
  );
}
