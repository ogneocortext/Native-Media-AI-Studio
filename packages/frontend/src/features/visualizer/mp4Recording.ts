/**
 * MP4 recording via WebCodecs + Mediabunny.
 *
 * Provides a higher-fidelity export path than MediaRecorder/WebM for browsers
 * that support WebCodecs (Chromium 94+). Falls back transparently when
 * WebCodecs is unavailable.
 */

import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";

export interface Mp4RecorderOptions {
  /** Target bitrate in bps (default 8_000_000). */
  bitrate?: number;
  /** Frame rate (default 60). */
  fps?: number;
  /** H.264 codec for VideoEncoder (default 'avc'). */
  codec?: Mp4Codec;
}

export type Mp4Codec = "avc" | "hevc" | "vp9" | "av1";

export interface Mp4Recorder {
  start: (canvas: HTMLCanvasElement) => void;
  /** Stops capture, flushes the encoder and muxes the file. */
  stop: () => Promise<ArrayBuffer | null>;
}

/** WebCodecs codec strings per container codec (mp4-muxer uses the short name). */
const CODEC_STRINGS: Record<Mp4Codec, string> = {
  avc: "avc1.42E01E",
  hevc: "hev1.1.6.L93.B0",
  vp9: "vp09.00.10.08",
  av1: "av01.0.04M.08",
};

/**
 * Check whether the current browser supports WebCodecs and Mediabunny for
 * MP4 muxing.
 */
export function isMp4ExportSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof (window as unknown as Record<string, unknown>).VideoEncoder !== "undefined" &&
    typeof (window as unknown as Record<string, unknown>).VideoFrame !== "undefined"
  );
}

/**
 * Check that the browser can actually *encode* the H.264 profile we configure.
 *
 * `isMp4ExportSupported()` only proves WebCodecs exists — `configure()` can
 * still throw for an unsupported codec, which previously aborted the whole
 * record attempt (the caller reported a generic "Recording failed" instead of
 * falling back to WebM).
 */
export async function canRecordMp4(width?: number, height?: number): Promise<boolean> {
  if (!isMp4ExportSupported()) return false;
  try {
    const support = await (
      window as unknown as {
        VideoEncoder: {
          isConfigSupported: (c: object) => Promise<{ supported?: boolean }>;
        };
      }
    ).VideoEncoder.isConfigSupported({
      codec: CODEC_STRINGS.avc,
      width: width ?? 1280,
      height: height ?? 720,
      bitrate: 8_000_000,
      framerate: 60,
    });
    return support?.supported === true;
  } catch {
    return false;
  }
}

/**
 * Create an MP4 recorder. The returned object exposes start/stop; stop() returns
 * a promise for the finished MP4 ArrayBuffer (or null on failure).
 */
export function createMp4Recorder(opts: Mp4RecorderOptions = {}): Mp4Recorder {
  const { bitrate = 8_000_000, fps = 60, codec = "avc" } = opts;

  let output: Output | null = null;
  let target: BufferTarget | null = null;
  let source: CanvasSource | null = null;
  let raf = 0;
  let frameIndex = 0;
  let startTime = 0;
  let stopped = false;
  let startPromise: Promise<void> | null = null;
  let frameQueue: Promise<void> = Promise.resolve();
  // Mediabunny uses a two-second keyframe interval by default.

  const tick = (canvas: HTMLCanvasElement, timestamp: number) => {
    if (stopped || !source || !startPromise) return;

    if (startTime === 0) startTime = timestamp;
    const elapsedSeconds = (timestamp - startTime) / 1000;
    const keyFrame = frameIndex % Math.max(1, Math.round(fps * 2)) === 0;
    frameIndex++;
    frameQueue = frameQueue
      .then(() => source?.add(elapsedSeconds, 1 / fps, { keyFrame }))
      .catch((error: unknown) => console.error("[Mp4Recorder] frame encode failed:", error));
    raf = requestAnimationFrame((t) => tick(canvas, t));
  };

  return {
    start(canvas: HTMLCanvasElement) {
      if (typeof window === "undefined") return;
      const win = window as unknown as Record<string, unknown>;

      if (!win.VideoEncoder || !win.VideoFrame) {
        throw new Error("WebCodecs is not available in this environment");
      }

      target = new BufferTarget();
      output = new Output({ format: new Mp4OutputFormat(), target });
      source = new CanvasSource(canvas, {
        codec,
        bitrate,
        keyFrameInterval: 2,
      });
      output.addVideoTrack(source, { frameRate: fps });
      startPromise = output.start();

      stopped = false;
      frameIndex = 0;
      startTime = 0;
      raf = requestAnimationFrame((t) => tick(canvas, t));
    },

    async stop(): Promise<ArrayBuffer | null> {
      stopped = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }

      const activeOutput = output;
      const activeSource = source;
      const activeTarget = target;
      const pendingStart = startPromise;
      output = null;
      source = null;
      target = null;
      startPromise = null;

      try {
        if (pendingStart) await pendingStart;
        await frameQueue;
        activeSource?.close();
        if (activeOutput) await activeOutput.finalize();
        return activeTarget?.buffer || null;
      } catch (e) {
        console.error("[Mp4Recorder] finalize failed:", e);
        return null;
      }
    },
  };
}
