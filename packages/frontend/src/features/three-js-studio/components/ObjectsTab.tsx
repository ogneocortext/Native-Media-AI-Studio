import { Sparkles, Box, Circle, Trash2, Eye, EyeOff, Layers, User } from "lucide-react";
import type { AnimObject } from "../types";
import { SCENE_TEMPLATES, type SceneTemplate } from "../sceneTemplates";

interface ObjectsTabProps {
  objects: AnimObject[];
  selectedObject: string | null;
  activeTemplateId: string | null;
  onSelectObject: (id: string) => void;
  onAddObject: (type: AnimObject["type"]) => void;
  onRemoveObject: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<AnimObject>) => void;
  onLoadTemplate: (template: SceneTemplate) => void;
}

export function ObjectsTab({
  objects, selectedObject, activeTemplateId,
  onSelectObject, onAddObject, onRemoveObject, onUpdateObject, onLoadTemplate,
}: ObjectsTabProps) {
  return (
    <div className="space-y-2">
      {/* Scene Templates */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5 flex items-center gap-1.5">
          <Sparkles size={10} /> Scene Templates
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {SCENE_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => onLoadTemplate(tpl)}
              title={tpl.description}
              className={`px-2 py-2 rounded text-xs flex flex-col items-center gap-0.5 transition-colors min-w-0 ${
                activeTemplateId === tpl.id
                  ? "bg-purple-600/30 border border-purple-500/50 text-white"
                  : "bg-gray-800 hover:bg-gray-700 border border-transparent text-gray-200"
              }`}
            >
              <span className="text-base leading-none">{tpl.emoji}</span>
              <span className="truncate w-full text-center">{tpl.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quick add row */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Add Shape</div>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
          <button onClick={() => onAddObject("crown")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center gap-1 min-w-0 truncate">👑 <span className="hidden sm:inline">Crown</span></button>
          <button onClick={() => onAddObject("sphere")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center gap-1 min-w-0 truncate"><Circle size={11} /> <span className="hidden sm:inline">Sphere</span></button>
          <button onClick={() => onAddObject("box")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center gap-1 min-w-0 truncate"><Box size={11} /> <span className="hidden sm:inline">Box</span></button>
          <button onClick={() => onAddObject("cylinder")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center min-w-0 truncate">Cyl</button>
          <button onClick={() => onAddObject("cone")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center min-w-0 truncate">Cone</button>
          <button onClick={() => onAddObject("torus")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center min-w-0 truncate">Torus</button>
          <button onClick={() => onAddObject("character")} className="px-2 py-1.5 bg-amber-900/40 hover:bg-amber-800/50 rounded text-xs flex items-center justify-center gap-1 min-w-0 truncate text-amber-200"><User size={11} /> <span className="hidden sm:inline">Character</span></button>
        </div>
      </div>

      {/* Object list */}
      <div className="space-y-1">
        {objects.map((obj) => (
          <div
            key={obj.id}
            onClick={() => onSelectObject(obj.id)}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
              selectedObject === obj.id
                ? "bg-purple-600/30 border border-purple-500/50 text-white font-medium"
                : "hover:bg-gray-800 text-gray-300 border border-transparent"
            }`}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onUpdateObject(obj.id, { visible: !obj.visible }); }}
              className="text-gray-400 hover:text-white shrink-0"
              title={obj.visible ? "Hide" : "Show"}
            >
              {obj.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onUpdateObject(obj.id, { bloom: !obj.bloom }); }}
              className={obj.bloom ? "text-amber-300 shrink-0" : "text-gray-600 hover:text-amber-300 shrink-0"}
              title={obj.bloom ? "Hero glow ON" : "Hero glow OFF"}
            >
              <Layers size={12} />
            </button>
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: obj.color }} />
            <span className="flex-1 truncate min-w-0">{obj.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemoveObject(obj.id); }}
              className="text-gray-500 hover:text-red-400 shrink-0"
              title="Remove"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {objects.length === 0 && (
          <div className="text-gray-500 text-xs py-4 text-center">No objects. Click a button above to add one.</div>
        )}
      </div>
    </div>
  );
}
