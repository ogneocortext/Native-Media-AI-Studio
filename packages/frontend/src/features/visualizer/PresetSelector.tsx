import { useState, useCallback } from "react";
import {
  Activity,
  BarChart3,
  Camera,
  Circle,
  Globe,
  Mic,
  Mountain,
  Star,
  Zap,
} from "lucide-react";
import { PRESET_LIBRARY, type VisualPreset, getPresetById } from "./aiPresetCatalog";

export type { VisualPreset } from "./aiPresetCatalog";

interface PresetSelectorProps {
  currentPresetId: string;
  onSelect: (preset: VisualPreset) => void;
}

const VISUALIZER_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  particles: Zap,
  waveform: Activity,
  pulse: Circle,
  bars: BarChart3,
  galaxy: Star,
  terrain: Mountain,
};

function VisualizerIcon({ style }: { style: string }) {
  const Icon = VISUALIZER_ICONS[style] ?? Globe;
  return <Icon size={12} className="text-accent" />;
}

export function PresetSelector({ currentPresetId, onSelect }: PresetSelectorProps) {
  const [selectedId, setSelectedId] = useState(currentPresetId);

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const preset = getPresetById(id);
      if (preset) onSelect(preset);
    },
    [onSelect],
  );

  return (
    <div className="kt-preset-selector">
      <div className="kt-preset-tabs">
        {PRESET_LIBRARY.map((preset) => (
          <button
            key={preset.id}
            className={`kt-preset-tab ${selectedId === preset.id ? "active" : ""}`}
            onClick={() => handleSelect(preset.id)}
            title={preset.description}
          >
            <VisualizerIcon style={preset.visualizer.style} />
            <span className="kt-preset-tab-name">{preset.name}</span>
          </button>
        ))}
      </div>
      {selectedId && <PresetPreview preset={getPresetById(selectedId)} />}
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
        <div className="flex items-center gap-1">
          <Activity size={12} />
          <span>Visualizer: {preset.visualizer.style}</span>
        </div>
        <div className="flex items-center gap-1">
          <Camera size={12} />
          <span>Camera: {preset.camera.mode}</span>
        </div>
        <div className="flex items-center gap-1">
          <Mic size={12} />
          <span>Lyrics: {preset.lyrics.style}</span>
        </div>
      </div>
    </div>
  );
}
