/**
 * Voice Live — speak text through the rig's TTS engines.
 *
 * Two backends share this page:
 *  - "pocket": streaming proxy at /api/voice/pocket/* (session-only takes,
 *    nothing written to output/audio).
 *  - "f5": local F5-TTS clone via /api/voice/* (job-based; output WAVs are
 *    saved to output/audio and appear in the media library).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Play, AlertTriangle } from "lucide-react";
import { Card } from "../../components/common";
import {
  getPocketHealth,
  getPocketVoices,
  speakPocket,
  type PocketHealth,
  type PocketVoice,
} from "../../services/api/voice_pocket";
import {
  getF5Status,
  listF5Voices,
  synthesizeF5,
  waitForJob,
  cancelJob,
  audioFileUrl,
  type F5Status,
  type F5VoiceProfile,
} from "../../services/api/voice_f5";

const POLL_MS = 2500;
const MAX_CHARS = 1000;
const MAX_CHUNK_CHARS = 300;

type EngineKind = "pocket" | "f5";

interface Take {
  id: number;
  engine: EngineKind;
  voice: string;
  preview: string;
  urls: string[];
}

type EngineState = "ready" | "busy" | "offline";

/** Split at sentence boundaries into chunks of <= MAX_CHUNK_CHARS. */
function splitIntoChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };
  for (const raw of sentences) {
    let piece = raw.trim();
    if (!piece) continue;
    while (piece.length > MAX_CHUNK_CHARS) {
      if (current) flush();
      let cut = piece.lastIndexOf(" ", MAX_CHUNK_CHARS);
      if (cut < MAX_CHUNK_CHARS / 2) cut = MAX_CHUNK_CHARS;
      chunks.push(piece.slice(0, cut).trim());
      piece = piece.slice(cut).trim();
    }
    if (!piece) continue;
    const joined = current ? `${current} ${piece}` : piece;
    if (joined.length <= MAX_CHUNK_CHARS) {
      current = joined;
    } else {
      flush();
      current = piece;
    }
  }
  flush();
  return chunks;
}

/** Play blob URLs back-to-back through one Audio element at a time.
 *  Resolves true when every URL played, false when aborted. */
async function playUrlsSequentially(
  urls: string[],
  signal: AbortSignal,
  audioRef: { current: HTMLAudioElement | null },
): Promise<boolean> {
  return new Promise((resolve) => {
    let index = 0;
    const playNext = () => {
      if (signal.aborted || index >= urls.length) {
        return resolve(!signal.aborted && index >= urls.length);
      }
      const audio = new Audio(urls[index]);
      index += 1;
      audioRef.current = audio;
      const done = () => {
        audio.onended = null;
        audio.onerror = null;
        playNext();
      };
      audio.onended = done;
      audio.onerror = done;
      void audio.play().catch(done);
    };
    playNext();
  });
}

