/**
 * Canonical storyboard board shape, mirroring the backend store
 * (services/storyboard_boards.py) and the HyperFrames compiler's scene
 * contract (services/storyboard_hyperframes.py).
 *
 * Direction fields (camera_text, palette_text, typography, transition,
 * technique, blender) are authored data: they persist on the board and
 * ride the compile payload. The compiler currently renders only its
 * normalized subset; nothing here drops them.
 */

import type { CompileStoryboardRequest } from "../../services/api/types";

export interface BoardScene {
  id: string;
  section: string;
  title?: string;
  start: number;
  end: number;
  lyric_lines: string[];
  visual: string;
  description?: string;
  camera_text?: string;
  palette_text?: string;
  typography?: string;
  transition?: string;
  technique?: string;
  blender?: string;
  framing?: string;
  character_ref?: string;
  accent?: string;
  state?: string;
  panel_image?: string;
  [key: string]: unknown;
}

export interface StoryboardBoard {
  slug: string;
  title: string;
  track: string;
  duration: number;
  fps?: number | null;
  bpm?: number | null;
  key?: string | null;
  transitions?: unknown[];
  scenes: BoardScene[];
  source_format?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface StoryboardBoardSummary {
  slug: string;
  title: string;
  track: string;
  scene_count: number;
  duration: number | null;
  source: "saved" | "seed";
  updated_at?: string | null;
}

/** Seconds -> "M:SS" (one decimal place when the value is fractional). */
export function formatBoardTimecode(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  const rendered =
    Math.abs(seconds - Math.round(seconds)) < 0.001
      ? String(Math.round(seconds)).padStart(2, "0")
      : seconds.toFixed(1).padStart(4, "0");
  return `${minutes}:${rendered}`;
}

export function formatBoardDuration(start: number, end: number): string {
  const dur = Math.max(0, end - start);
  return `${Number.isInteger(dur) ? dur : dur.toFixed(1)}s`;
}

/**
 * The compile payload for a canonical board: every scene field the
 * compiler accepts rides along, instead of the title/description/timing
 * subset the Markdown path used to send.
 */
export function buildBoardCompilePayload(
  board: StoryboardBoard,
): CompileStoryboardRequest["storyboard"] {
  const scenes = board.scenes.map((scene) => {
    const out: CompileStoryboardRequest["storyboard"]["scenes"][number] = {
      id: scene.id,
      title: scene.title ?? scene.section,
      section: scene.section,
      description: scene.visual.length > 0 ? scene.visual : (scene.description ?? ""),
      start: scene.start,
      end: scene.end,
      lyric_lines: scene.lyric_lines,
    };
    for (const field of [
      "camera_text",
      "palette_text",
      "typography",
      "transition",
      "technique",
      "blender",
      "framing",
      "character_ref",
      "accent",
      "state",
      "panel_image",
    ] as const) {
      if (scene[field] !== undefined && scene[field] !== "") {
        (out as Record<string, unknown>)[field] = scene[field];
      }
    }
    return out;
  });
  const payload: CompileStoryboardRequest["storyboard"] = {
    track: board.track || board.title,
    title: board.title,
    duration:
      board.duration || board.scenes.reduce((max, scene) => Math.max(max, scene.end), 0),
    scenes,
  };
  if (typeof board.bpm === "number") payload.bpm = board.bpm;
  return payload;
}
