import { useState, useCallback, useEffect, useRef } from "react";
import {
  Music,
  Play,
  Square,
  Settings,
  Sparkles,
  RefreshCw,
  Info,
  ChevronDown,
  ChevronUp,
  Zap,
} from "lucide-react";
import { getApiBase } from "../../services/api/core";
import { DS } from "../../styles/designSystem";
import { Card, StatusBadge, EmptyState, ToggleSwitch } from "../../components/common";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";

interface ServiceStatus {
  running?: boolean;
  healthy?: boolean;
  loaded?: boolean;
  model?: string;
  port?: number;
  pid?: number | null;
}

interface StatusResponse {
  services?: { ace?: ServiceStatus };
  vram?: {
    available?: boolean;
    total_mb?: number;
    used_mb?: number;
    free_mb?: number;
    percent?: number;
  };
  current_workload?: string;
}

interface ProgressResponse {
  active?: boolean;
  ratio?: number;
  desc?: string;
  output_name?: string | null;
}

const STATUS_POLL_MS = 10_000;
const PROGRESS_POLL_MS = 1_500;

const VOCAL_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "ko", label: "Korean" },
  { value: "unknown", label: "Auto-detect" },
];

const TIME_SIGNATURES = ["", "4/4", "3/4", "6/8", "2/4"];

