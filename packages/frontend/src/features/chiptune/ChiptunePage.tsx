import { useState, useCallback, useEffect } from "react";
import { Cpu, Play, Eye, RefreshCw, Music, Save, Trash2 } from "lucide-react";
import { getApiBase } from "../../services/api/core";
import { DS } from "../../styles/designSystem";
import { Card, StatusBadge } from "../../components/common";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";

interface SystemInfo {
  name: string;
  label: string;
  voices: number;
}

interface RenderResult {
  system: string;
  wav?: string;
  roll?: string;
  errors?: string;
}

interface RenderResponse {
  name: string;
  preview: boolean;
  results: RenderResult[];
  errors: { system: string; error: string }[];
}

export function ChiptunePage() {
  const api = getApiBase();
  const { refresh: refreshAudioLibrary } = useAudioLibrary();

  const [systems, setSystems] = useState<SystemInfo[]>([]);
  const [pattern, setPattern] = useState("");
  const [system, setSystem] = useState("file");
  const [name, setName] = useState("chiptune-demo");
  const [transpose, setTranspose] = useState(0);
  const [tempo, setTempo] = useState("");
  const [busy, setBusy] = useState<"" | "preview" | "render">("");
  const [error, setError] = useState("");
  const [rolls, setRolls] = useState<{ system: string; url: string }[]>([]);
  const [takes, setTakes] = useState<{ system: string; url: string }[]>([]);
  const [patterns, setPatterns] = useState<{ name: string }[]>([]);
  const [loadedPattern, setLoadedPattern] = useState("");
  const [saveName, setSaveName] = useState("");

  const loadMeta = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        fetch(`${api}/api/chiptune/systems`).then((r) => r.json()),
        fetch(`${api}/api/chiptune/demo`).then((r) => r.json()),
      ]);
      setSystems(s.systems ?? []);
      setPattern(d.pattern ?? "");
      const p = await fetch(`${api}/api/chiptune/patterns`).then((r) => r.json());
      setPatterns(p.patterns ?? []);
    } catch (e) {
      setError(String(e));
    }
  }, [api]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const loadPattern = async (pname: string) => {
    if (!pname) return;
    try {
      const j = await fetch(`${api}/api/chiptune/patterns/${pname}`).then((r) => r.json());
      setPattern(j.pattern ?? "");
      setLoadedPattern(pname);
      setSaveName(pname);
    } catch (e) {
      setError(String(e));
    }
  };

  const savePattern = async () => {
    const target = saveName || loadedPattern || name;
    if (!target) return;
    try {
      const r = await fetch(`${api}/api/chiptune/patterns/${target}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail ?? r.statusText);
      setLoadedPattern(target);
      setSaveName(target);
      await loadMeta();
    } catch (e) {
      setError(String(e));
    }
  };

  const deletePattern = async () => {
    if (!loadedPattern) return;
    try {
      await fetch(`${api}/api/chiptune/patterns/${loadedPattern}`, { method: "DELETE" });
      setLoadedPattern("");
      await loadMeta();
    } catch (e) {
      setError(String(e));
    }
  };

  const submit = async (preview: boolean) => {
    setBusy(preview ? "preview" : "render");
    setError("");
    try {
      const r = await fetch(`${api}/api/chiptune/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern,
          name,
          system,
          transpose,
          tempo: tempo ? parseFloat(tempo) : null,
          preview,
        }),
      });
      const j: RenderResponse = await r.json();
      if (!r.ok) throw new Error((j as { detail?: string }).detail ?? r.statusText);
      const items = (j.results ?? []).filter((x) => x.roll || x.wav);
      if (preview) {
        setRolls(
          items.map((x) => ({
            system: x.system,
            url: `${api}/output/${(x.roll ?? "").replace(/\\/g, "/")}`,
          })),
        );
      } else {
        setTakes(
          items
            .filter((x) => x.wav)
            .map((x) => ({
              system: x.system,
              url: `${api}/output/${(x.wav ?? "").replace(/\\/g, "/")}`,
            })),
        );
        void refreshAudioLibrary();
      }
      if (j.errors?.length) {
        setError(j.errors.map((e) => `${e.system}: ${e.error}`).join("; "));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={DS.page}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={DS.pageTitle}>
            <Cpu size={24} className="text-accent" />
            Chiptune
          </h1>
          <p className={DS.pageSubtitle}>
            Tracker-pattern chip music — preview the roll before you listen (T-MUS-06)
          </p>
        </div>
        <button onClick={loadMeta} disabled={!!busy} className="btn btn-ghost" title="Reload">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Pattern (.chip)" icon={<Music size={18} />}>
          <div className="flex gap-2 mb-2">
            <select
              value={loadedPattern}
              onChange={(e) => loadPattern(e.target.value)}
              className={`${DS.input} border border-gray-600 flex-1`}
            >
              <option value="">— saved patterns —</option>
              {patterns.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="save as"
              className={`${DS.input} border border-gray-600 w-32`}
            />
            <button onClick={savePattern} className={DS.btnSecondary} title="Save pattern">
              <Save size={14} />
            </button>
            {loadedPattern && (
              <button onClick={deletePattern} className={DS.btnSecondary} title="Delete pattern">
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <textarea
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            rows={18}
            className={`${DS.textarea} border border-gray-600 font-mono text-xs`}
            placeholder="system nes&#10;tempo 150&#10;lead: C-4 . E-4 . G-4 ..."
          />
        </Card>

        <div className="space-y-4">
          <Card title="Render Settings" icon={<Cpu size={18} />}>
            <div className="space-y-3">
              <div>
                <label className={DS.textLabel}>System</label>
                <select
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  className={`${DS.input} border border-gray-600`}
                >
                  <option value="file">Pattern's own system</option>
                  <option value="all">All systems (A/B)</option>
                  {systems.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} — {s.label} ({s.voices} voices)
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={DS.textLabel}>Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={`${DS.input} border border-gray-600`}
                  />
                </div>
                <div>
                  <label className={DS.textLabel}>Transpose</label>
                  <input
                    type="number"
                    value={transpose}
                    onChange={(e) => setTranspose(parseInt(e.target.value) || 0)}
                    className={`${DS.input} border border-gray-600`}
                  />
                </div>
                <div>
                  <label className={DS.textLabel}>Tempo</label>
                  <input
                    type="number"
                    value={tempo}
                    onChange={(e) => setTempo(e.target.value)}
                    placeholder="file"
                    className={`${DS.input} border border-gray-600`}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => submit(true)}
                  disabled={!!busy || !pattern.trim()}
                  className={DS.btnSecondary}
                >
                  <Eye size={14} />
                  {busy === "preview" ? "Rolling..." : "Preview Roll"}
                </button>
                <button
                  onClick={() => submit(false)}
                  disabled={!!busy || !pattern.trim()}
                  className={DS.btnPrimary}
                >
                  <Play size={14} />
                  {busy === "render" ? "Rendering..." : "Render Audio"}
                </button>
              </div>
              {error && (
                <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-3 text-xs">
                  {error}
                </div>
              )}
            </div>
          </Card>

          {rolls.length > 0 && (
            <Card title="Piano Roll (preview first)" icon={<Eye size={18} />}>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {rolls.map((r) => (
                  <div key={r.system}>
                    <div className="text-xs text-muted mb-1 flex items-center gap-2">
                      <StatusBadge status="online" />
                      {r.system}
                    </div>
                    <img src={r.url} alt={`roll ${r.system}`} className="w-full rounded border border-gray-700" />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {takes.length > 0 && (
            <Card title="Renders" icon={<Music size={18} />}>
              <div className="space-y-3">
                {takes.map((t) => (
                  <div key={t.system}>
                    <div className="text-xs text-muted mb-1">{t.system}</div>
                    <audio controls src={t.url} className="w-full" />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
