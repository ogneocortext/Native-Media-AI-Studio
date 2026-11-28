/**
 * OllamaModelManager — install, remove, and inspect Ollama models from the UI.
 *
 * Wires up the new /api/integrations/ollama/pull, /delete, and /ps routes so
 * users can manage models without leaving the app. Particularly useful on the
 * 8 GB card where only one heavy model fits in VRAM at a time.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, RefreshCw, Download, AlertCircle, CheckCircle } from "lucide-react";
import {
  deleteOllamaModel,
  getLoadedOllamaModels,
  getOllamaModels,
  pullOllamaModel,
  type OllamaModel,
} from "../../services/api";
import { DS } from "../../styles/designSystem";

const rowLabel = (label: string, count: number) => (
  <div className={`${DS.flexBetween} mb-1 text-xs text-muted uppercase tracking-wider font-semibold`}>
    <span>{label}</span>
    <span>{count}</span>
  </div>
);

export function OllamaModelManager() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loaded, setLoaded] = useState<unknown[]>([]);
  const [pulling, setPulling] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pullInput, setPullInput] = useState("");
  const [pullError, setPullError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const pullInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [modelsRes, loadedRes] = await Promise.allSettled([
      getOllamaModels(false).catch(() => [] as OllamaModel[]),
      getLoadedOllamaModels().catch(() => ({ models: [] as unknown[] })),
    ]);
    if (modelsRes.status === "fulfilled") setModels(modelsRes.value);
    if (loadedRes.status === "fulfilled") setLoaded(loadedRes.value.models);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePull = async () => {
    const model = pullInput.trim();
    if (!model || pulling) return;
    setPullError(null);
    setPulling(true);
    try {
      const res = await pullOllamaModel(model);
      if (res.success) {
        setPullInput("");
        pullInputRef.current?.focus();
        void load();
      } else {
        setPullError(res.error ?? "Pull failed");
      }
    } catch (err) {
      setPullError(err instanceof Error ? err.message : "Pull failed");
    } finally {
      setPulling(false);
    }
  };

  const handleDelete = async (model: string) => {
    if (!window.confirm(`Delete model "${model}"? This cannot be undone.`)) return;
    setDeleting(model);
    setDeleteError(null);
    try {
      const res = await deleteOllamaModel(model);
      if (res.success) {
        void load();
      } else {
        setDeleteError(res.error ?? "Delete failed");
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return `${size.toFixed(1)} ${units[unit]}`;
  };

  return (
    <div className={DS.card}>
      <div className={`${DS.flexBetween} mb-3`}>
        <h3 className={DS.sectionTitle}>
          <Download size={14} />
          Ollama Models
        </h3>
        <button
          onClick={() => void load()}
          className={DS.btnGhost}
          aria-label="Refresh model list"
          title="Refresh model list"
          disabled={pulling}
        >
          <RefreshCw size={13} className={pulling ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Installed models */}
      <div className="space-y-2 mb-4">
        {rowLabel("Installed", models.length)}
        {models.length === 0 ? (
          <p className={`${DS.textXs} text-muted py-2 text-center`}>
            No Ollama models installed. Pull one below.
          </p>
        ) : (
          <div className="space-y-1">
            {models.map((m) => (
              <div
                key={m.name}
                className="flex items-center justify-between gap-2 p-2 bg-gray-700/30 rounded-lg border border-transparent hover:border-gray-500"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm text-foreground truncate">{m.name}</span>
                  {m.broken_reason && (
                    <span className="text-[10px] text-red-400/80 shrink-0">{m.broken_reason}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted shrink-0">
                  {m.capabilities?.includes("vision") && (
                    <span title="Vision" className="flex items-center gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-blue-400" />
                    </span>
                  )}
                  {m.capabilities?.includes("thinking") && (
                    <span title="Thinking" className="flex items-center gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-purple-400" />
                    </span>
                  )}
                  {m.capabilities?.includes("tools") && (
                    <span title="Tools" className="flex items-center gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-emerald-400" />
                    </span>
                  )}
                  <span className="font-mono">{formatSize(m.size || 0)}</span>
                  {m.vram_estimate_mb && (
                    <span className="text-gray-500">· ~{m.vram_estimate_mb} MB VRAM</span>
                  )}
                </div>
                <button
                  onClick={() => {
                    void handleDelete(m.name);
                  }}
                  disabled={deleting === m.name}
                  className="p-1 hover:bg-gray-600 rounded text-muted hover:text-red-400 shrink-0"
                  aria-label={`Delete ${m.name}`}
                  title={`Delete ${m.name}`}
                >
                  {deleting === m.name ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
        {deleteError && (
          <p className={`${DS.textXs} text-red-400 mt-1 flex items-center gap-1`}>
            <AlertCircle size={12} className="mr-1 shrink-0" /> {deleteError}
          </p>
        )}
      </div>

      {/* Loaded models (/api/ps) */}
      <div className="space-y-2 mb-4">
        {rowLabel("Loaded in VRAM", loaded.length)}
        {loaded.length === 0 ? (
          <p className={`${DS.textXs} text-muted py-2 text-center`}>
            No models currently loaded.
          </p>
        ) : (
          <div className="space-y-1">
            {loaded.map((m, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 bg-gray-700/30 rounded-lg"
              >
                <span className="text-sm text-foreground truncate">
                  {typeof m === "object" && m !== null && "name" in m
                    ? String((m as { name: string }).name)
                    : String(m)}
                </span>
                <span className={`${DS.textXs} text-emerald-400 font-mono`}>loaded</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pull new model */}
      <div className="pt-3 border-t border-gray-700/50">
        <div className={`${DS.flexBetween} mb-2 text-xs text-muted uppercase tracking-wider font-semibold`}>
          <span>Pull new model</span>
          <span className={`${DS.textXs} text-gray-500`}>e.g. llama3.2:3b</span>
        </div>
        <div className="flex gap-2">
          <input
            ref={pullInputRef}
            value={pullInput}
            onChange={(e) => setPullInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handlePull();
            }}
            placeholder="model name"
            disabled={pulling}
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
          <button
            onClick={() => {
              void handlePull();
            }}
            disabled={pulling || !pullInput.trim()}
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {pulling ? (
              <Download size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}
            {pulling ? "Pulling…" : "Pull"}
          </button>
        </div>
        {pullError && (
          <p className={`${DS.textXs} text-red-400 mt-1 flex items-center gap-1`}>
            <AlertCircle size={12} className="shrink-0" /> {pullError}
          </p>
        )}
        {!pullError && !pulling && models.length > 0 && (
          <p className={`${DS.textXs} text-emerald-400 mt-1 flex items-center gap-1`}>
            <CheckCircle size={12} className="shrink-0" /> Ready to chat — select a model above.
          </p>
        )}
      </div>
    </div>
  );
}
