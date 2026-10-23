import { useState, useCallback } from "react";
import { getApiBase } from "../../services/api/core";

export function MusicGenPage() {
  const [status, setStatus] = useState<string>("");
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
    } catch (e) {
      setError(String(e));
    }
  }, [api]);

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
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>Music Generation (ACE-Step)</h1>
      <section style={{ marginBottom: 16 }}>
        <button onClick={refreshStatus} disabled={busy}>Refresh status</button>{" "}
        <button onClick={startService} disabled={busy}>Start service</button>{" "}
        <button onClick={stopService} disabled={busy}>Stop service</button>
      </section>
      <pre style={{ background: "#111", color: "#0f0", padding: 12, maxHeight: 200, overflow: "auto" }}>
        {status || "(no status yet)"}
      </pre>
      <section style={{ marginTop: 24 }}>
        <h2>Generate</h2>
        <label>Style</label>
        <textarea value={style} onChange={(e) => setStyle(e.target.value)} rows={3} style={{ width: "100%" }} />
        <label>Lyrics</label>
        <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={6} style={{ width: "100%" }} />
        <label>Output name (optional)</label>
        <input value={outputName} onChange={(e) => setOutputName(e.target.value)} style={{ width: "100%" }} />
        <div style={{ marginTop: 8 }}>
          <button onClick={generate} disabled={busy || !style || !lyrics}>Generate</button>
        </div>
        {error && <p style={{ color: "red" }}>{error}</p>}
        {audioUrl && (
          <div style={{ marginTop: 12 }}>
            <audio controls src={audioUrl} />
          </div>
        )}
      </section>
    </div>
  );
}
