/**
 * Call panel — Maya places a call to Nate through the Studio, on his rig,
 * tailnet-only. Added to the existing Voice Live surface (no visual redesign
 * of the engine cards); the shared line state lives in the backend so both
 * sides read the same state from the same source.
 *
 * Flow: idle -> (maya places) ringing -> (nate answers) connected ->
 * (either ends) ended -> idle.
 *
 * Audio:
 *  - Maya's voice: she types a line, the backend speaks it through Pocket TTS
 *    and streams PCM16 mono 24 kHz to Nate's speakers.
 *  - Nate's mic: PCM16 mono 16 kHz to the backend, faster-whisper STT, the
 *    transcript is delivered to Maya as text (decision 3: existing STT wired;
 *    no new STT dependency).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Square, Send, AlertTriangle, Volume2 } from "lucide-react";
import { Card } from "../../components/common";
import {
  connectCallSession,
  floatToPcm16,
  getCallState,
  type CallSession,
  type CallSnapshot,
} from "../../services/api/voice_call";

const ROLE_STORAGE_KEY = "voice-call-role";
const DEFAULT_VOICE = "maya-blend65";

// Nate's mic is captured at 16 kHz (backend VAD/whisper expect that rate).
const MIC_SAMPLE_RATE = 16000;

type Role = "maya" | "nate" | null;

function storedRole(): Role {
  try {
    const raw = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (raw === "maya" || raw === "nate") return raw;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function CallPanel() {
  const [role, setRole] = useState<Role>(storedRole());
  const [state, setState] = useState<CallSnapshot>({
    state: "idle",
    caller: null,
    callee: null,
    version: 0,
    started_at: null,
    answered_at: null,
    ended_at: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [speakText, setSpeakText] = useState("");
  const [speaking, setSpeaking] = useState(false);

  const sessionRef = useRef<CallSession | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playNextRef = useRef(0);
  const playSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const speakCooldownRef = useRef<number | null>(null);

  // Sync with the shared state on mount, then keep the WebSocket in sync.
  useEffect(() => {
    let cancelled = false;
    getCallState()
      .then((s) => { if (!cancelled) setState(s); })
      .catch(() => {/* initial fetch best-effort; WS state will correct it */});
    return () => { cancelled = true; };
  }, []);

  const clearPlayback = useCallback(() => {
    playNextRef.current = 0;
    for (const src of playSourcesRef.current) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    playSourcesRef.current.clear();
  }, []);

  const ensurePlayCtx = useCallback((): AudioContext | null => {
    try {
      const ctx = playCtxRef.current ?? new AudioContext();
      playCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }, []);

  const teardownAudio = useCallback(() => {
    clearPlayback();
    const playCtx = playCtxRef.current;
    playCtxRef.current = null;
    if (playCtx) void playCtx.close().catch(() => undefined);
    playNextRef.current = 0;
    procRef.current?.disconnect();
    procRef.current = null;
    const micCtx = micCtxRef.current;
    micCtxRef.current = null;
    if (micCtx) void micCtx.close().catch(() => undefined);
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, [clearPlayback]);

  // Nate's microphone: capture -> 16 kHz PCM16 -> backend STT.
  const startMic = useCallback(() => {
    if (procRef.current) return;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        micStreamRef.current = stream;
        const ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
        micCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        procRef.current = proc;
        proc.onaudioprocess = (e) => {
          const session = sessionRef.current;
          if (!session) return;
          const input = e.inputBuffer.getChannelData(0);
          session.sendPcm(floatToPcm16(input));
        };
        const mute = ctx.createGain();
        mute.gain.value = 0; // Nate hears Maya through the speakers, not his own mic back
        source.connect(proc);
        proc.connect(mute);
        mute.connect(ctx.destination);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Microphone access failed.");
      }
    })();
  }, []);

  const stopMic = useCallback(() => {
    teardownAudio();
  }, [teardownAudio]);

  // -- session lifecycle ---------------------------------------------------

  const openSession = useCallback(() => {
    if (sessionRef.current) return;
    if (!role) return;
    const session = connectCallSession({
      onEvent: (event) => {
      if (event.type === "state" && event.state) {
        const nextState = event.state;
        setState((prev) => ({
          ...prev,
          state: nextState,
          version: event.version ?? prev.version,
          caller: event.caller ?? null,
          callee: event.callee ?? null,
          started_at: event.started_at ?? null,
          answered_at: event.answered_at ?? null,
          ended_at: event.ended_at ?? null,
        }));
      } else if (event.type === "transcript") {
          const text = event.text;
          if (text) {
            setTranscripts((prev) => [...prev, text].slice(-50));
          }
        } else if (event.type === "error") {
          const message = event.message;
          if (message) setError(message);
        }
      },
      onAudio: (samples, sampleRate) => {
        // Maya's Pocket voice -> Nate's speakers.
        const chan = new Float32Array(samples.length);
        chan.set(samples);
        const ctx = ensurePlayCtx();
        if (!ctx) return;
        const buf = ctx.createBuffer(1, chan.length, sampleRate);
        buf.copyToChannel(chan, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        const startAt = Math.max(ctx.currentTime + 0.05, playNextRef.current);
        src.start(startAt);
        playNextRef.current = startAt + buf.duration;
        playSourcesRef.current.add(src);
        src.onended = () => { playSourcesRef.current.delete(src); };
      },
      onClose: () => {
        sessionRef.current = null;
        setError("Call connection closed.");
      },
    });
    sessionRef.current = session;
    session.hello(role);
  }, [role, ensurePlayCtx]);

  const closeSession = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    stopMic();
    if (speakCooldownRef.current !== null) {
      window.clearTimeout(speakCooldownRef.current);
      speakCooldownRef.current = null;
    }
    setSpeaking(false);
    setError(null);
  }, [stopMic]);

  useEffect(() => {
    openSession();
    return () => closeSession();
  }, [openSession, closeSession]);

  useEffect(() => {
    if (!role || !sessionRef.current) return;
    sessionRef.current.hello(role);
  }, [role, sessionRef.current]);

  // Nate's mic only runs while connected; Maya never needs a mic.
  useEffect(() => {
    if (role === "nate" && state.state === "connected") {
      void startMic();
    } else if (role === "nate" && state.state !== "connected") {
      stopMic();
    }
  }, [role, state.state, startMic, stopMic]);

  // -- actions -------------------------------------------------------------

  const setRoleAndPersist = useCallback((next: Role) => {
    setRole(next);
    try {
      if (next) window.localStorage.setItem(ROLE_STORAGE_KEY, next);
      else window.localStorage.removeItem(ROLE_STORAGE_KEY);
    } catch { /* localStorage unavailable */ }
  }, []);

  const placeCall = useCallback(() => {
    setError(null);
    sessionRef.current?.place();
  }, []);

  const answerCall = useCallback(() => {
    setError(null);
    sessionRef.current?.answer();
  }, []);

  const endCall = useCallback(() => {
    setError(null);
    sessionRef.current?.end();
  }, []);

  const speak = useCallback(() => {
    const text = speakText.trim();
    if (!text || speaking) return;
    setSpeaking(true);
    setError(null);
    try {
      sessionRef.current?.speak(text, DEFAULT_VOICE);
      setSpeakText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speak failed.");
    }
    // The backend streams TTS with no completion event, so concurrent speaks
    // would interleave PCM chunks into garbled audio. Hold the button for a
    // cooldown instead of the old AbortController, which could never abort.
    speakCooldownRef.current = window.setTimeout(() => setSpeaking(false), 2000);
  }, [speakText, speaking]);

  // -- derived UI ----------------------------------------------------------

  const isMaya = role === "maya";
  const isNate = role === "nate";
  const connected = state.state === "connected";
  const ringing = state.state === "ringing";
  const canPlace = isMaya && state.state === "idle";
  const canAnswer = isNate && state.state === "ringing";
  const canEnd = connected || ringing;

  const stateLabel = {
    idle: "Idle",
    ringing: isMaya ? "Ringing…" : "Incoming call",
    connected: "Connected",
    ended: "Ended",
  }[state.state];

  return (
    <Card className="p-4 space-y-3 border border-border/60">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Phone size={18} className="text-sky-300" />
          <span className="font-semibold text-foreground">Call</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
            state.state === "idle"
              ? "border-border text-muted"
              : state.state === "ringing"
                ? "border-warning text-warning"
                : state.state === "connected"
                  ? "border-emerald-400 text-emerald-400"
                  : "border-border text-muted"
          }`}
        >
          {stateLabel}
        </span>
      </div>

      {role === null && (
        <div className="space-y-2">
          <span className="text-xs text-muted">Pick who you are:</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRoleAndPersist("maya")}
              className="btn btn-sm flex-1 btn-ghost"
            >
              Maya
            </button>
            <button
              type="button"
              onClick={() => setRoleAndPersist("nate")}
              className="btn btn-sm flex-1 btn-ghost"
            >
              Nate
            </button>
          </div>
        </div>
      )}

      {role && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              {isMaya ? "Maya's line" : "Nate's line"} · {state.state}
            </span>
            {error && (
              <span className="inline-flex items-center gap-1 text-xs text-error-text">
                <AlertTriangle size={12} /> {error}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {canPlace && (
              <button type="button" className="btn btn-primary btn-sm" onClick={placeCall}>
                <Phone size={14} /> Place call
              </button>
            )}
            {canAnswer && (
              <button type="button" className="btn btn-primary btn-sm" onClick={answerCall}>
                Answer
              </button>
            )}
            {(!canPlace || !canAnswer) && canEnd && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={endCall}>
                <Square size={14} /> End call
              </button>
            )}
            {!canPlace && !canAnswer && !canEnd && (
              <span className="btn btn-sm btn-ghost opacity-50 pointer-events-none">
                {isMaya ? "Waiting for Nate…" : "Waiting for Maya to call…"}
              </span>
            )}
          </div>

          {connected && isMaya && (
            <div className="space-y-2 pt-2 border-t border-border/40">
              <label className="text-xs font-medium text-muted block">Say to Nate</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Type what Nate should hear…"
                  value={speakText}
                  onChange={(e) => setSpeakText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") speak(); }}
                  disabled={speaking}
                  maxLength={400}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={speak}
                  disabled={speaking || !speakText.trim()}
                >
                  <Send size={14} /> Speak
                </button>
                {speaking && <span className="text-xs text-muted">speaking…</span>}
              </div>
            </div>
          )}

          {connected && isNate && (
            <div className="space-y-2 pt-2 border-t border-border/40">
              <span className="text-xs font-medium text-muted flex items-center gap-1">
                <Volume2 size={14} /> Microphone open — your voice is transcribed to Maya
              </span>
            </div>
          )}

          {transcripts.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-border/40">
              <span className="text-xs font-medium text-muted block">Nate's replies</span>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background/50 p-2 space-y-1 text-sm">
                {transcripts.map((t, i) => (
                  <div key={i} className="text-sky-300">{t}</div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn btn-ghost btn-sm w-full text-xs"
            onClick={() => setRoleAndPersist(null)}
          >
            Change role
          </button>
        </div>
      )}
    </Card>
  );
}
