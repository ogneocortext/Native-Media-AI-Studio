import { useState, useRef } from "react";
import type { AnimObject } from "../types";
import { SliderRow } from "./SliderRow";

export interface CharacterAnimationState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  clipNames: string[];
}

interface InspectorTabProps {
  object: AnimObject | undefined;
  onUpdate: (id: string, updates: Partial<AnimObject>) => void;
  animationState?: CharacterAnimationState;
  onAnimationPlayPause?: () => void;
  onAnimationSeek?: (time: number) => void;
  onAnimationSelect?: (clipName: string) => void;
}

export function InspectorTab({
  object, onUpdate,
  animationState,
  onAnimationPlayPause,
  onAnimationSeek,
  onAnimationSelect,
}: InspectorTabProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!object) {
    return <div className="text-gray-500 text-xs py-8 text-center">Select an object in the Objects tab to inspect its properties.</div>;
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".glb") || file.name.endsWith(".gltf"))) {
      const url = URL.createObjectURL(file);
      onUpdate(object.id, { modelUrl: url });
    }
  };

  return (
    <div className="space-y-3 text-xs max-w-2xl">
      {/* Position */}
      <div>
        <label className="text-gray-400 block mb-1">Position (X, Y, Z)</label>
        <div className="grid grid-cols-3 gap-1.5">
          {["X", "Y", "Z"].map((axis, i) => (
            <input
              key={axis}
              type="number"
              step="0.2"
              value={object.position[i]}
              onChange={(e) => {
                const pos = [...object.position] as [number, number, number];
                pos[i] = Number(e.target.value);
                onUpdate(object.id, { position: pos });
              }}
              className="bg-gray-800 rounded px-1.5 py-1 text-center font-mono border border-gray-700 w-full"
            />
          ))}
        </div>
      </div>

      <SliderRow label="Rotation Speed" min={0} max={3} step={0.1} value={object.rotateSpeed} onChange={(v) => onUpdate(object.id, { rotateSpeed: v })} />
      <SliderRow label="Bob Speed" min={0} max={5} step={0.1} value={object.bobSpeed} onChange={(v) => onUpdate(object.id, { bobSpeed: v })} />
      <SliderRow label="Bob Amount" min={0} max={0.5} step={0.02} value={object.bobAmount} onChange={(v) => onUpdate(object.id, { bobAmount: v })} />

      <div className="border-t border-gray-800 pt-2 space-y-2">
        <div className="text-gray-400 font-medium">Material & Shading</div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Diffuse Color</span>
          <input type="color" value={object.color} onChange={(e) => onUpdate(object.id, { color: e.target.value })} className="w-9 h-7 rounded cursor-pointer bg-transparent" />
        </div>
        <SliderRow label="Metalness" min={0} max={1} step={0.05} value={object.metalness} onChange={(v) => onUpdate(object.id, { metalness: v })} />
        <SliderRow label="Roughness" min={0} max={1} step={0.05} value={object.roughness} onChange={(v) => onUpdate(object.id, { roughness: v })} />
        <SliderRow label="Glow / Emissive" min={0} max={2} step={0.1} value={object.emissiveIntensity} onChange={(v) => onUpdate(object.id, { emissiveIntensity: v })} />
      </div>

      {/* Character-specific controls */}
      {object.type === "character" && (
        <div className="border-t border-gray-800 pt-2 space-y-2">
          <div className="text-gray-400 font-medium">Character Model</div>

          {/* Drag-and-drop zone + file picker */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded p-3 text-center transition-colors cursor-pointer ${
              dragOver ? "border-amber-400 bg-amber-900/20" : "border-gray-600 hover:border-gray-500 bg-gray-800/50"
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="text-gray-400 text-[11px]">
              {dragOver ? "Drop GLB file here" : "Drag .glb here or click to browse"}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".glb,.gltf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const url = URL.createObjectURL(file);
                  onUpdate(object.id, { modelUrl: url });
                }
              }}
            />
          </div>

          {/* URL display with clear button */}
          <div>
            <label className="text-gray-400 block mb-1">Model URL</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={object.modelUrl || ""}
                onChange={(e) => onUpdate(object.id, { modelUrl: e.target.value })}
                placeholder="/output/generated_3d/character.glb"
                className="bg-gray-800 rounded px-1.5 py-1 text-xs font-mono border border-gray-700 flex-1 min-w-0"
              />
              {object.modelUrl && (
                <button
                  onClick={() => onUpdate(object.id, { modelUrl: "" })}
                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-400 hover:text-white"
                  title="Clear model"
                >X</button>
              )}
            </div>
          </div>

          {/* Animation controls */}
          <div className="border-t border-gray-800 pt-2 space-y-2">
            <div className="text-gray-400 font-medium">Animation</div>

            {/* Animation clip dropdown */}
            {animationState && animationState.clipNames.length > 0 && (
              <div>
                <label className="text-gray-400 block mb-1">Clip</label>
                <select
                  value={object.animationName || animationState.clipNames[0]}
                  onChange={(e) => {
                    onUpdate(object.id, { animationName: e.target.value });
                    onAnimationSelect?.(e.target.value);
                  }}
                  className="bg-gray-800 rounded px-1.5 py-1 text-xs border border-gray-700 w-full"
                >
                  {animationState.clipNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Manual clip name input (when no clips detected) */}
            {(!animationState || animationState.clipNames.length === 0) && (
              <div>
                <label className="text-gray-400 block mb-1">Animation Clip Name</label>
                <input
                  type="text"
                  value={object.animationName || ""}
                  onChange={(e) => onUpdate(object.id, { animationName: e.target.value })}
                  placeholder="auto-detect"
                  className="bg-gray-800 rounded px-1.5 py-1 text-xs font-mono border border-gray-700 w-full"
                />
              </div>
            )}

            {/* Timeline scrubber + play/pause */}
            {animationState && animationState.duration > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <button
                    onClick={onAnimationPlayPause}
                    className="px-2 py-0.5 bg-purple-600 hover:bg-purple-500 rounded text-white text-[11px]"
                  >
                    {animationState.isPlaying ? "Pause" : "Play"}
                  </button>
                  <span className="text-gray-500 font-mono text-[10px]">
                    {animationState.currentTime.toFixed(2)}s / {animationState.duration.toFixed(2)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={animationState.duration}
                  step={0.01}
                  value={animationState.currentTime}
                  onChange={(e) => onAnimationSeek?.(Number(e.target.value))}
                  className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>
            )}

            <SliderRow label="Speed" min={0.1} max={3} step={0.1} value={object.animationSpeed ?? 1} onChange={(v) => onUpdate(object.id, { animationSpeed: v })} />

            <div className="flex items-center justify-between">
              <span className="text-gray-400">Loop</span>
              <button
                onClick={() => onUpdate(object.id, { animationLoop: !object.animationLoop })}
                className={`px-2 py-0.5 rounded text-xs ${object.animationLoop !== false ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400"}`}
              >
                {object.animationLoop !== false ? "Looping" : "Once"}
              </button>
            </div>
          </div>

          {/* Character bible */}
          <div className="border-t border-gray-800 pt-2">
            <label className="text-gray-400 block mb-1">Character Bible</label>
            <textarea
              value={object.characterBible || ""}
              onChange={(e) => onUpdate(object.id, { characterBible: e.target.value })}
              placeholder="Describe this character for prompt consistency..."
              rows={3}
              className="bg-gray-800 rounded px-1.5 py-1 text-xs font-mono border border-gray-700 w-full resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
