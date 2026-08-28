import type { AnimObject } from "../types";
import { SliderRow } from "./SliderRow";

interface InspectorTabProps {
  object: AnimObject | undefined;
  onUpdate: (id: string, updates: Partial<AnimObject>) => void;
}

export function InspectorTab({ object, onUpdate }: InspectorTabProps) {
  if (!object) {
    return <div className="text-gray-500 text-xs py-8 text-center">Select an object in the Objects tab to inspect its properties.</div>;
  }

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
    </div>
  );
}
