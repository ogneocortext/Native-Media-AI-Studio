/**
 * Video frame extraction + keyframe selection for analyze.mjs --video.
 *
 * Screen-recording analysis needs TEMPORAL data, not a single snapshot:
 * overlapping layers, transition jank, and elements that collide only
 * mid-animation are invisible in stills. This module samples frames with
 * ffmpeg, then uses the same deterministic pixel-diff gate as compare
 * mode to pick the frames where the UI actually changed — first/last
 * plus the strongest change boundaries — so the VLM sees a compact
 * chronological strip instead of N near-identical images.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffImagesRegion } from './vision-common.mjs';

/** ffprobe metadata for a video file; null when ffprobe/ffmpeg missing or file unreadable. */
export function probeVideo(videoPath) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', videoPath],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const j = JSON.parse(out);
    const vs = (j.streams || []).find((s) => s.codec_type === 'video');
    if (!vs) return null;
    // avg_frame_rate arrives as "30000/1001" — reduce to a number.
    // Some containers report avg_frame_rate "0/0"; fall back to r_frame_rate.
    const rate = (r) => {
      const [num, den] = String(r || '0/1').split('/').map(Number);
      return num && den ? num / den : 0;
    };
    const fps = rate(vs.avg_frame_rate) || rate(vs.r_frame_rate);
    return {
      duration: parseFloat(j.format?.duration) || 0,
      width: vs.width || 0,
      height: vs.height || 0,
      fps,
    };
  } catch {
    return null;
  }
}

/**
 * Extract frames at `fps` into a fresh temp dir (caller owns cleanup).
 * Returns { dir, frames: [{path, index, t}] } where t is the estimated
 * source timestamp in seconds (fps filter picks nearest frame; ±half
 * interval). Returns null when ffmpeg is unavailable.
 */
export function extractFrames(videoPath, { fps = 1, maxFrames = 24 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-vid-'));
  const pattern = path.join(dir, 'f%04d.png');
  try {
    execFileSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-i', videoPath,
        '-vf', `fps=${fps}`, '-frames:v', String(maxFrames), pattern],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { error: `ffmpeg frame extraction failed: ${e.message}`, dir: null, frames: [] };
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  if (files.length === 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { error: 'ffmpeg produced no frames', dir: null, frames: [] };
  }
  return {
    dir,
    frames: files.map((f, i) => ({
      path: path.join(dir, f),
      index: i,
      t: +(i / fps).toFixed(2),
    })),
  };
}

/**
 * Pick up to `max` keyframes covering the video's state changes.
 * Always keeps first and last; interior picks are the boundaries with
 * the highest pixel-diff ratio, enforcing a minimum index gap so one
 * transition can't consume the whole budget. Returns
 * { keyframes, diffs } — diffs[i] describes the change between
 * frames[i] and frames[i+1] (changedRatio or a reason string).
 */
export async function selectKeyframes(frames, max = 6) {
  max = Math.max(2, Math.floor(max) || 6);
  if (frames.length <= max) {
    return { keyframes: frames, diffs: [] };
  }
  const diffs = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const d = await diffImagesRegion(frames[i].path, frames[i + 1].path);
    diffs.push({
      index: i,
      changedRatio: typeof d.changedRatio === 'number' ? d.changedRatio : 0,
      reason: d.reason,
    });
  }
  // Boundary i means "frame i+1 differs from frame i" — the interesting
  // frame is i+1. Score, sort desc, greedily enforce gap >= 2 indices.
  const scored = diffs
    .filter((d) => Number.isFinite(d.changedRatio) && d.changedRatio > 0)
    .sort((a, b) => b.changedRatio - a.changedRatio);
  const picked = new Set([0, frames.length - 1]);
  const minGap = 2;
  for (const d of scored) {
    if (picked.size >= max) break;
    const candidate = d.index + 1;
    let ok = true;
    for (const p of picked) {
      if (Math.abs(p - candidate) < minGap) { ok = false; break; }
    }
    if (ok) picked.add(candidate);
  }
  const keyframes = [...picked].sort((a, b) => a - b).map((i) => frames[i]);
  return { keyframes, diffs };
}
