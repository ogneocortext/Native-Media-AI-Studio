import { DS } from "../../styles/designSystem";
import type { Tool } from "./types";

interface ToolEditorProps {
  editingTool: Tool;
  setEditingTool: (tool: Tool) => void;
  toolJsonValid: boolean;
  setToolJsonValid: (valid: boolean) => void;
  onSave: (tool: Tool) => void;
  onClose: () => void;
}

export function ToolEditor({ editingTool, setEditingTool, toolJsonValid, setToolJsonValid, onSave, onClose }: ToolEditorProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700">
        <h3 className="text-white font-semibold mb-4">Edit Tool</h3>
        <div className="space-y-3">
          <div>
            <label className={DS.textSm + " block mb-1"}>Name</label>
            <input
              type="text"
              value={editingTool.name}
              onChange={(e) => setEditingTool({ ...editingTool, name: e.target.value })}
              className={DS.input}
            />
          </div>
          <div>
            <label className={DS.textSm + " block mb-1"}>Description</label>
            <textarea
              value={editingTool.description}
              onChange={(e) => setEditingTool({ ...editingTool, description: e.target.value })}
              className={DS.textarea}
              rows={2}
            />
          </div>
          <div>
            <label className={DS.textSm + " block mb-1"}>Parameters (JSON)</label>
            <textarea
              value={JSON.stringify(editingTool.parameters, null, 2)}
              onChange={(e) => {
                try {
                  const params = JSON.parse(e.target.value);
                  setEditingTool({ ...editingTool, parameters: params });
                  setToolJsonValid(true);
                } catch {
                  setToolJsonValid(false);
                }
              }}
              className={DS.textarea + " " + DS.mono + (toolJsonValid ? "" : " border-red-500")}
              rows={6}
            />
            {!toolJsonValid && (
              <p className="text-red-400 text-xs mt-1">Invalid JSON</p>
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => onSave(editingTool)}
            disabled={!toolJsonValid || !editingTool.name.trim()}
            className={"flex-1 " + DS.btnPrimary + ((!toolJsonValid || !editingTool.name.trim()) ? " opacity-50 cursor-not-allowed" : "")}
          >
            Save
          </button>
          <button
            onClick={onClose}
            className={"flex-1 " + DS.btnSecondary}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