export function VoiceLivePage() {
  const [engine, setEngine] = useState<EngineKind>("pocket");
  const [health, setHealth] = useState<PocketHealth | null>(null);
  const [f5Status, setF5Status] = useState<F5Status | null>(null);
  const [engineState, setEngineState] = useState<EngineState>("offline");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [voices, setVoices] = useState<PocketVoice[]>([]);
  const [f5Voices, setF5Voices] = useState<F5VoiceProfile[]>([]);
  const [voicesDegraded, setVoicesDegraded] = useState(false);
  const [voice, setVoice] = useState("");
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const takeIdRef = useRef(0);
  const f5JobIdRef = useRef<string | null>(null);
  const takesRef = useRef<Take[]>([]);
  takesRef.current = takes;

  const pollHealth = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const h = await getPocketHealth();
      setHealth(h);
      setEngineState(h.busy ? "busy" : "ready");
      setEngineError(null);
    } catch (e) {
      setHealth(null);
      setEngineState("offline");
      setEngineError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const pollF5 = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const s = await getF5Status();
      setF5Status(s);
      setEngineState(s.installed ? "ready" : "offline");
      setEngineError(s.installed ? null : s.message ?? "F5-TTS is not installed.");
    } catch (e) {
      setF5Status(null);
      setEngineState("offline");
      setEngineError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // Engine status polling — only the active engine is polled.
  useEffect(() => {
    if (engine === "pocket") {
      void pollHealth();
      const id = window.setInterval(() => void pollHealth(), POLL_MS);
      return () => window.clearInterval(id);
    }
    void pollF5();
    const id = window.setInterval(() => void pollF5(), POLL_MS);
    return () => window.clearInterval(id);
  }, [engine, pollHealth, pollF5]);

  // Voice lists — loaded once per engine, cached in separate state.
  useEffect(() => {
    if (engine === "pocket") {
      getPocketVoices()
        .then((res) => {
          setVoices(res.voices);
          setVoicesDegraded(res.degraded);
          setVoice((current) => current || res.default_voice);
        })
        .catch(() => setVoicesDegraded(true));
    } else {
      listF5Voices()
        .then((res) => {
          setF5Voices(res.voices);
          setVoicesDegraded(false);
          setVoice((current) => current || res.voices[0]?.voice_id || "");
        })
        .catch(() => setVoicesDegraded(true));
    }
  }, [engine]);

  // Session-only takes: revoke object URLs when the page unmounts.
  useEffect(() => {
    return () => {
      for (const take of takesRef.current) {
        for (const url of take.urls) URL.revokeObjectURL(url);
      }
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    audioRef.current?.pause();
    const jobId = f5JobIdRef.current;
    if (jobId) {
      f5JobIdRef.current = null;
      void cancelJob(jobId).catch(() => undefined);
    }
  }, []);

  const speakPocketRun = useCallback(
    async (trimmed: string, voiceId: string, controller: AbortController, urls: string[]) => {
      const chunks = splitIntoChunks(trimmed);
      let completed = 0;
      for (let i = 0; i < chunks.length; i += 1) {
        if (controller.signal.aborted) break;
        setProgress(`${i + 1}/${chunks.length}`);
        let blob: Blob;
        try {
          blob = await speakPocket(chunks[i], voiceId, controller.signal);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Chunk ${i + 1} failed: ${msg}`, { cause: e });
        }
        urls.push(URL.createObjectURL(blob));
        completed += 1;
      }
      return completed;
    },
    [],
  );

  const speakF5Run = useCallback(
    async (trimmed: string, voiceId: string, controller: AbortController, urls: string[]) => {
      const res = await synthesizeF5(trimmed, voiceId);
      if (!res.job_id) throw new Error(res.error ?? res.message ?? "F5-TTS submit failed");
      f5JobIdRef.current = res.job_id;
      try {
        const job = await waitForJob(res.job_id, controller.signal, (j) => {
          setProgress(`${Math.round(j.progress)}%`);
        });
        // The submit response carries output_path; the job row sometimes
        // leaves it null, so prefer the submit value.
        const outPath = res.output_path ?? job.output_path;
        if (!outPath) throw new Error("F5-TTS finished but produced no output file");
        const audioUrl = audioFileUrl(outPath);
        const resp = await fetch(audioUrl, { signal: controller.signal });
        if (!resp.ok) throw new Error(`Audio fetch failed (HTTP ${resp.status})`);
        const blob = await resp.blob();
        urls.push(URL.createObjectURL(blob));
        return 1;
      } finally {
        f5JobIdRef.current = null;
      }
    },
    [],
  );

  const speak = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !voice || running) return;

    setRunning(true);
    setRunError(null);
    setProgress(engine === "f5" ? "queued" : "0/?");
    const controller = new AbortController();
    abortRef.current = controller;
    const urls: string[] = [];
    let failure = "";
    let playedAll = false;

    try {
      if (engine === "f5") {
        await speakF5Run(trimmed, voice, controller, urls);
      } else {
        await speakPocketRun(trimmed, voice, controller, urls);
      }
      if (!controller.signal.aborted && urls.length > 0) {
        playedAll = await playUrlsSequentially(urls, controller.signal, audioRef);
      }
      if (playedAll) {
        takeIdRef.current += 1;
        const take: Take = {
          id: takeIdRef.current,
          engine,
          voice,
          preview: trimmed.slice(0, 40),
          urls: [...urls],
        };
        setTakes((prev) => [take, ...prev]);
      }
    } catch (e) {
      failure = controller.signal.aborted
        ? "Stopped."
        : e instanceof Error
          ? e.message
          : String(e);
    } finally {
      if (failure) setRunError(failure);
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [text, voice, running, engine, speakPocketRun, speakF5Run]);

  const replayTake = useCallback((take: Take) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    void playUrlsSequentially(take.urls, controller.signal, audioRef);
  }, []);

  const customVoices = voices.filter((v) => v.kind === "custom");
  const presetVoices = voices.filter((v) => v.kind === "preset");
  const busy = engine === "pocket" && engineState === "busy";
  const engineLabel = engine === "pocket" ? "Pocket TTS" : "F5-TTS (local clone)";

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Mic size={20} /> Voice Live
        </h1>
        <p className="text-sm text-muted mt-1">
          Speak text through {engineLabel}.{" "}
          {engine === "pocket"
            ? "Takes stay in this session only."
            : "F5-TTS saves takes to output/audio (media library)."}
        </p>
      </div>

      <div className="flex gap-2">
        {(["pocket", "f5"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`btn btn-sm ${engine === k ? "btn-primary" : "btn-ghost"}`}
            onClick={() => {
              setEngine(k);
              setVoice("");
              setRunError(null);
            }}
            disabled={running}
          >
            {k === "pocket" ? "Pocket TTS" : "F5-TTS local"}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                engineState === "ready"
                  ? "bg-emerald-400"
                  : engineState === "busy"
                    ? "bg-warning"
                    : "bg-error-text"
              }`}
            />
            <span className="text-sm font-semibold capitalize">{engineState}</span>
            <span className="text-xs text-muted">{engineLabel}</span>
          </div>
          {engine === "pocket" && health && (
            <div className="text-xs text-muted tabular-nums">
              {health.model ?? "unknown model"} · {health.sample_rate ?? "?"} Hz
            </div>
          )}
          {engine === "f5" && f5Status?.installed && (
            <div className="text-xs text-muted">F5-TTS venv ready</div>
          )}
        </div>
        {engineState === "offline" && engineError && (
          <div className="mt-2 text-xs text-muted">{engineError}</div>
        )}
        {voicesDegraded && (
          <div className="mt-2 text-xs text-warning flex items-center gap-1">
            <AlertTriangle size={12} /> Voice list is degraded (engine unreachable).
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <label className="block text-sm font-medium" htmlFor="voice-live-voice">
          Voice
        </label>
        <select
          id="voice-live-voice"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          disabled={engine === "pocket" ? voices.length === 0 : f5Voices.length === 0}
        >
          {engine === "f5" ? (
            f5Voices.map((v) => (
              <option key={v.voice_id} value={v.voice_id}>
                {v.name ?? v.voice_id}
              </option>
            ))
          ) : (
            <>
              {customVoices.length > 0 && (
                <optgroup label="Custom voices">
                  {customVoices.map((v) => (
                    <option key={`c-${v.name}`} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {presetVoices.length > 0 && (
                <optgroup label="Preset voices">
                  {presetVoices.map((v) => (
                    <option key={`p-${v.name}`} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </>
          )}
        </select>

        <label className="block text-sm font-medium" htmlFor="voice-live-text">
          Text
        </label>
        <textarea
          id="voice-live-text"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[140px]"
          value={text}
          maxLength={MAX_CHARS}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type what Maya should say…"
        />
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{text.length}/{MAX_CHARS}</span>
          {progress && <span className="tabular-nums">Chunk {progress}</span>}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm inline-flex items-center gap-1"
            onClick={() => void speak()}
            disabled={running || busy || !text.trim() || !voice}
          >
            <Play size={14} /> Speak
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm inline-flex items-center gap-1"
            onClick={stop}
            disabled={!running}
          >
            <Square size={14} /> Stop
          </button>
          {busy && !running && (
            <span className="text-xs text-warning">Engine busy — Speak is disabled.</span>
          )}
        </div>

        {runError && (
          <div className="text-xs text-error-text flex items-center gap-1">
            <AlertTriangle size={12} /> {runError}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">Takes this session</div>
        {takes.length === 0 ? (
          <div className="text-xs text-muted">No takes yet.</div>
        ) : (
          <ul className="space-y-2">
            {takes.map((take) => (
              <li
                key={take.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {take.voice}
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">
                      {take.engine}
                    </span>
                  </div>
                  <div className="text-xs text-muted truncate">{take.preview}…</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm inline-flex items-center gap-1 shrink-0"
                  onClick={() => replayTake(take)}
                >
                  <Play size={14} /> Replay
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 text-[11px] text-muted">
          {engine === "pocket"
            ? "Pocket takes are session-only — not saved to output/audio. F5-TTS takes are saved there and appear in the media library."
            : "F5-TTS output WAVs are saved to output/audio and appear in the media library."}
        </div>
      </Card>
    </div>
  );
}
