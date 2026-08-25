import {
  Plus, Trash2, Settings, Wrench, Sparkles, Cpu, MessageSquare,
} from "lucide-react";
import { DS } from "../../styles/designSystem";
import type { Tool, HistoryEntry } from "./types";
import type { OllamaModel } from "../../services/api";

interface SidebarProps {
  tools: Tool[];
  enabledTools: Set<string>;
  setEnabledTools: React.Dispatch<React.SetStateAction<Set<string>>>;
  setEditingTool: (tool: Tool) => void;
  setToolJsonValid: (valid: boolean) => void;
  setShowToolEditor: (show: boolean) => void;
  setTools: React.Dispatch<React.SetStateAction<Tool[]>>;
  setPrompt: (prompt: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: OllamaModel[];
  history: HistoryEntry[];
  setResponse: (response: string) => void;
}

const promptTemplates = [
  { label: "Video Concept", text: "Generate a creative music video concept for a [genre] song about [theme]. Include visual style, color palette, and camera movements." },
  { label: "Scene Description", text: "Describe a cinematic scene for a music video chorus section. Include lighting, mood, and visual elements." },
  { label: "Color Palette", text: "Suggest a color palette for a music video with [mood] mood. Include hex codes and usage guidelines." },
  { label: "Transition Ideas", text: "Suggest creative video transitions for a music video that sync to beat drops." },
  { label: "Project Status", text: "What's the current system health and job queue status?" },
  { label: "Visualization", text: "Use the generate_visualization tool to create a particles visualization with neon colors and high intensity" },
];

export function Sidebar({
  tools, enabledTools, setEnabledTools, setEditingTool, setToolJsonValid,
  setShowToolEditor, setTools, setPrompt, selectedModel, setSelectedModel,
  models, history, setResponse,
}: SidebarProps) {
  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${(bytes / 1e3).toFixed(0)} KB`;
  };

  const addTool = () => {
    const newTool: Tool = {
      id: `tool-${Date.now()}`,
      name: "",
      description: "",
      parameters: { type: "object", properties: {}, required: [] },
    };
    setEditingTool(newTool);
    setToolJsonValid(true);
    setShowToolEditor(true);
  };

  const deleteTool = (id: string) => {
    setTools((prev) => prev.filter((t) => t.id !== id));
    setEnabledTools((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Prompt Templates */}
      <div className={DS.card}>
        <h3 className={DS.sectionTitle}>
          <Sparkles size={14} />
          Templates
        </h3>
        <div className="space-y-2 mt-3">
          {promptTemplates.map((t) => (
            <button
              key={t.label}
              onClick={() => setPrompt(t.text)}
              className="w-full text-left px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tool Registry */}
      <div className={DS.card}>
        <div className={DS.flexBetween + " mb-3"}>
          <h3 className={DS.sectionTitle}>
            <Wrench size={14} />
            Tool Registry
          </h3>
          <button onClick={addTool} className={DS.btnGhost}>
            <Plus size={14} />
          </button>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {tools.map((tool) => (
            <div key={tool.id} className="flex items-center gap-2 p-2 bg-gray-700/30 rounded-lg">
              <input
                type="checkbox"
                checked={enabledTools.has(tool.id)}
                onChange={(e) => {
                  setEnabledTools((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(tool.id);
                    else next.delete(tool.id);
                    return next;
                  });
                }}
                className="accent-violet-500"
              />
              <span className="text-sm text-gray-300 flex-1 truncate">{tool.name}</span>
              <button onClick={() => { setEditingTool(tool); setToolJsonValid(true); setShowToolEditor(true); }} className="text-gray-500 hover:text-white">
                <Settings size={12} />
              </button>
              <button onClick={() => deleteTool(tool.id)} className="text-gray-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <p className={DS.textXs + " mt-2"}>
          Enabled: {enabledTools.size} / {tools.length}
        </p>
      </div>

      {/* Available Models */}
      <div className={DS.card}>
        <h3 className={DS.sectionTitle}>
          <Cpu size={14} />
          Models
        </h3>
        {models.length > 0 ? (
          <div className="space-y-1 mt-3">
            {models.map((m) => (
              <button
                key={m.name}
                onClick={() => setSelectedModel(m.name)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm ${
                  selectedModel === m.name ? "bg-violet-600/30 text-violet-300" : "text-gray-400 hover:bg-gray-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={DS.truncate}>{m.name}</span>
                  {m.supportsTools && <Wrench size={10} className={DS.accentGreen} />}
                  {m.supportsVision && <span className={DS.accentSky}>👁</span>}
                </div>
                <div className={DS.textXs}>{formatSize(m.size)}</div>
              </button>
            ))}
          </div>
        ) : (
          <p className={DS.textXs}>No models available</p>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className={DS.card}>
          <h3 className={DS.sectionTitle}>
            <MessageSquare size={14} />
            History
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto mt-3">
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => { setPrompt(h.prompt); setResponse(h.response); }}
                className="w-full text-left px-2 py-1.5 bg-gray-700/50 rounded text-xs text-gray-400 truncate hover:bg-gray-700"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{h.prompt}</span>
                  {h.toolCalls ? (
                    <span className="text-amber-400 ml-2">🔧{h.toolCalls}</span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
