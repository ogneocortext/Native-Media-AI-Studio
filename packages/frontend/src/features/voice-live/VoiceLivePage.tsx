/**
 * Voice Live — speak text through the rig-local Pocket TTS engine via the
 * backend proxy at /api/voice/pocket/*.
 *
 * Session-only takes: replay uses in-memory object URLs and nothing is
 * written to output/audio in v1.
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

const POLL_MS = 2500;
const MAX_CHARS = 1000;
const MAX_CHUNK_CHARS = 300;

interface Take {
  id: number;
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
  const [health, setHealth] = useState<PocketHealth | null>(null);
  const [engineState, setEngineState] = useState<EngineState>("offline");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [voices, setVoices] = useState<PocketVoice[]>([]);
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

  useEffect(() => {
    void pollHealth();
    const id = window.setInterval(() => void pollHealth(), POLL_MS);
    return () => window.clearInterval(id);
  }, [pollHealth]);

  useEffect(() => {
    getPocketVoices()
      .then((res) => {
        setVoices(res.voices);
        setVoicesDegraded(res.degraded);
        setVoice((current) => current || res.default_voice);
      })
      .catch(() => {
        setVoicesDegraded(true);
      });
  }, []);

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
  }, []);

  const speak = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !voice || running) return;
    const chunks = splitIntoChunks(trimmed);
    if (chunks.length === 0) return;

    setRunning(true);
    setRunError(null);
    setProgress(`0/${chunks.length}`);
    const controller = new AbortController();
    abortRef.current = controller;
    const urls: string[] = [];
    let failedChunk: number | null = null;
    let failure = "";
    let completed = 0;

    try {
      for (let i = 0; i < chunks.length; i += 1) {
        if (controller.signal.aborted) break;
        setProgress(`${i + 1}/${chunks.length}`);
        const blob = await speakPocket(chunks[i], voice, controller.signal);
        urls.push(URL.createObjectURL(blob));
        completed += 1;
      }
      if (!controller.signal.aborted && urls.length > 0) {
        const played = await playUrlsSequentially(urls, controller.signal, audioRef);
        if (played) {
          takeIdRef.current += 1;
          const take: Take = {
            id: takeIdRef.current,
            voice,
            preview: trimmed.slice(0, 40),
            urls: [...urls],
          };
          setTakes((prev) => [take, ...prev]);
        }
      }
    } catch (e) {
      if (controller.signal.aborted) {
        failure = "Stopped.";
      } else {
        failedChunk = completed + 1;
        failure = e instanceof Error ? e.message : String(e);
      }
    } finally {
      if (failedChunk !== null) {
        setRunError(`Chunk ${failedChunk} failed: ${failure}`);
      } else if (failure && !controller.signal.aborted) {
        setRunError(failure);
      } else if (controller.signal.aborted) {
        setRunError("Stopped.");
      }
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [text, voice, running]);

  const replayTake = useCallback((take: Take) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    void playUrlsSequentially(take.urls, controller.signal, audioRef);
  }, []);

  const customVoices = voices.filter((v) => v.kind === "custom");
  const presetVoices = voices.filter((v) => v.kind === "preset");
  const busy = engineState === "busy";

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Mic size={20} /> Voice Live
        </h1>
        <p className="text-sm text-muted mt-1">
          Speak text through the Pocket TTS engine. Takes stay in this session only.
        </p>
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
          </div>
          {health && (
            <div className="text-xs text-muted tabular-nums">
              {health.model ?? "unknown model"} · {health.sample_rate ?? "?"} Hz
            </div>
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
          disabled={voices.length === 0}
        >
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
                  <div className="font-medium truncate">{take.voice}</div>
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
          Session-only in v1 — takes are not saved to output/audio.
        </div>
      </Card>
    </div>
  );
}
