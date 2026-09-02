import type { VizParams } from "../types";
import { DEFAULT_VIZ_PARAMS } from "../types";
import { kineticPresetList } from "./KineticPresets";
import { visualPresetList } from "../visualPresets";

interface Props {
  params: VizParams;
  onChange: (params: VizParams) => void;
  bgColor: string;
  meshColor: string;
  onBgChange: (c: string) => void;
  onMeshChange: (c: string) => void;
  demoEnabled: boolean;
  onDemoToggle: (v: boolean) => void;
  kineticPreset: string;
  onKineticPresetChange: (p: string) => void;
}

export function SettingsPanel({ params, onChange, bgColor, meshColor, onBgChange, onMeshChange, demoEnabled, onDemoToggle, kineticPreset, onKineticPresetChange }: Props) {
  return (
    <aside className="viz-settings">
      <div className="viz-settings-section">
        <h4>Visual Presets</h4>
        <div className="kinetic-preset-list">
          {visualPresetList.filter(p => p.id !== "balanced").map(p => (
            <button
              key={p.id}
              className={`kinetic-preset-btn ${kineticPreset === p.kineticPreset ? "active" : ""}`}
              onClick={() => {
                onChange({ ...DEFAULT_VIZ_PARAMS, ...p.vizParams });
                onBgChange(p.bgColor);
                onMeshChange(p.meshColor);
                onKineticPresetChange(p.kineticPreset);
              }}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="viz-settings-section">
        <h4>Appearance</h4>
        <div className="viz-slider-row"><label>Scale</label><input type="range" min="0.5" max="3" step="0.1" value={params.scale} onChange={(e) => onChange({ ...params, scale: parseFloat(e.target.value) })} /><span>{params.scale.toFixed(1)}</span></div>
        <div className="viz-slider-row"><label>Glow</label><input type="range" min="0" max="1" step="0.05" value={params.glowIntensity} onChange={(e) => onChange({ ...params, glowIntensity: parseFloat(e.target.value) })} /><span>{params.glowIntensity.toFixed(2)}</span></div>
        <div className="viz-slider-row"><label>Response</label><input type="range" min="0.1" max="1" step="0.05" value={params.lerpSpeed} onChange={(e) => onChange({ ...params, lerpSpeed: parseFloat(e.target.value) })} /><span>{params.lerpSpeed.toFixed(2)}</span></div>
        <div className="viz-slider-row"><label>Rotation</label><input type="range" min="0.1" max="5" step="0.1" value={params.rotationSpeed} onChange={(e) => onChange({ ...params, rotationSpeed: parseFloat(e.target.value) })} /><span>{params.rotationSpeed.toFixed(1)}</span></div>
      </div>
      <div className="viz-settings-section">
        <h4>Colors</h4>
        <div className="viz-color-row"><label>Background</label><input type="color" value={bgColor} onChange={(e) => onBgChange(e.target.value)} /></div>
        <div className="viz-color-row"><label>Mesh</label><input type="color" value={meshColor} onChange={(e) => onMeshChange(e.target.value)} /></div>
      </div>
      <div className="viz-settings-section">
        <h4>Lyric Animation</h4>
        <div className="kinetic-preset-list">
          {kineticPresetList.map(p => (
            <button
              key={p.id}
              className={`kinetic-preset-btn ${kineticPreset === p.id ? "active" : ""}`}
              onClick={() => onKineticPresetChange(p.id)}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
        </div>
        <small className="viz-hint">Auto-switches based on LRC section when track loads</small>
      </div>
      <div className="viz-settings-section">
        <label className="viz-check"><input type="checkbox" checked={demoEnabled} onChange={(e) => onDemoToggle(e.target.checked)} /><span>Demo animation</span></label>
        <label className="viz-check"><input type="checkbox" checked={params.fogEnabled} onChange={(e) => onChange({ ...params, fogEnabled: e.target.checked })} /><span>Fog</span></label>
        <label className="viz-check"><input type="checkbox" checked={params.showGround} onChange={(e) => onChange({ ...params, showGround: e.target.checked })} /><span>Ground</span></label>
        <button className="viz-reset" onClick={() => onChange(DEFAULT_VIZ_PARAMS)}>Reset All</button>
      </div>
    </aside>
  );
}
