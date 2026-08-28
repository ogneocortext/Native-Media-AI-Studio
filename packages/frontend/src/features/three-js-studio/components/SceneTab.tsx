import { Layers } from "lucide-react";
import type { SceneConfig, ParticleConfig, CameraMode } from "../types";
import { SliderRow } from "./SliderRow";

interface SceneTabProps {
  sceneConfig: SceneConfig;
  particleConfig: ParticleConfig;
  cameraMode: string;
  fps: number;
  backgroundImageUrl: string;
  backgroundImageVisible: boolean;
  libraryImages: Array<{ url: string; label: string }>;
  onSceneConfigChange: (config: SceneConfig) => void;
  onParticleConfigChange: (config: ParticleConfig) => void;
  onCameraModeChange: (mode: CameraMode) => void;
  onFpsChange: (fps: number) => void;
  onBackgroundImageChange: (url: string) => void;
  onBackgroundImageVisibleChange: (visible: boolean) => void;
}

export function SceneTab({
  sceneConfig, particleConfig, cameraMode, fps,
  backgroundImageUrl, backgroundImageVisible, libraryImages,
  onSceneConfigChange, onParticleConfigChange, onCameraModeChange, onFpsChange,
  onBackgroundImageChange, onBackgroundImageVisibleChange,
}: SceneTabProps) {
  return (
    <div className="space-y-3 text-xs max-w-2xl">
      <h3 className="text-sm font-semibold flex items-center gap-2 text-white">
        <Layers size={14} /> Scene Configuration
      </h3>

      <div>
        <label className="text-gray-400 block mb-1">Background Color</label>
        <input type="color" value={sceneConfig.backgroundColor} onChange={(e) => onSceneConfigChange({ ...sceneConfig, backgroundColor: e.target.value })} className="w-12 h-7 rounded cursor-pointer bg-transparent" />
      </div>

      {/* Background Image */}
      <div className="border border-gray-700 rounded p-2 bg-gray-900/50">
        <div className="text-gray-300 font-medium mb-1.5">Background Image</div>
        <input type="text" placeholder="/output/image/foo.png or https://..." value={backgroundImageUrl} onChange={(e) => onBackgroundImageChange(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white placeholder-gray-500" />
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Recent from library</div>
          <div className="grid grid-cols-6 gap-1 max-h-24 overflow-y-auto">
            {libraryImages.map((img) => (
              <button key={img.url} onClick={() => onBackgroundImageChange(img.url)} title={img.label} className="aspect-square bg-gray-800 rounded overflow-hidden border border-gray-700 hover:border-purple-500 transition-colors p-0">
                <img src={img.url} alt={img.label} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <label className="flex items-center gap-1.5 cursor-pointer text-gray-400">
            <input type="checkbox" checked={backgroundImageVisible} onChange={(e) => onBackgroundImageVisibleChange(e.target.checked)} className="accent-purple-500" />
            <span>Show background image</span>
          </label>
          {backgroundImageUrl && <button onClick={() => onBackgroundImageChange("")} className="text-xs text-red-400 hover:text-red-300">Clear</button>}
        </div>
      </div>

      <SliderRow label="Bloom Strength" min={0} max={1.5} step={0.05} value={sceneConfig.bloomStrength} onChange={(v) => onSceneConfigChange({ ...sceneConfig, bloomStrength: v })} />

      <label className="flex items-center gap-2 cursor-pointer text-gray-400">
        <input type="checkbox" checked={sceneConfig.selectiveBloom} onChange={(e) => onSceneConfigChange({ ...sceneConfig, selectiveBloom: e.target.checked })} className="accent-purple-500" />
        <Layers size={13} className="text-amber-300" />
        <span>Selective Bloom (hero glow only)</span>
      </label>

      <div className="border-t border-gray-800 pt-2">
        <h4 className="text-xs font-semibold text-gray-300 mb-2">Post FX Chain</h4>
        <SliderRow label="Chromatic Aberration" min={0} max={0.01} step={0.0005} value={sceneConfig.chromaticAberration} onChange={(v) => onSceneConfigChange({ ...sceneConfig, chromaticAberration: v })} displayDecimals={4} />
        <SliderRow label="Film Grain" min={0} max={0.5} step={0.01} value={sceneConfig.filmGrain} onChange={(v) => onSceneConfigChange({ ...sceneConfig, filmGrain: v })} />
        <SliderRow label="Vignette Darkness" min={0} max={1} step={0.05} value={sceneConfig.vignetteStrength} onChange={(v) => onSceneConfigChange({ ...sceneConfig, vignetteStrength: v })} />
        <SliderRow label="Vignette Radius" min={0} max={1} step={0.05} value={sceneConfig.vignetteRadius} onChange={(v) => onSceneConfigChange({ ...sceneConfig, vignetteRadius: v })} />
      </div>

      <div className="border-t border-gray-800 pt-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Particle Cloud</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={particleConfig.enabled} onChange={(e) => onParticleConfigChange({ ...particleConfig, enabled: e.target.checked })} className="accent-purple-500" />
            <span>Active</span>
          </label>
        </div>
        {particleConfig.enabled && (
          <SliderRow label={`Count: ${particleConfig.count}`} min={50} max={1000} step={50} value={particleConfig.count} onChange={(v) => onParticleConfigChange({ ...particleConfig, count: v })} />
        )}
        {particleConfig.enabled && (
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Color</span>
            <input type="color" value={particleConfig.color} onChange={(e) => onParticleConfigChange({ ...particleConfig, color: e.target.value })} className="w-9 h-6 rounded cursor-pointer bg-transparent" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-gray-400 block mb-1">Camera Trajectory</label>
          <select value={cameraMode} onChange={(e) => onCameraModeChange(e.target.value as CameraMode)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white">
            <option value="orbit">Orbit 360°</option>
            <option value="dolly">Dolly Zoom</option>
            <option value="handheld">Handheld</option>
            <option value="static">Static</option>
          </select>
        </div>
        <div>
          <label className="text-gray-400 block mb-1">Target FPS</label>
          <select value={fps} onChange={(e) => onFpsChange(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white">
            <option value={24}>24 (Cinematic)</option>
            <option value={30}>30 (Standard)</option>
            <option value={60}>60 (Smooth)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
