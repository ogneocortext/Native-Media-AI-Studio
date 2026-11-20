/**
 * Frontend client for /api/voice/live — the duplex voice cascade
 * (VAD -> faster-whisper -> Ollama -> Pocket TTS -> PCM16 audio).
 *
 * Protocol (see packages/backend/app/api/voice_live.py):
 * - binary out: PCM16 mono 24 kHz from Pocket
 * - binary in:  PCM16 mono 16 kHz mic audio
 * - JSON events: state / transcript / reply / error
 */

export type LiveState = "idle" | "listening" | "thinking" | "speaking";

export interface LiveEvent {
  type: string;
  state?: LiveState;
  text?: string;
  final?: boolean;
  message?: string;
  barged?: boolean;
}

export interface LiveSessionOptions {
  onEvent: (event: LiveEvent) => void;
  /** Called with each decoded Float32 chunk ready for playback scheduling. */
  onAudio: (samples: Float32Array, sampleRate: number) => void;
  onClose?: () => void;
}

export interface LiveSession {
  start: (voice?: string) => void;
  stop: () => void;
  sendText: (text: string) => void;
  sendPcm: (pcm: ArrayBuffer) => void;
  close: () => void;
}

const LIVE_SAMPLE_RATE_OUT = 24000;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/voice/live`;
}

/** Float32 mic frame -> PCM16 bytes. */
export function floatToPcm16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/** PCM16 24 kHz bytes -> Float32 samples for WebAudio playback. */
export function pcm16ToFloat(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const out = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

/**
 * Open the duplex session. The caller owns the microphone (getUserMedia +
 * AudioWorklet/ScriptProcessor producing Float32 frames at 16 kHz) and the
 * speaker (scheduling Float32 chunks at 24 kHz, with queue-clearing on
 * barge-in).
 */
export function connectLiveSession(opts: LiveSessionOptions): LiveSession {
  const ws = new WebSocket(wsUrl());
  let closed = false;

  ws.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data === "string") {
      try {
        opts.onEvent(JSON.parse(ev.data) as LiveEvent);
      } catch {
        /* ignore malformed events */
      }
      return;
    }
    const raw: unknown = ev.data;
    if (raw instanceof Blob || raw instanceof ArrayBuffer) {
      void (async () => {
        const buf = raw instanceof Blob ? await raw.arrayBuffer() : raw;
        opts.onAudio(pcm16ToFloat(buf), LIVE_SAMPLE_RATE_OUT);
      })();
    }
  };

  ws.onclose = () => {
    closed = true;
    opts.onClose?.();
  };

  ws.onerror = () => {
    opts.onEvent({ type: "error", message: "Voice live connection failed." });
  };

  const send = (payload: string | ArrayBuffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  };

  return {
    start: (voice?: string) => send(JSON.stringify({ type: "start", voice })),
    stop: () => send(JSON.stringify({ type: "stop" })),
    sendText: (text: string) => send(JSON.stringify({ type: "text", text })),
    sendPcm: (pcm: ArrayBuffer) => send(pcm),
    close: () => {
      if (!closed) {
        closed = true;
        ws.close();
      }
    },
  };
}
