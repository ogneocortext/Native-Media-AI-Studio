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
import { Mic, Square, Play, AlertTriangle, FileAudio } from "lucide-react";
import { Card } from "../../components/common";
import {
  getInboxAudioPending,
  getInboxPending,
  getPocketHealth,
  getPocketVoices,
  inboxAudioFileUrl,
  markInboxAudioPlayed,
  markInboxPlayed,
  speakPocket,
  type InboxAudioEntry,
  type InboxEntry,
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
import {
  usePresenceRoster,
  presenceStatusFor,
} from "../presence/usePresenceRoster";

const POLL_MS = 2500;
const INBOX_POLL_MS = 2000;
const INBOX_MAX_FAILS = 3;
const MAX_CHARS = 1000;
const MAX_CHUNK_CHARS = 300;

type EngineKind = "pocket" | "f5" | "live";

const MAYA_VIOLET = "#6A4C98";

/** Maya's presence pill — same roster the app-shell chips read, so this
 *  page and the topbar can never disagree about whether she is working. */
function MayaPresencePill() {
  const roster = usePresenceRoster();
  const maya = roster?.people.find((p) => p.id === "maya" || p.name === "Maya");
  if (!maya) return null;
  const working = presenceStatusFor(maya) === "working";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs text-foreground"
      title={`Maya · ${maya.sublabel ?? maya.role}`}
    >
      <span className="relative flex h-2 w-2">
        {working && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: MAYA_VIOLET }}
          />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{ backgroundColor: MAYA_VIOLET }}
        />
      </span>
      {working ? "Maya · Working" : "Maya · Idle, here when idle"}
    </span>
  );
}

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
  /** Pocket takes keep the raw PCM blobs -- HTMLAudioElement cannot play
   *  the object URLs, so replay decodes them through an AudioContext. */
  pcmBlobs?: Blob[];
}

interface InboxLine {
  id: string;
  kind: "text" | "audio";
  /** Human display text (audio drops get a cleaned-up name). */
  text: string;
  /** Raw stored filename for audio drops — shown in the row tooltip. */
  rawName?: string;
  voice: string;
  at: string;
  /** Playback state: flips to "played" only after real playback ends. */
  state: "waiting" | "played";
}

/** Display name for an audio drop: <id>_prefix and extension off,
 *  leading maya-, trailing -YYYY-MM-DD off, hyphens to spaces,
 *  first letter capitalized. e.g. 4a4c02c7_maya-keep-talking-2026-11-24.wav
 *  -> "Keep talking". */
function inboxAudioDisplayName(stored: string): string {
  let s = stored;
  const us = s.indexOf("_");
  if (us > 0) s = s.slice(us + 1);
  s = s.replace(/\.[a-z0-9]+$/i, "");
  s = s.replace(/^maya-/i, "");
  s = s.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  s = s.replace(/-/g, " ").trim();
  if (!s) return stored;
  return s.charAt(0).toUpperCase() + s.slice(1);
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

// Pocket /speech returns raw PCM s16le mono (X-Audio-Format: pcm_s16le_mono,
// 24 kHz) -- not a container format, so HTMLAudioElement cannot decode it.
// PCM must go through an AudioContext as float buffers, the same way the
// live-duplex replies are played (scheduleLiveAudio).
const POCKET_SAMPLE_RATE = 24000;

/** Decode one PCM blob and play it to completion through an AudioContext.
 *  Resolves true only when the source reached onended; false on abort,
 *  decode failure, or a start() error. */
async function playPcmBlob(
  blob: Blob,
  ctx: AudioContext,
  signal: AbortSignal,
): Promise<boolean> {
  const bytes = await blob.arrayBuffer();
  const pcm = new Int16Array(bytes, 0, bytes.byteLength >> 1);
  const float = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    float[i] = pcm[i] / 0x8000;
  }
  const audioBuf = ctx.createBuffer(1, float.length, POCKET_SAMPLE_RATE);
  audioBuf.copyToChannel(float, 0);
  return new Promise<boolean>((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* already stopped */
      }
      resolve(ok);
    };
    const onAbort = () => finish(false);
    src.onended = () => finish(true);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      src.start();
    } catch {
      finish(false);
    }
  });
}

