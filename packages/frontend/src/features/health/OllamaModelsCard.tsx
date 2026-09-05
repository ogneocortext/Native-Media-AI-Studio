import { useState, useCallback, useEffect } from "react";
import { Cpu, Loader2 } from "lucide-react";
import { Card } from "../../components/common";
import { getLoadedModels } from "../../services/api";
import type { DiagnosticsModelsResponse } from "../../services/api";
import { formatElapsed } from "../../utils/format";

export function OllamaModelsCard() {
  const [data, setData] = useState<DiagnosticsModelsResponse | null>(null);
  const [now, setNow] = useState(Date.now());

  const fetchData = useCallback(async () => {
    try {
      const result = await getLoadedModels();
      setData(result);
    } catch {
      setData({ loaded: false, models: [], activity: {} });
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(interval);
      clearInterval(clock);
    };
  }, [fetchData]);

  const models = data?.models || [];
  const activity = data?.activity || {};

  return (
    <Card className="ollama-card mb-6" title="Ollama Models" icon={<Cpu size={16} className="text-violet-400" />}>
      {models.length === 0 ? (
        <div className="text-center py-6">
          <Cpu size={28} className="mx-auto mb-3 opacity-30 text-violet-400" />
          <p className="text-sm text-muted">No model currently loaded in VRAM</p>
          <p className="text-xs text-muted mt-1">A model loads on first request and may persist for a while</p>
        </div>
      ) : (
        <div className="space-y-2">
          {models.map((m) => {
            const active = activity[m.name];
            const elapsed = active?.started_at ? Math.floor((now / 1000) - active.started_at) : null;
            return (
              <div
                key={m.name}
                className={`p-3 rounded-lg border ${
                  active ? "border-yellow-500/30 bg-yellow-500/5" : "border-white/5 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        active ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"
                      }`}
                    />
                    <span className="text-sm font-medium">{m.name}</span>
                  </div>
                  <span className="text-xs text-muted">{m.vram_mb}MB VRAM</span>
                </div>
                {active && (
                  <div className="mt-2 pl-4 flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin text-yellow-400" />
                    <span className="text-xs text-yellow-300 capitalize">{active.task}</span>
                    {active.description && (
                      <span className="text-xs text-muted truncate flex-1">— {active.description}</span>
                    )}
                    {elapsed != null && <span className="text-xs text-yellow-400/70 font-mono">{formatElapsed(elapsed)}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
