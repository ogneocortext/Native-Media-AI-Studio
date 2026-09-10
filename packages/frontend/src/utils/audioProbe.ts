/**
 * Client-side audio probing — validate duration/codec before GPU upload.
 * Uses Web Audio decode when available, falls back to <audio> metadata.
 */

export interface AudioProbeResult {
  durationSeconds: number | null;
  channels: number | null;
  sampleRate: number | null;
}

const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "webm"];

export function getFileExtension(name: string): string {
  const parts = (name || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() as string : "";
}

/** MIME may be empty on Windows — accept by extension fallback. */
export function isAudioFile(file: File, accept?: string): boolean {
  if (file.type && file.type.startsWith("audio/")) return true;
  // Some containers report video/* or application/* (e.g. ogg, m4a)
  if (file.type && /^(video\/ogg|application\/ogg|audio\/x-)/.test(file.type)) return true;
  const ext = getFileExtension(file.name);
  if (AUDIO_EXTENSIONS.includes(ext)) return true;
  if (accept) {
    const tokens = accept.split(",").map((t) => t.trim().toLowerCase());
    if (tokens.includes(file.type.toLowerCase())) return true;
    if (tokens.includes(`.${ext}`)) return true;
  }
  return false;
}

function probeViaElement(file: File, timeoutMs = 8000): Promise<AudioProbeResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("audio");
    el.preload = "metadata";
    const timer = window.setTimeout(() => {
      cleanup();
      resolve({ durationSeconds: null, channels: null, sampleRate: null });
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
    };
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? el.duration : null;
      cleanup();
      resolve({ durationSeconds: d, channels: null, sampleRate: null });
    };
    el.onerror = () => {
      cleanup();
      resolve({ durationSeconds: null, channels: null, sampleRate: null });
    };
    el.src = url;
  });
}

export async function probeAudioFile(file: File): Promise<AudioProbeResult> {
  // Prefer full decode — also catches corrupt headers early.
  try {
    const AudioCtx: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const buf = await file.arrayBuffer();
      // decodeAudioData detaches the buffer; copy cost is acceptable for ≤500MB probe.
      // Guard against huge files blocking the main thread: fall back for >150MB.
      if (file.size < 150 * 1024 * 1024) {
        const ctx = new AudioCtx();
        try {
          const decoded = await ctx.decodeAudioData(buf);
          const result: AudioProbeResult = {
            durationSeconds: decoded.duration,
            channels: decoded.numberOfChannels,
            sampleRate: decoded.sampleRate,
          };
          void ctx.close().catch(() => {});
          return result;
        } finally {
          // decodeAudioData may leave context running on failure paths
          if (ctx.state !== "closed") void ctx.close().catch(() => {});
        }
      }
    }
  } catch {
    /* fall through to element probe */
  }
  return probeViaElement(file);
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "unknown length";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
