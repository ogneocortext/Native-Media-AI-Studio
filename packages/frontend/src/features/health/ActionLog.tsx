import { Card } from "../../components/common";
import { Terminal } from "lucide-react";

export interface ActionLogEntry {
  time: string;
  message: string;
  type: string;
}

export interface ActionLogProps {
  logs: ActionLogEntry[];
  onClear: () => void;
}

export function ActionLog({ logs, onClear }: ActionLogProps) {
  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-indigo-400" />
          <h3 className="font-semibold text-sm">Action Log</h3>
          {logs.length > 0 && (
            <span className="text-xs text-muted">({logs.length} entries)</span>
          )}
        </div>
        {logs.length > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-muted hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div className="bg-gray-900 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs">
        {logs.length > 0 ? (
          logs.map((log, i) => (
            <div
              key={i}
              className={`flex gap-2 ${
                log.type === "error"
                  ? "text-red-400"
                  : log.type === "warning"
                    ? "text-yellow-400"
                    : log.type === "success"
                      ? "text-green-400"
                      : "text-gray-400"
              }`}
            >
              <span className="text-gray-600 shrink-0">[{log.time}]</span>
              <span>{log.message}</span>
            </div>
          ))
        ) : (
          <div className="text-center py-4 text-muted text-xs">
            No actions recorded. Start ComfyUI or perform other actions to see logs here.
          </div>
        )}
      </div>
    </Card>
  );
}