export function MusicGenPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState("");
  const [style, setStyle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [outputName, setOutputName] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Advanced generation parameters (ACE-Step GenerationParams)
  const [audioDuration, setAudioDuration] = useState("");
  const [bpm, setBpm] = useState("");
  const [keyScale, setKeyScale] = useState("");
  const [timeSignature, setTimeSignature] = useState("");
  const [vocalLanguage, setVocalLanguage] = useState("en");
  const [inferenceSteps, setInferenceSteps] = useState("8");
  const [cfgScale, setCfgScale] = useState("7.0");
  const [seed, setSeed] = useState("");

  const api = getApiBase();
  const { refresh: refreshAudioLibrary } = useAudioLibrary();
  const generateStartedAt = useRef<number | null>(null);

  const ace = status?.services?.ace;
  const running = !!ace?.running;
  const loaded = !!ace?.loaded;
  const port = ace?.port ?? 8201;

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch(`${api}/api/music-gen/status`);
      const j = (await r.json()) as StatusResponse | null;
      setStatus(j);
      setStatusError("");
    } catch (e) {
      setStatusError(String(e));
    }
  }, [api]);

  useEffect(() => {
    void refreshStatus();
    const t = setInterval(() => void refreshStatus(), STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [refreshStatus]);

  // Elapsed-time ticker while a generation is in flight.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      if (generateStartedAt.current != null) {
        setElapsed(Math.floor((Date.now() - generateStartedAt.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Poll diffusion progress while generating.
  useEffect(() => {
    if (!busy) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`${api}/api/music-gen/progress`);
        if (r.ok && !cancelled) setProgress((await r.json()) as ProgressResponse);
      } catch {
        // Progress is best-effort; ignore transient failures.
      }
    };
    void poll();
    const t = setInterval(() => void poll(), PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [busy, api]);

  const post = async (path: string, body?: unknown): Promise<void> => {
    const r = await fetch(`${api}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { detail?: string };
      throw new Error(j.detail ?? `${path} failed (${r.status})`);
    }
    await r.json().catch(() => undefined);
  };

  const startService = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/api/music-gen/start", { engine: "ace" });
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
      await post("/api/music-gen/stop");
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const warmModel = async () => {
    setBusy(true);
    setError("");
    try {
      // /reload triggers engine.load() in the subprocess — warms weights
      // into VRAM without generating, so the first song starts faster.
      await post("/api/music-gen/reload");
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
    setElapsed(0);
    generateStartedAt.current = Date.now();
    try {
      const payload: Record<string, unknown> = {
        engine: "ace",
        style,
        lyrics: instrumental ? "" : lyrics,
        instrumental,
        output_name: outputName || undefined,
        display_name: outputName || undefined,
      };
      const dur = Number(audioDuration);
      if (audioDuration.trim() !== "" && Number.isFinite(dur)) payload.audio_duration = dur;
      const bpmNum = Number(bpm);
      if (bpm.trim() !== "" && Number.isFinite(bpmNum)) payload.bpm = Math.round(bpmNum);
      if (keyScale.trim()) payload.key_scale = keyScale.trim();
      if (timeSignature) payload.time_signature = timeSignature;
      if (vocalLanguage) payload.vocal_language = vocalLanguage;
      const steps = Number(inferenceSteps);
      if (Number.isFinite(steps) && steps >= 1) payload.inference_steps = Math.round(steps);
      const cfg = Number(cfgScale);
      if (Number.isFinite(cfg) && cfg >= 0.5) payload.cfg_scale = cfg;
      const seedNum = Number(seed);
      if (seed.trim() !== "" && Number.isInteger(seedNum)) payload.seed = seedNum;

      const r = await fetch(`${api}/api/music-gen/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json()) as { detail?: string; output_name?: string };
      if (!r.ok) throw new Error(j.detail ?? r.statusText);
      const name = j.output_name ?? outputName;
      if (name) setAudioUrl(`${api}/api/music-gen/audio/${name}`);
      // Refresh the audio library so the new track appears in all selectors.
      void refreshAudioLibrary();
      void refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      generateStartedAt.current = null;
      setBusy(false);
    }
  };

  const canGenerate =
    !busy && !!style.trim() && (instrumental || !!lyrics.trim()) && running;
  const progressPct = Math.round(Math.min(1, Math.max(0, progress?.ratio ?? 0)) * 100);
  const fmtElapsed = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

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
          onClick={() => void refreshStatus()}
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
                {running
                  ? loaded
                    ? "ACE-Step service is running — model loaded"
                    : "ACE-Step service is running — model not loaded"
                  : "ACE-Step service is offline"}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => void startService()} disabled={busy} className={DS.btnPrimary}>
                <Play size={14} />
                Start
              </button>
              <button onClick={() => void stopService()} disabled={busy} className={DS.btnSecondary}>
                <Square size={14} />
                Stop
              </button>
              {running && !loaded && (
                <button
                  onClick={() => void warmModel()}
                  disabled={busy}
                  className={DS.btnSecondary}
                  title="Load model weights into VRAM without generating"
                >
                  <Zap size={14} />
                  Load model
                </button>
              )}
            </div>
            {statusError && (
              <p className="text-xs text-amber-400 mt-3">
                Status unavailable: {statusError}
              </p>
            )}
          </Card>

          <Card title="Service Details" icon={<Info size={18} />}>
            <div className="space-y-2 text-xs text-muted">
              <div className="flex justify-between">
                <span>Engine</span>
                <span className="text-white">ACE-Step</span>
              </div>
              <div className="flex justify-between">
                <span>Port</span>
                <span className="text-white">{port}</span>
              </div>
              <div className="flex justify-between">
                <span>Model</span>
                <span className="text-white truncate max-w-[12rem]" title={ace?.model}>
                  {ace?.model ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Weights</span>
                <span className={`text-sm ${loaded ? "text-emerald-400" : "text-amber-400"}`}>
                  {loaded ? "Loaded" : running ? "Not loaded" : "Offline"}
                </span>
              </div>
              {status?.vram?.available && (
                <>
                  <div className="flex justify-between">
                    <span>VRAM free</span>
                    <span className="text-white">
                      {status.vram.free_mb?.toLocaleString()} MB /{" "}
                      {status.vram.total_mb?.toLocaleString()} MB
                    </span>
                  </div>
                  <div className="h-1.5 rounded bg-gray-700 overflow-hidden">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${100 - (status.vram.percent ?? 0)}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Generation Controls */}
        <div className="space-y-4">
          <Card title="Generate Music" icon={<Sparkles size={18} />}>
            <div className="space-y-4">
              <div>
                <label className={DS.textLabel}>Style / Caption</label>
                <textarea
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  rows={3}
                  className={`${DS.textarea} border border-gray-600`}
                  placeholder="e.g., upbeat electronic, synthwave, calm ambient..."
                />
                <p className="text-[11px] text-muted mt-1">
                  Describe genre, instruments, mood, vocal style. Don't put BPM/key here — use
                  Advanced.
                </p>
              </div>

              <div>
                <label className={`${DS.textLabel} flex items-center gap-2`}>
                  <ToggleSwitch
                    checked={instrumental}
                    onChange={() => setInstrumental((v) => !v)}
                    ariaLabel="Instrumental (no vocals)"
                  />
                  Instrumental (no vocals)
                </label>
                <textarea
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  rows={6}
                  disabled={instrumental}
                  className={`${DS.textarea} border border-gray-600 disabled:opacity-50`}
                  placeholder={
                    instrumental
                      ? "Instrumental track — lyrics not needed"
                      : "Enter lyrics with [Verse]/[Chorus] tags, or check Instrumental"
                  }
                />
              </div>

              <div>
                <label className={DS.textLabel}>Output Name (optional)</label>
                <input
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  className={`${DS.input} border border-gray-600`}
                  placeholder="my-song"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted hover:text-white"
              >
                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Advanced parameters
              </button>

              {showAdvanced && (
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-700 p-3">
                  <div>
                    <label className={DS.textLabel}>Duration (s)</label>
                    <input
                      value={audioDuration}
                      onChange={(e) => setAudioDuration(e.target.value)}
                      inputMode="numeric"
                      className={`${DS.input} border border-gray-600`}
                      placeholder="auto (10–600)"
                    />
                  </div>
                  <div>
                    <label className={DS.textLabel}>BPM</label>
                    <input
                      value={bpm}
                      onChange={(e) => setBpm(e.target.value)}
                      inputMode="numeric"
                      className={`${DS.input} border border-gray-600`}
                      placeholder="auto (30–300)"
                    />
                  </div>
                  <div>
                    <label className={DS.textLabel}>Key</label>
                    <input
                      value={keyScale}
                      onChange={(e) => setKeyScale(e.target.value)}
                      className={`${DS.input} border border-gray-600`}
                      placeholder="e.g. C Major, Am"
                    />
                  </div>
                  <div>
                    <label className={DS.textLabel}>Time sig</label>
                    <select
                      value={timeSignature}
                      onChange={(e) => setTimeSignature(e.target.value)}
                      className={`${DS.input} border border-gray-600 bg-gray-900`}
                    >
                      {TIME_SIGNATURES.map((ts) => (
                        <option key={ts} value={ts}>
                          {ts || "auto"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={DS.textLabel}>Vocal language</label>
                    <select
                      value={vocalLanguage}
                      onChange={(e) => setVocalLanguage(e.target.value)}
                      className={`${DS.input} border border-gray-600 bg-gray-900`}
                    >
                      {VOCAL_LANGUAGES.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={DS.textLabel}>Inference steps</label>
                    <input
                      value={inferenceSteps}
                      onChange={(e) => setInferenceSteps(e.target.value)}
                      inputMode="numeric"
                      className={`${DS.input} border border-gray-600`}
                      placeholder="8"
                    />
                  </div>
                  <div>
                    <label className={DS.textLabel}>Guidance (CFG)</label>
                    <input
                      value={cfgScale}
                      onChange={(e) => setCfgScale(e.target.value)}
                      inputMode="decimal"
                      className={`${DS.input} border border-gray-600`}
                      placeholder="7.0"
                    />
                  </div>
                  <div>
                    <label className={DS.textLabel}>Seed (optional)</label>
                    <input
                      value={seed}
                      onChange={(e) => setSeed(e.target.value)}
                      inputMode="numeric"
                      className={`${DS.input} border border-gray-600`}
                      placeholder="random"
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-muted">
                    Steps: 8 is the turbo default; the SFT model benefits from 30–60 for
                    higher quality at proportionally longer render times. Guidance only
                    applies to non-turbo models.
                  </p>
                </div>
              )}

              {busy && (
                <div className="rounded-lg border border-gray-700 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">
                      {progress?.active
                        ? progress.desc?.trim()
                          ? progress.desc
                          : "Generating…"
                        : loaded
                          ? "Generating…"
                          : "Loading model into VRAM (first run is slow)…"}
                    </span>
                    <span className="text-white tabular-nums">
                      {progressPct}% · {fmtElapsed}
                    </span>
                  </div>
                  <div className="h-2 rounded bg-gray-700 overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${Math.max(progressPct, 2)}%` }}
                    />
                  </div>
                </div>
              )}

              <button onClick={() => void generate()} disabled={!canGenerate} className={DS.btnFull}>
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

              {running && !loaded && !busy && (
                <p className="text-xs text-amber-400 text-center">
                  Model weights are not loaded — the first generation includes load time, or
                  click “Load model” first.
                </p>
              )}
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
              description="Enter a style and lyrics (or check Instrumental), then click Generate to create your first track."
              icon={<Music size={48} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}
