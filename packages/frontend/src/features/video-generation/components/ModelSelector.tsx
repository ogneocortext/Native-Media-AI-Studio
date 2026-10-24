import { ChangeEvent, useState } from "react";
import { Loader2, Radio } from "lucide-react";
import { DS } from "../../../styles/designSystem";

export interface VideoModel {
  name: string;
  description: string;
  type: string;
  bestFor: string;
  variant?: string;
  size_mb?: number;
  path?: string;
  supports_8gb?: boolean;
  requires_cpu_offload?: boolean;
  vram_mb?: number;
}

interface ModelSelectorProps {
  models: VideoModel[];
  loading: boolean;
  status: "unknown" | "online" | "offline";
  selected: string;
  onChange: (name: string) => void;
  onQueryChange?: (query: string) => void;
}

export function ModelSelector({
  models,
  loading,
  status,
  selected,
  onChange,
  onQueryChange,
}: ModelSelectorProps) {
  const [query, setQuery] = useState("");

  const filtered = models.filter((m) =>
    m.name.toLowerCase().includes(query.toLowerCase())
  );

  const handleQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    onQueryChange?.(e.target.value);
  };

  return (
    <div className={`${DS.card} border-primary/30`} style={{ padding: 16 }}>
      <div className="flex items-center gap-2 mb-3">
        <Radio size={16} />
        <h3 className="text-sm font-semibold text-white">Model</h3>
      </div>

      {status === "offline" && (
        <div className="mb-3 p-2 bg-yellow-900/30 border border-yellow-700 rounded text-xs text-yellow-300">
          ComfyUI offline — cannot generate
        </div>
      )}

      {loading && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted">
          <Loader2 className="animate-spin" />
          Loading models...
        </div>
      )}

      <input
        type="text"
        placeholder="Search models..."
        value={query}
        onChange={handleQueryChange}
        className={`${DS.input} mb-2 w-full`}
      />

      <div className="max-h-48 overflow-y-auto space-y-1">
        {filtered.map((model) => (
          <button
            key={model.name}
            onClick={() => onChange(model.name)}
            className={`w-full text-left p-2 rounded ${
              selected === model.name
                ? "bg-primary/20 border border-primary/40"
                : "bg-black/30 hover:bg-black/50 border border-transparent"
            }`}
          >
            <div className="text-sm font-medium text-white">{model.name}</div>
            <div className="text-xs text-muted truncate">{model.description}</div>
            <div className="text-xs text-muted">{model.type}</div>
          </button>
        ))}
        {filtered.length === 0 && !loading && (
          <div className="text-xs text-muted p-2">No models found</div>
        )}
      </div>
    </div>
  );
}
