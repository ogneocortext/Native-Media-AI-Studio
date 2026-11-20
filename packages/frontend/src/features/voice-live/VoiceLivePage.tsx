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
import {
  connectLiveSession,
  floatToPcm16,
  type LiveSession,
  type LiveState,
} from "../../services/api/voice_live";

const POLL_MS = 2500;
const MAX_CHARS = 1000;
const MAX_CHUNK_CHARS = 300;

type EngineKind = "pocket" | "f5" | "live";

interface LiveLogEntry {
  who: "you" | "maya";
  text: string;
}

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
  const [liveOn, setLiveOn] = useState(false);
  const [liveState, setLiveState] = useState<LiveState>("idle");
  const [liveLog, setLiveLog] = useState<LiveLogEntry[]>([]);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const takeIdRef = useRef(0);
  const f5JobIdRef = useRef<string | null>(null);
  const takesRef = useRef<Take[]>([]);
  takesRef.current = takes;

  // Live duplex session refs
  const liveSessionRef = useRef<LiveSession | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micNodeRef = useRef<ScriptProcessorNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playNextRef = useRef(0);
  const playSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const livePrevStateRef = useRef<LiveState>("idle");

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

  // Engine status polling — only the active engine is polled. The live
  // duplex session reports its own state over the WebSocket instead.
  useEffect(() => {
    if (engine === "live") return;
    if (engine === "pocket") {
      void pollHealth();
      const id = window.setInterval(() => void pollHealth(), POLL_MS);
      return () => window.clearInterval(id);
    }
    void pollF5();
    const id = window.setInterval(() => void pollF5(), POLL_MS);
    return () => window.clearInterval(id);
  }, [engine, pollHealth, pollF5]);

  // Voice lists — loaded once per engine, cached in separate state. The live
  // session speaks replies through Pocket, so it reuses the pocket list.
  useEffect(() => {
    if (engine === "f5") {
      listF5Voices()
        .then((res) => {
          setF5Voices(res.voices);
          setVoicesDegraded(false);
          setVoice((current) => current || res.voices[0]?.voice_id || "");
        })
        .catch(() => setVoicesDegraded(true));
      return;
    }
    getPocketVoices()
      .then((res) => {
        setVoices(res.voices);
        setVoicesDegraded(res.degraded);
        setVoice((current) => current || res.default_voice);
      })
      .catch(() => setVoicesDegraded(true));
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

  // -- Live duplex session -------------------------------------------------

  const clearPlayback = useCallback(() => {
    playNextRef.current = 0;
    for (const src of playSourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    playSourcesRef.current.clear();
  }, []);

  const scheduleLiveAudio = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      const ctx = playCtxRef.current;
      if (!ctx) return;
      const buf = ctx.createBuffer(1, samples.length, sampleRate);
      const channel = new Float32Array(samples.length);
      channel.set(samples);
      buf.copyToChannel(channel, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime + 0.05, playNextRef.current);
      src.start(startAt);
      playNextRef.current = startAt + buf.duration;
      playSourcesRef.current.add(src);
      src.onended = () => {
        playSourcesRef.current.delete(src);
      };
    },
    [],
  );

  const teardownLive = useCallback(() => {
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    micNodeRef.current?.disconnect();
    micNodeRef.current = null;
    const micCtx = micCtxRef.current;
    micCtxRef.current = null;
    if (micCtx) void micCtx.close().catch(() => undefined);
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    const playCtx = playCtxRef.current;
    playCtxRef.current = null;
    if (playCtx) void playCtx.close().catch(() => undefined);
    clearPlayback();
    setLiveOn(false);
    setLiveState("idle");
    livePrevStateRef.current = "idle";
  }, [clearPlayback]);

  const startLive = useCallback(async () => {
    setRunError(null);
    setLiveLog([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;

      // Capture at 16 kHz — the backend VAD/whisper pipeline expects that rate.
      const micCtx = new AudioContext({ sampleRate: 16000 });
      micCtxRef.current = micCtx;
      const source = micCtx.createMediaStreamSource(stream);
      // ScriptProcessor is deprecated but universally supported; a 4096-sample
      // frame at 16 kHz is ~256 ms of audio per callback.
      const proc = micCtx.createScriptProcessor(4096, 1, 1);
      micNodeRef.current = proc;

      const session = connectLiveSession({
        onEvent: (event) => {
          if (event.type === "state" && event.state) {
            const next = event.state;
            // Leaving "speaking" for any reason means playback should stop —
            // this is the client half of barge-in.
            if (livePrevStateRef.current === "speaking" && next !== "speaking") {
              clearPlayback();
            }
            livePrevStateRef.current = next;
            setLiveState(next);
          } else if (event.type === "transcript" && event.text) {
            setLiveLog((prev) => [...prev, { who: "you", text: event.text ?? "" }]);
          } else if (event.type === "reply" && event.text) {
            setLiveLog((prev) => [...prev, { who: "maya", text: event.text ?? "" }]);
          } else if (event.type === "error" && event.message) {
            setRunError(event.message);
          }
        },
        onAudio: (samples, sampleRate) => scheduleLiveAudio(samples, sampleRate),
        onClose: () => {
          if (liveSessionRef.current) {
            liveSessionRef.current = null;
            setLiveOn(false);
            setLiveState("idle");
          }
        },
      });
      liveSessionRef.current = session;

      // Playback context at the device rate — WebAudio resamples the 24 kHz
      // Pocket buffers automatically.
      playCtxRef.current = new AudioContext();

      proc.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        session.sendPcm(floatToPcm16(input));
      };
      const mute = micCtx.createGain();
      mute.gain.value = 0;
      source.connect(proc);
      proc.connect(mute);
      mute.connect(micCtx.destination);

      session.start(voice || undefined);
      setLiveOn(true);
    } catch (e) {
      teardownLive();
      setRunError(e instanceof Error ? e.message : String(e));
    }
  }, [voice, clearPlayback, scheduleLiveAudio, teardownLive]);

  const stopLive = useCallback(() => {
    liveSessionRef.current?.stop();
    teardownLive();
  }, [teardownLive]);

  // Tear the session down if the page unmounts or the engine switches away.
  useEffect(() => {
    return () => teardownLive();
  }, [teardownLive]);

  useEffect(() => {
    if (engine !== "live" && liveOn) teardownLive();
  }, [engine, liveOn, teardownLive]);

  const customVoices = voices.filter((v) => v.kind === "custom");
  const presetVoices = voices.filter((v) => v.kind === "preset");
  const busy = engine === "pocket" && engineState === "busy";
  const engineLabel =
    engine === "pocket"
      ? "Pocket TTS"
      : engine === "f5"
        ? "F5-TTS (local clone)"
        : "Live duplex (talk with Maya)";

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Mic size={20} /> Voice Live
        </h1>
        <p className="text-sm text-muted mt-1">
          Speak text through {engineLabel}.{" "}
          {engine === "pocket" || engine === "live"
            ? "Takes stay in this session only."
            : "F5-TTS saves takes to output/audio (media library)."}
        </p>
      </div>

      <div className="flex gap-2">
        {(["pocket", "f5", "live"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`btn btn-sm ${engine === k ? "btn-primary" : "btn-ghost"}`}
            onClick={() => {
              setEngine(k);
              setVoice("");
              setRunError(null);
            }}
            disabled={running || liveOn}
          >
            {k === "pocket" ? "Pocket TTS" : k === "f5" ? "F5-TTS local" : "Live duplex"}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                engine === "live"
                  ? liveOn
                    ? liveState === "speaking"
                      ? "bg-sky-400"
                      : liveState === "thinking"
                        ? "bg-warning"
                        : "bg-emerald-400"
                    : "bg-muted"
                  : engineState === "ready"
                    ? "bg-emerald-400"
                    : engineState === "busy"
                      ? "bg-warning"
                      : "bg-error-text"
              }`}
            />
            <span className="text-sm font-semibold capitalize">
              {engine === "live" ? (liveOn ? liveState : "offline") : engineState}
            </span>
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
          {engine === "live" && liveOn && (
            <div className="text-xs text-muted">whisper → ollama → pocket</div>
          )}
        </div>
        {engineState === "offline" && engine !== "live" && engineError && (
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
          disabled={engine === "f5" ? f5Voices.length === 0 : voices.length === 0}
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

        {engine === "live" ? (
          <>
            <div className="text-xs text-muted">
              Talk naturally — interrupt Maya any time and she will stop and
              listen. Replies are spoken through Pocket TTS; the mic needs
              permission and works best with speakers (echo cancellation is on).
            </div>
            <div className="flex items-center gap-2">
              {!liveOn ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm inline-flex items-center gap-1"
                  onClick={() => void startLive()}
                >
                  <Mic size={14} /> Start conversation
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm inline-flex items-center gap-1"
                  onClick={stopLive}
                >
                  <Square size={14} /> End conversation
                </button>
              )}
              {liveOn && (
                <span className="text-xs text-muted capitalize">
                  {liveState === "listening" && "listening…"}
                  {liveState === "thinking" && "thinking…"}
                  {liveState === "speaking" && "speaking — talk to interrupt"}
                </span>
              )}
            </div>
            {liveLog.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-background/50 p-3 space-y-2">
                {liveLog.map((entry, i) => (
                  <div key={i} className="text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {entry.who === "you" ? "You" : "Maya"}
                    </span>
                    <div className={entry.who === "you" ? "text-foreground" : "text-sky-300"}>
                      {entry.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder={liveOn ? "…or type a message" : "Start a conversation first"}
                value={text}
                maxLength={MAX_CHARS}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && text.trim() && liveOn) {
                    liveSessionRef.current?.sendText(text.trim());
                    setLiveLog((prev) => [...prev, { who: "you", text: text.trim() }]);
                    setText("");
                  }
                }}
                disabled={!liveOn}
              />
            </div>
          </>
        ) : (
          <>
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
          </>
        )}

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