/** Play PCM blobs back-to-back. Resolves true only when every blob played
 *  to completion -- a decode/play failure resolves false so callers can
 *  retry instead of losing the line. */
async function playPcmSequentially(
  blobs: Blob[],
  ctx: AudioContext,
  signal: AbortSignal,
): Promise<boolean> {
  for (const blob of blobs) {
    if (signal.aborted) return false;
    const ok = await playPcmBlob(blob, ctx, signal);
    if (!ok) return false;
  }
  return !signal.aborted;
}

/** Fetch an audio drop, decode it, and play it to completion through an
 *  AudioContext. Real audio files (wav/mp3/ogg/...) decode natively --
 *  unlike Pocket's raw PCM this needs no manual conversion. Resolves true
 *  only when the buffer reached onended. */
async function playAudioFile(
  url: string,
  ctx: AudioContext,
  signal: AbortSignal,
): Promise<boolean> {
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`Audio fetch failed (HTTP ${resp.status})`);
  const bytes = await resp.arrayBuffer();
  const audioBuf = await ctx.decodeAudioData(bytes);
  return new Promise<boolean>((resolve, reject) => {
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* already stopped */
      }
      resolve(ok);
    };
    const onAbort = () => finish(false);
    src.onended = () => finish(true);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      src.start();
    } catch (e) {
      finish(false);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
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

  // Maya inbox ("Listen for Maya") — polls /inbox/pending and speaks each
  // line through the same Pocket path as a manual take.
  const [inboxOn, setInboxOn] = useState(false);
  const [inboxLines, setInboxLines] = useState<InboxLine[]>([]);
  const [inboxCounts, setInboxCounts] = useState({ text: 0, audio: 0 });
  const inboxBusyRef = useRef(false);
  const inboxHandledRef = useRef<Set<string>>(new Set());
  const inboxListedRef = useRef<Set<string>>(new Set());
  const inboxFailsRef = useRef<Map<string, number>>(new Map());
  const inboxCtlRef = useRef<AbortController | null>(null);
  const inboxCtxRef = useRef<AudioContext | null>(null);
  const speakCtxRef = useRef<AudioContext | null>(null);

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
    async (
      trimmed: string,
      voiceId: string,
      controller: AbortController,
      urls: string[],
      blobs?: Blob[],
    ) => {
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
        blobs?.push(blob);
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

  // AudioContext for Pocket PCM playback. Created/resumed inside click
  // handlers so the user gesture satisfies the autoplay policy.
  const ensureSpeakCtx = useCallback((): AudioContext | null => {
    try {
      const ctx = speakCtxRef.current ?? new AudioContext();
      speakCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }, []);

  const speak = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !voice || running) return;

    setRunning(true);
    setRunError(null);
    setProgress(engine === "f5" ? "queued" : "0/?");
    const controller = new AbortController();
    abortRef.current = controller;
    const urls: string[] = [];
    let pcmBlobs: Blob[] | undefined;
    let failure = "";
    let playedAll = false;

    try {
      if (engine === "f5") {
        await speakF5Run(trimmed, voice, controller, urls);
        if (!controller.signal.aborted && urls.length > 0) {
          playedAll = await playUrlsSequentially(urls, controller.signal, audioRef);
        }
      } else {
        const blobs: Blob[] = [];
        await speakPocketRun(trimmed, voice, controller, urls, blobs);
        if (!controller.signal.aborted && blobs.length > 0) {
          const ctx = ensureSpeakCtx();
          playedAll = ctx
            ? await playPcmSequentially(blobs, ctx, controller.signal)
            : false;
        }
        // Pocket blobs are raw PCM -- the object URLs are undecodable, so
        // release them; the take keeps the blobs for PCM replay instead.
        for (const url of urls) URL.revokeObjectURL(url);
        urls.length = 0;
        pcmBlobs = blobs;
      }
      if (playedAll) {
        takeIdRef.current += 1;
        const take: Take = {
          id: takeIdRef.current,
          engine,
          voice,
          preview: trimmed.slice(0, 40),
          urls: [...urls],
          pcmBlobs,
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
  }, [text, voice, running, engine, speakPocketRun, speakF5Run, ensureSpeakCtx]);

  const replayTake = useCallback(
    (take: Take) => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      if (take.pcmBlobs && take.pcmBlobs.length > 0) {
        const ctx = ensureSpeakCtx();
        if (ctx) void playPcmSequentially(take.pcmBlobs, ctx, controller.signal);
        return;
      }
      void playUrlsSequentially(take.urls, controller.signal, audioRef);
    },
    [ensureSpeakCtx],
  );

  // -- Maya inbox ("Listen for Maya") ---------------------------------------
  // Lazily create/resume the inbox AudioContext. Called from click handlers
  // and poll ticks (the toggle click already unlocked audio for the page).
  const ensureInboxCtx = useCallback((): AudioContext | null => {
    try {
      const ctx = inboxCtxRef.current ?? new AudioContext();
      inboxCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }, []);

  // Synthesize + play one text inbox entry through the same Pocket path a
  // manual take uses (chunked speakPocket -> PCM decode -> AudioContext).
  // Resolves true only when every chunk played to completion -- a speak or
  // playback failure resolves false so the entry stays pending and retries.
  const playInboxEntry = useCallback(
    async (entry: InboxEntry): Promise<boolean> => {
      const controller = new AbortController();
      inboxCtlRef.current = controller;
      const urls: string[] = [];
      const blobs: Blob[] = [];
      try {
        await speakPocketRun(entry.text, entry.voice, controller, urls, blobs);
        if (blobs.length === 0) return false;
        const ctx = ensureInboxCtx();
        if (!ctx) return false;
        const played = await playPcmSequentially(blobs, ctx, controller.signal);
        for (const url of urls) URL.revokeObjectURL(url);
        return played;
      } catch {
        for (const url of urls) URL.revokeObjectURL(url);
        return false;
      } finally {
        if (inboxCtlRef.current === controller) inboxCtlRef.current = null;
      }
    },
    [speakPocketRun, ensureInboxCtx],
  );

  // Fetch + decode + play one audio drop. Resolves true only at onended.
  const playInboxAudio = useCallback(
    async (entry: InboxAudioEntry): Promise<boolean> => {
      const controller = new AbortController();
      inboxCtlRef.current = controller;
      try {
        const ctx = ensureInboxCtx();
        if (!ctx) return false;
        return await playAudioFile(
          inboxAudioFileUrl(entry.id),
          ctx,
          controller.signal,
        );
      } catch {
        return false;
      } finally {
        if (inboxCtlRef.current === controller) inboxCtlRef.current = null;
      }
    },
    [ensureInboxCtx],
  );

  // Pending counts for the rail's "N waiting" line. Refreshed on mount,
  // on every inbox tick, and once when the toggle goes off (no polling
  // while off — this is a single fetch, not an interval).
  const refreshInboxCounts = useCallback(async () => {
    const [t, a] = await Promise.all([
      getInboxPending().catch(() => null),
      getInboxAudioPending().catch(() => null),
    ]);
    setInboxCounts({
      text: t?.entries.length ?? 0,
      audio: a?.entries.length ?? 0,
    });
  }, []);

  useEffect(() => {
    void refreshInboxCounts();
  }, [refreshInboxCounts]);

  const toggleInbox = useCallback(() => {
    if (inboxOn) {
      setInboxOn(false);
      inboxCtlRef.current?.abort();
      inboxCtlRef.current = null;
      void refreshInboxCounts();
      return;
    }
    // The toggle click is the user gesture that unlocks audio playback.
    ensureInboxCtx();
    setInboxOn(true);
  }, [inboxOn, ensureInboxCtx, refreshInboxCounts]);

  // Poll the pending inbox while the toggle is on. Entries are handled once
  // per session (inboxHandledRef); failures retry on later polls up to
  // INBOX_MAX_FAILS attempts, then the line is skipped for the session.
  useEffect(() => {
    if (!inboxOn) return;
    const pollCtl = new AbortController();
    // Function wrapper keeps the abort check readable to the linter —
    // AbortSignal.aborted is readonly, so a bare property read narrows.
    const pollAborted = () => pollCtl.signal.aborted;

    const tick = async () => {
      if (pollAborted() || inboxBusyRef.current) return;
      inboxBusyRef.current = true;
      try {
        // Text lines and audio drops are independent queues; fetch both so
        // one failing endpoint cannot starve the other.
        const [textRes, audioRes] = await Promise.all([
          getInboxPending().catch(() => null),
          getInboxAudioPending().catch(() => null),
        ]);
        setInboxCounts({
          text: textRes?.entries.length ?? 0,
          audio: audioRes?.entries.length ?? 0,
        });

        const listLine = (
          setKey: string,
          lineId: string,
          kind: "text" | "audio",
          text: string,
          voice: string,
          rawName?: string,
        ) => {
          if (inboxListedRef.current.has(setKey)) return;
          inboxListedRef.current.add(setKey);
          setInboxLines((prev) =>
            [
              {
                id: lineId,
                kind,
                text,
                voice,
                rawName,
                at: new Date().toLocaleTimeString(),
                state: "waiting" as const,
              },
              ...prev.filter((l) => l.id !== lineId),
            ].slice(0, 5),
          );
        };

        const markInboxLinePlayed = (lineId: string) =>
          setInboxLines((prev) =>
            prev.map((l) => (l.id === lineId ? { ...l, state: "played" as const } : l)),
          );

        for (const entry of textRes?.entries ?? []) {
          if (pollAborted()) break;
          if (inboxHandledRef.current.has(entry.id)) continue;
          const fails = inboxFailsRef.current.get(entry.id) ?? 0;
          if (fails >= INBOX_MAX_FAILS) {
            inboxHandledRef.current.add(entry.id);
            continue;
          }
          // Claim the entry before awaiting so overlapping ticks cannot
          // double-queue it; released below if playback fails.
          inboxHandledRef.current.add(entry.id);
          // The line was received this session -- list it (with replay)
          // even if playback fails, so a failed attempt is never invisible.
          listLine(entry.id, entry.id, "text", entry.text, entry.voice);
          const played = await playInboxEntry(entry);
          if (pollAborted()) {
            // Toggle went off (or unmount) mid-line: release the claim so
            // the entry retries on the next ON without burning a fail.
            inboxHandledRef.current.delete(entry.id);
            break;
          }
          if (played) {
            void markInboxPlayed(entry.id)
              .then(() => markInboxLinePlayed(entry.id))
              .catch(() => undefined);
          } else {
            inboxHandledRef.current.delete(entry.id);
            inboxFailsRef.current.set(entry.id, fails + 1);
          }
        }

        for (const entry of audioRes?.entries ?? []) {
          if (pollAborted()) break;
          const key = `audio:${entry.id}`;
          if (inboxHandledRef.current.has(key)) continue;
          const fails = inboxFailsRef.current.get(key) ?? 0;
          if (fails >= INBOX_MAX_FAILS) {
            inboxHandledRef.current.add(key);
            continue;
          }
          inboxHandledRef.current.add(key);
          listLine(key, entry.id, "audio", inboxAudioDisplayName(entry.name), "", entry.name);
          const played = await playInboxAudio(entry);
          if (pollAborted()) {
            inboxHandledRef.current.delete(key);
            break;
          }
          if (played) {
            void markInboxAudioPlayed(entry.id)
              .then(() => markInboxLinePlayed(entry.id))
              .catch(() => undefined);
          } else {
            inboxHandledRef.current.delete(key);
            inboxFailsRef.current.set(key, fails + 1);
          }
        }
      } catch {
        /* poll/playback failure -- next tick retries */
      } finally {
        inboxBusyRef.current = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), INBOX_POLL_MS);
    return () => {
      pollCtl.abort();
      window.clearInterval(id);
      inboxCtlRef.current?.abort();
      inboxCtlRef.current = null;
    };
  }, [inboxOn, playInboxEntry, playInboxAudio]);

  const replayInboxLine = useCallback(
    (line: InboxLine) => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      if (line.kind === "audio") {
        const ctx = ensureInboxCtx();
        if (!ctx) return;
        void playAudioFile(inboxAudioFileUrl(line.id), ctx, controller.signal).catch(
          () => undefined,
        );
        return;
      }
      const urls: string[] = [];
      const blobs: Blob[] = [];
      void (async () => {
        try {
          await speakPocketRun(line.text, line.voice, controller, urls, blobs);
          const ctx = ensureInboxCtx();
          if (ctx && blobs.length > 0) {
            await playPcmSequentially(blobs, ctx, controller.signal);
          }
        } catch {
          /* replay is best-effort */
        } finally {
          for (const url of urls) URL.revokeObjectURL(url);
        }
      })();
    },
    [speakPocketRun, ensureInboxCtx],
  );

  // Tear the inbox session down on unmount (toggle stays session-only).
  useEffect(() => {
    return () => {
      inboxCtlRef.current?.abort();
      inboxCtxRef.current?.close().catch(() => undefined);
      speakCtxRef.current?.close().catch(() => undefined);
    };
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

  const inboxWaiting = inboxCounts.text + inboxCounts.audio;

  return (
    <div className="p-6 space-y-4 w-full max-w-6xl">
      <div className="pb-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Mic size={20} /> Voice Live
          </h1>
          <MayaPresencePill />
        </div>
        <div
          className="mt-1 h-1 w-16 rounded-full"
          style={{ backgroundColor: "#6A4C98" }}
        />
        <p className="text-sm text-muted mt-2">
          Speak through Pocket TTS, F5, or live duplex. When Listen for Maya
          is on, her posted lines and audio drops play here automatically.
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

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-4">
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

        <aside className="w-full shrink-0 xl:w-[340px]">
          <Card className="p-4">
            <div
              className="text-sm font-semibold mb-3"
              style={{ color: "#6A4C98" }}
            >
              Maya's line
            </div>
            <div className="space-y-2">
              <button
                type="button"
                className="btn btn-sm inline-flex items-center gap-1"
                style={{
                  borderColor: "#6A4C98",
                  color: inboxOn ? "#ffffff" : "#6A4C98",
                  backgroundColor: inboxOn ? "#6A4C98" : "transparent",
                }}
                onClick={toggleInbox}
                aria-pressed={inboxOn}
              >
                <Mic size={14} /> Listen for Maya{inboxOn ? " — on" : ""}
              </button>
              <div className="text-[11px] text-muted">
                {inboxOn
                  ? "Maya's posted lines will be spoken automatically."
                  : "Off — lines Maya posts will wait until you switch this on."}
              </div>
              <div className="text-[11px] text-muted">
                {inboxWaiting === 0 ? "Nothing waiting" : `${inboxWaiting} waiting`}
              </div>
              {inboxLines.length > 0 && (
                <ul className="space-y-1">
                  {inboxLines.map((line) => (
                    <li
                      key={line.id}
                      title={line.rawName ?? line.text}
                      className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {line.kind === "audio" && (
                            <FileAudio size={11} className="shrink-0 text-sky-300" />
                          )}
                          <span className="truncate font-medium">{line.text}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted">
                          <span className="tabular-nums">{line.at}</span>
                          <span
                            className={
                              line.state === "played"
                                ? "text-emerald-400"
                                : "text-warning"
                            }
                          >
                            {line.state === "played" ? "Played" : "Waiting"}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm inline-flex items-center gap-1 shrink-0"
                        onClick={() => replayInboxLine(line)}
                        title={line.rawName ? `Replay ${line.rawName}` : "Speak this line again"}
                      >
                        <Play size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
