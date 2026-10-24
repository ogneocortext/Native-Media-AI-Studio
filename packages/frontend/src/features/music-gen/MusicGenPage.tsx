import { useState, useCallback, useEffect } from "react";
import { Music, Play, Square, Settings, Sparkles, RefreshCw } from "lucide-react";
import { getApiBase } from "../../services/api/core";
import { DS } from "../../styles/designSystem";
import { Card, StatusBadge, EmptyState } from "../../components/common";

export function MusicGenPage() {
  const [status, setStatus] = useState<string>("Loading status...");
  const [running, setRunning] = useState(false);
  const [style, setStyle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [outputName, setOutputName] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const api = getApiBase();

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch(`${api}/api/music-gen/status`);
      const j = await r.json();
      setStatus(JSON.stringify(j, null, 2));
      setRunning(!!j?.services?.ace?.running);
    } catch (e) {
      setError(String(e));
      setStatus("Status unavailable");
      setRunning(false);
    }
  }, [api]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const startService = async () => {
    setBusy(true);
    setError("");
    try {
      await fetch(`${api}/api/music-gen/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: "ace" }),
      });
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const stopService = async () => {
    setBusy(true);
    setError("");
    try {
      await fetch(`${api}/api/music-gen/stop`, { method: "POST" });
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError("");
    setAudioUrl("");
    try {
      const r = await fetch(`${api}/api/music-gen/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine: "ace",
          style,
          lyrics,
          output_name: outputName || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || r.statusText);
      const name = j.output_name || outputName;
      if (name) setAudioUrl(`${api}/api/music-gen/audio/${name}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={DS.page}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={DS.pageTitle}>
            <Music size={24} className="text-accent" />
            Music Generation
          </h1>
          <p className={DS.pageSubtitle}>Generate music with ACE-Step engine</p>
        </div>
        <button
          onClick={refreshStatus}
          disabled={busy}
          className="btn btn-ghost"
          title="Refresh status"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service Control */}
        <div className="space-y-4">
          <Card title="Service Status" icon={<Settings size={18} />}>
            <div className="flex items-center gap-3 mb-4">
              <StatusBadge status={running ? "online" : "offline"} />
              <span className="text-sm text-muted">
                {running ? "ACE-Step service is running" : "ACE-Step service is offline"}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={startService}
                disabled={busy}
                className={DS.btnSecondary}
              >
                <Play size={14} />
                Start
              </button>
              <button
                onClick={stopService}
                disabled={busy}
                className={DS.btnSecondary}
              >
                <Square size={14} />
                Stop
              </button>
            </div>
          </Card>

          <Card title="Service Details" icon={<Settings size={18} />}>
            <pre className="bg-gray-900 text-emerald-400 p-3 rounded-lg text-xs overflow-auto max-h-48">
              {status}
            </pre>
          </Card>
        </div>

        {/* Generation Controls */}
        <div className="space-y-4">
          <Card title="Generate Music" icon={<Sparkles size={18} />}>
            <div className="space-y-4">
              <div>
                <label className={DS.textLabel}>Style</label>
                <textarea
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  rows={3}
                  className={DS.textarea}
                  placeholder="e.g., upbeat electronic, synthwave, calm ambient..."
                />
              </div>

              <div>
                <label className={DS.textLabel}>Lyrics</label>
                <textarea
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  rows={6}
                  className={DS.textarea}
                  placeholder="Enter lyrics or leave empty for instrumental..."
                />
              </div>

              <div>
                <label className={DS.textLabel}>Output Name (optional)</label>
                <input
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  className={DS.input}
                  placeholder="my-song"
                />
              </div>

              <button
                onClick={generate}
                disabled={busy || !style || !lyrics || !running}
                className={DS.btnFull}
              >
                {busy ? (
                  <>
                    <Settings size={16} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Generate Music
                  </>
                )}
              </button>

              {!running && (
                <p className="text-xs text-amber-400 text-center">
                  Start the service first to generate music.
                </p>
              )}

              {error && (
                <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-3 text-xs">
                  {error}
                </div>
              )}
            </div>
          </Card>

          {audioUrl && (
            <Card title="Result" icon={<Music size={18} />}>
              <audio controls src={audioUrl} className="w-full" />
            </Card>
          )}

          {!audioUrl && !busy && !error && (
            <EmptyState
              title="No music generated yet"
              description="Enter a style and lyrics, then click Generate to create your first track."
              icon={<Music size={48} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}
