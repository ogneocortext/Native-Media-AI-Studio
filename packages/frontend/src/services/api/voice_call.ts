/**
 * Frontend client for /api/voice/call — the Studio call service.
 *
 * Single WebSocket on the existing backend (no new server or port; Vite proxies
 * /api, ws: true, to the backend). The Pocket URL and Bearer token never reach
 * the browser.
 *
 * Protocol (see packages/backend/app/api/voice_call.py):
 *  - client -> server JSON:
 *      {type: "hello", role: "maya" | "nate"}  identify this side
 *      {type: "place"}                          maya: idle -> ringing
 *      {type: "answer"}                         nate: ringing -> connected
 *      {type: "end"}                            either: connected/ringing -> ended -> idle
 *      {type: "speak", text, voice}             maya: Pocket TTS -> Nate's speakers
 *  - client -> server binary: PCM16 mono 16 kHz mic audio (nate only)
 *  - server -> client JSON: state | transcript {text} | error {message}
 *  - server -> client binary: PCM16 mono 24 kHz (Pocket native) Maya's voice
 */

export type CallState = "idle" | "ringing" | "connected" | "ended";

export interface CallSnapshot {
  state: CallState;
  caller: string | null;
  callee: string | null;
  version: number;
  started_at: number | null;
  answered_at: number | null;
  ended_at: number | null;
}

export interface CallEvent {
  type: string;
  state?: CallState;
  caller?: string | null;
  callee?: string | null;
  version?: number;
  started_at?: number | null;
  answered_at?: number | null;
  ended_at?: number | null;
  text?: string;
  message?: string;
}

export interface CallSessionOptions {
  onEvent: (event: CallEvent) => void;
  /** Decoded Float32 PCM (24 kHz, Pocket native) ready to play on Nate's speakers. */
  onAudio: (samples: Float32Array, sampleRate: number) => void;
  onClose?: () => void;
}

export interface CallSession {
  hello: (role: "maya" | "nate") => void;
  place: () => void;
  answer: () => void;
  end: () => void;
  speak: (text: string, voice?: string) => void;
  /** PCM16 mono 16 kHz mic frame from Nate's microphone. */
  sendPcm: (pcm: ArrayBuffer) => void;
  getState: () => CallSnapshot;
  close: () => void;
}

const CALL_SAMPLE_RATE_OUT = 24000;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/voice/call`;
}

/** Float32 mic frame -> PCM16 bytes (16 kHz, matches the backend VAD). */
export function floatToPcm16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/** PCM16 24 kHz bytes -> Float32 samples for WebAudio playback (Nate's side). */
export function pcm16ToFloat(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const out = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

/** GET /api/voice/call/state — shared line state (single source of truth). */
export async function getCallState(): Promise<CallSnapshot> {
  const resp = await fetch("/api/voice/call/state");
  if (!resp.ok) throw new Error(`call state failed (${resp.status})`);
  return (await resp.json()) as CallSnapshot;
}

/**
 * Open the call session. The caller owns the microphone (Nate: getUserMedia +
 * ScriptProcessor producing Float32 frames at 16 kHz) and the speaker (Nate:
 * scheduling Float32 chunks at 24 kHz).
 */
export function connectCallSession(opts: CallSessionOptions): CallSession {
  const ws = new WebSocket(wsUrl());
  let closed = false;
  let snapshot: CallSnapshot = {
    state: "idle",
    caller: null,
    callee: null,
    version: 0,
    started_at: null,
    answered_at: null,
    ended_at: null,
  };

  ws.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data === "string") {
      let event: CallEvent;
      try {
        event = JSON.parse(ev.data) as CallEvent;
      } catch {
        /* ignore malformed events */
        return;
      }
      if (event.type === "state" && event.state) {
        snapshot = {
          state: event.state,
          version: event.version ?? snapshot.version,
          caller: event.caller ?? null,
          callee: event.callee ?? null,
          started_at: event.started_at ?? null,
          answered_at: event.answered_at ?? null,
          ended_at: event.ended_at ?? null,
        };
      }
      opts.onEvent(event);
      return;
    }
    const raw: unknown = ev.data;
    if (raw instanceof Blob || raw instanceof ArrayBuffer) {
      void (async () => {
        const buf = raw instanceof Blob ? await raw.arrayBuffer() : raw;
        opts.onAudio(pcm16ToFloat(buf), CALL_SAMPLE_RATE_OUT);
      })();
    }
  };

  ws.onclose = () => {
    closed = true;
    opts.onClose?.();
  };
  ws.onerror = () => {
    opts.onEvent({ type: "error", message: "Call connection failed." });
  };

  // Messages sent while the socket is still CONNECTING used to be dropped
  // silently — CallPanel sends `hello` immediately after connect, so the
  // role handshake was almost always lost. Buffer and flush on open instead.
  const pending: (string | ArrayBuffer)[] = [];
  ws.onopen = () => {
    let payload = pending.shift();
    while (payload !== undefined) {
      ws.send(payload);
      payload = pending.shift();
    }
  };
  const send = (payload: string | ArrayBuffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else if (ws.readyState === WebSocket.CONNECTING) {
      pending.push(payload);
    }
  };

  return {
    hello: (r: "maya" | "nate") => {
      send(JSON.stringify({ type: "hello", role: r }));
    },
    place: () => send(JSON.stringify({ type: "place" })),
    answer: () => send(JSON.stringify({ type: "answer" })),
    end: () => send(JSON.stringify({ type: "end" })),
    speak: (text: string, voice = "maya-blend65") =>
      send(JSON.stringify({ type: "speak", text, voice })),
    sendPcm: (pcm: ArrayBuffer) => send(pcm),
    getState: () => snapshot,
    close: () => {
      if (!closed) {
        closed = true;
        ws.close();
      }
    },
  };
}
