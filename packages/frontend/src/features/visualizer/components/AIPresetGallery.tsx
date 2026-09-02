import { useEffect, useState, useCallback } from "react";
import { Sparkles, Trash2, Play, Search, Clock, Heart, Layers, Copy, Download } from "lucide-react";
import type { VisualPreset } from "../visualPreset";
import { showToast } from "../../../utils/toast";

interface SavedPreset {
  id: string;
  track_name: string;
  track_hash: string;
  preset_name: string;
  visualization_style: string;
  params: Record<string, unknown>;
  ollama_model: string;
  prompt: string;
  bpm: number;
  energy_level: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

interface AIPresetGalleryProps {
  onApplyPreset: (preset: VisualPreset) => void;
  refreshKey?: number;
}

export function AIPresetGallery({ onApplyPreset, refreshKey }: AIPresetGalleryProps) {
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStyle, setFilterStyle] = useState<string>("all");

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    try {
      // Primary: legacy endpoint (proven stable, now persisted)
      const res = await fetch("/api/integrations/visualization-presets");
      if (res.ok) {
        const data = await res.json();
        if (data.presets?.length) { setPresets(data.presets); return; }
      }
      // Fallback: new visualizer presets endpoint
      const res2 = await fetch("/api/integrations/ollama/visualizer/presets", { signal: AbortSignal.timeout(5000) }).catch(()=>null);
      if (res2?.ok) {
        const data2 = await res2.json();
        setPresets(data2.presets || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPresets(); }, [fetchPresets, refreshKey]);

  const handleApply = useCallback((p: SavedPreset) => {
    const preset = p.params as unknown as VisualPreset;
    // ensure minimal validity
    if (!preset.theme || !preset.visualizer) {
      showToast("Invalid preset data", "warning");
      return;
    }
    onApplyPreset(preset);
    // bump usage count
    fetch(`/api/integrations/ollama/visualizer/preset/${p.track_hash}`).catch(() => {});
    showToast(`Applied "${p.preset_name}"`, "success");
  }, [onApplyPreset]);

  const handleDelete = useCallback(async (p: SavedPreset) => {
    if (!confirm(`Delete "${p.preset_name}"?`)) return;
    try {
      const res = await fetch(`/api/integrations/ollama/visualizer/preset/${p.id}`, { method: "DELETE" });
      if (res.ok) {
        setPresets(prev => prev.filter(x => x.id !== p.id));
        showToast("Preset deleted", "info");
      } else {
        showToast("Delete not yet implemented on server", "warning");
      }
    } catch { showToast("Delete failed", "warning"); }
  }, []);

  const handleCopy = useCallback(async (p: SavedPreset) => {
    const text = JSON.stringify(p.params, null, 2);
    await navigator.clipboard.writeText(text);
    showToast("JSON copied", "success");
  }, []);

  const handleExport = useCallback((p: SavedPreset) => {
    const blob = new Blob([JSON.stringify(p.params, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.preset_name.replace(/\s+/g, "_")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const styles = Array.from(new Set(presets.map(p => p.visualization_style).filter(Boolean)));
  const filtered = presets.filter(p => {
    if (filterStyle !== "all" && p.visualization_style !== filterStyle) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.preset_name.toLowerCase().includes(q) || p.prompt.toLowerCase().includes(q) || p.track_name.toLowerCase().includes(q);
    }
    return true;
  });

  if (loading) return <div className="viz-gallery-loading">Loading presets...</div>;
  if (presets.length === 0) return (
    <div className="viz-gallery-empty">
      <Sparkles size={24} className="opacity-30" />
      <p>No AI presets yet</p>
      <span>Generate one from the AI panel — it will appear here and survive restarts</span>
    </div>
  );

  return (
    <div className="viz-gallery">
      <div className="viz-gallery-header">
        <div className="viz-gallery-title">
          <Layers size={14} />
          <span>Saved AI Presets</span>
          <span className="viz-gallery-count">{filtered.length}/{presets.length}</span>
        </div>
        <div className="viz-gallery-controls">
          <div className="viz-gallery-search">
            <Search size={12} />
            <input placeholder="Search name/prompt..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select value={filterStyle} onChange={e => setFilterStyle(e.target.value)} className="viz-gallery-filter">
            <option value="all">All styles</option>
            {styles.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="viz-gallery-grid">
        {filtered.map(p => {
          const preset = p.params as any;
          const theme = preset.theme || {};
          return (
            <div key={p.id} className="viz-gallery-card" style={{ borderLeftColor: theme.primary || "#6366f1" }}>
              <div className="viz-gallery-card-top">
                <div className="viz-gallery-card-colors">
                  {["primary","secondary","accent","background"].map(k => theme[k] ? <span key={k} title={k} style={{ background: theme[k] }} /> : null)}
                </div>
                <span className="viz-gallery-card-style">{p.visualization_style}</span>
              </div>
              <div className="viz-gallery-card-name">{p.preset_name}</div>
              <div className="viz-gallery-card-prompt" title={p.prompt}>{p.prompt.slice(0, 80)}{p.prompt.length > 80 ? "..." : ""}</div>
              <div className="viz-gallery-card-meta">
                <span title="BPM"><Clock size={10}/> {p.bpm} BPM</span>
                <span>{p.energy_level}</span>
                <span title="Uses"><Heart size={10}/> {p.usage_count}</span>
                <span>{new Date(p.created_at).toLocaleDateString()}</span>
                <span className="viz-gallery-card-model">{p.ollama_model}</span>
              </div>
              <div className="viz-gallery-card-actions">
                <button className="viz-gallery-apply" onClick={() => handleApply(p)}><Play size={12}/> Apply</button>
                <button className="viz-gallery-icon" onClick={() => handleCopy(p)} title="Copy JSON"><Copy size={12}/></button>
                <button className="viz-gallery-icon" onClick={() => handleExport(p)} title="Download JSON"><Download size={12}/></button>
                <button className="viz-gallery-icon danger" onClick={() => handleDelete(p)} title="Delete"><Trash2 size={12}/></button>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && <div className="viz-gallery-no-match">No matches</div>}
    </div>
  );
}
