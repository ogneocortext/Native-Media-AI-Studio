/**
 * ChatHeader — slim one-line header for the AI Tools chat column.
 *
 * Page title, Ollama status indicator, current model selector (the ONE place
 * the selected model is named), New chat and Clear buttons.
 */

import { Activity, RotateCw, Trash2, WifiOff } from "lucide-react";
import type { OllamaModel } from "../../services/api";
import { DS } from "../../styles/designSystem";

interface ChatHeaderProps {
  ollamaConnected: boolean;
  selectedModel: string | null;
  models: OllamaModel[];
  onSelectModel: (model: string) => void;
  onNewChat: () => void;
  onClear: () => void;
}

export function ChatHeader({
  ollamaConnected,
  selectedModel,
  models,
  onSelectModel,
  onNewChat,
  onClear,
}: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <Activity size={16} className="text-primary" />
        </div>
        <div>
          <h1 className={DS.pageTitle}>AI Tools</h1>
          <p className={DS.pageSubtitle}>
            Chat with local Ollama models, run tools, and generate visualizations.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {ollamaConnected ? (
          <span className={"flex items-center gap-1 text-xs " + DS.accentGreen}>
            <Activity size={12} /> Ollama online
          </span>
        ) : (
          <span className={"flex items-center gap-1 text-xs " + DS.accentRed}>
            <WifiOff size={12} /> Ollama offline
          </span>
        )}
        <select
          value={selectedModel ?? ""}
          onChange={(e) => onSelectModel(e.target.value)}
          disabled={!ollamaConnected || models.length === 0}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-xs text-white focus:border-primary focus:outline-none"
        >
          <option value="">Select a model</option>
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          onClick={onNewChat}
          className="px-3 py-1.5 text-xs rounded bg-gray-700/50 hover:bg-gray-600 text-gray-300 border border-gray-600 flex items-center gap-1"
          title="Start a new conversation"
        >
          <RotateCw size={13} className="text-gray-400 shrink-0" />
          New chat
        </button>
        <button
          onClick={onClear}
          disabled={!ollamaConnected}
          className="px-3 py-1.5 text-xs rounded bg-gray-700/50 hover:bg-gray-600 text-gray-300 border border-gray-600 flex items-center gap-1 disabled:opacity-50"
          title="Clear the conversation"
        >
          <Trash2 size={13} className="text-gray-400 shrink-0" />
          Clear
        </button>
      </div>
    </div>
  );
}
