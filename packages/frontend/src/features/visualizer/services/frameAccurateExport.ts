/**
 * Deterministic frame-accurate export (plan 2.9).
 *
 * `mp4Recording.ts` / `useVisualizerRecording.ts` capture in real time:
 * they sample the canvas on the wall clock, so any hitch drops frames
 * and two exports of the same scene differ. This module implements the
 * frame-accurate mode per the r3f-video-recorder pattern: the
 * visualizer clock is driven from the frame index (`1/fps` steps) and
 * each frame is captured before advancing.
 *
 * Determinism contract (all three must hold for bit-identical output):
 * 1. `renderAtTime(t)` renders frame `t` synchronously — when it
 *    returns, the canvas holds exactly that frame. No rAF, no wall
 *    clock inside.
 * 2. `beginDeterministicRun()` resets every stateful driver (motion
 *    history, reactivity processor) so frame 0 starts clean.
 * 3. No live inputs leak into the frame (the shader visualizer's
 *    virtual-time path freezes the audio graph, FFT and beat pulse).
 *
 * Accept (plan 2.9): a 10 s export at 30 fps contains exactly 300
 * frames; two exports of the same scene are identical modulo
 * container metadata; backgrounding the tab mid-export drops nothing
 * (the loop never waits on rAF).
 */

import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";
import type { Mp4Codec } from "../mp4Recording";

export interface FrameAccurateExportOptions {
  /**
   * The canvas the frames land on. Prefer `FrameAccurateRenderApi.canvas()`;
   * this is the host-level fallback for a caller that has not published one.
   */
  canvas: HTMLCanvasElement;
  /** Frames per second of the export timeline. Default 30. */
  fps?: number;
  /** Export length in seconds. Default 10. */
  durationSec?: number;
  /**
   * Render exactly one visualizer frame at virtual time `tSec`.
   * Synchronous w.r.t. the canvas: when it returns (or its promise
   * resolves without yielding to a macrotask), the canvas holds
   * frame `tSec`.
   */
  renderAtTime: (tSec: number) => void | Promise<void>;
  /** Reset stateful drivers before frame 0 (see contract above). */
  beginDeterministicRun?: () => void;
  /** Re-enable live rendering after the last frame. */
  endDeterministicRun?: () => void;
  onProgress?: (framesDone: number, totalFrames: number) => void;
  bitrate?: number;
  codec?: Mp4Codec;
}

const CODEC_STRINGS: Record<Mp4Codec, string> = {
  avc: "avc1.42E01E",
  hevc: "hev1.1.6.L93.B0",
  vp9: "vp09.00.10.08",
  av1: "av01.0.04M.08",
};

/**
 * What a render path must publish for a frame-accurate export.
 *
 * The shader lane (`ShaderVisualizer`), the 2D lane (`Canvas2DVisualizer`)
 * and the three-js studio lane each implement this; the exporter depends on
 * the interface only, so adding a fourth path means implementing three
 * functions, not branching the exporter on mode.
 */
export interface FrameAccurateRenderApi {
  /** Reset stateful drivers and quiesce the live loop, so frame 0 is clean. */
  beginDeterministicRun: () => void;
  /** Render exactly one frame at virtual time `tSec` (seconds), at `fps`. */
  renderAtVirtualTime: (tSec: number, fps: number) => void;
  /** Re-enable live rendering after the last frame. */
  endDeterministicRun: () => void;
  /**
   * The canvas this lane renders into — what the exporter captures. A getter,
   * because the element is null until the lane mounts. The visualizer page
   * mounts more than one canvas (three-js is always mounted for context
   * preservation), so the lane that renders must name its own: querying the
   * DOM for "a canvas" captured whichever came first in document order, which
   * in 2D mode was the wrong one and produced a perfect-looking 300-frame
   * file of a blank canvas.
   */
  canvas: () => HTMLCanvasElement | null;
  /**
   * Can this path render a faithful frame *right now*? Optional: a path whose
   * frames do not depend on external data (the shader lane) omits it and is
   * always assumed ready. A path that does depend (the 2D lane, driven by the
   * analyzed timeline) implements it so the exporter refuses rather than
   * writing a file that looks fine and is blank.
   */
  readiness?: () => { ok: boolean; reason?: string };
}

/** True when the browser can actually encode the export profile. */
export async function canExportFrameAccurate(
  width?: number,
  height?: number,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const win = window as unknown as Record<string, unknown>;
  if (!win.VideoEncoder || !win.VideoFrame) return false;
  try {
    const support = await (
      win.VideoEncoder as {
        isConfigSupported: (c: object) => Promise<{ supported?: boolean }>;
      }
    ).isConfigSupported({
      codec: CODEC_STRINGS.avc,
      width: width ?? 1280,
      height: height ?? 720,
      bitrate: 8_000_000,
      framerate: 30,
    });
    return support?.supported === true;
  } catch {
    return false;
  }
}

/**
 * Export `durationSec` seconds at `fps` frames per second, driving the
 * visualizer manually. Returns the muxed MP4 buffer, or null when the
 * browser cannot encode.
 *
 * The frame count is exact: `round(durationSec * fps)` frames, each
 * timestamped at `i / fps` — never the wall clock.
 */
export async function exportFramesDeterministic(
  opts: FrameAccurateExportOptions,
): Promise<ArrayBuffer | null> {
  const {
    canvas,
    renderAtTime,
    beginDeterministicRun,
    endDeterministicRun,
    onProgress,
  } = opts;
  const fps = opts.fps ?? 30;
  const durationSec = opts.durationSec ?? 10;
  const bitrate = opts.bitrate ?? 8_000_000;
  const codec = opts.codec ?? "avc";
  const totalFrames = Math.max(1, Math.round(durationSec * fps));

  if (!(await canExportFrameAccurate(canvas.width, canvas.height))) {
    return null;
  }

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  try {
    beginDeterministicRun?.();
    for (let i = 0; i < totalFrames; i++) {
      const t = i / fps;
      await renderAtTime(t);
      // Timestamp from the frame index, not the wall clock: frame i
      // always lands at i/fps, so two runs produce identical streams.
      const keyFrame = i % Math.max(1, Math.round(fps * 2)) === 0;
      await source.add(t, 1 / fps, { keyFrame });
      onProgress?.(i + 1, totalFrames);
    }
  } finally {
    // The live rAF loop must resume even when a frame throws —
    // otherwise the visualizer goes dark after a failed export.
    endDeterministicRun?.();
    source.close();
  }
  await output.finalize();
  return target.buffer ?? null;
}
