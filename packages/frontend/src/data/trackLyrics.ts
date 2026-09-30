/**
 * Typed loader for the track lyrics library in `public/track-lyrics/`.
 *
 * These are the user's own generated tracks (Suno / Flow Music) that have no
 * LRC files. The library exposes their lyric text, sectioned in song order,
 * so kinetic typography features have something real to work with.
 *
 * Timing note: the JSON carries no per-line timestamps. `toLyricLines()`
 * distributes lines evenly across the track duration as explicitly ESTIMATED
 * placeholder timing for previewing treatments — never for final renders.
 * When a real LRC or word-timing pass exists, it replaces the estimate.
 */
import type { LyricLine } from "../features/visualizer/components/KineticPresets";

export interface TrackLyricSection {
  name: string;
  lines: string[];
}

export type LyricsStatus = "complete" | "missing";

export interface TrackLyricsIndexEntry {
  id: string;
  title: string;
  file: string;
  lyricsStatus: LyricsStatus;
  bpm?: number;
  durationSec?: number;
  hasLrc: boolean;
  source?: string;
}

export interface TrackLyricsIndex {
  tracks: TrackLyricsIndexEntry[];
}

export interface TrackLyricsDoc {
  id: string;
  title: string;
  variant?: string;
  source?: string;
  bpm?: number;
  bpmNote?: string;
  key?: string;
  durationSec?: number;
  urls?: string[];
  hasLrc: boolean;
  lyricsStatus: LyricsStatus;
  provenance?: string;
  notes?: string;
  sections: TrackLyricSection[];
}

const BASE = "/track-lyrics";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`track-lyrics: ${res.status} fetching ${path}`);
  }
  return (await res.json()) as T;
}

/** Load the library manifest (lightweight: metadata only, no lyric text). */
export function fetchTrackLyricsIndex(): Promise<TrackLyricsIndex> {
  return fetchJson<TrackLyricsIndex>(`${BASE}/index.json`);
}

/** Load one track's full lyric document by its index entry (or id). */
export async function fetchTrackLyrics(
  entry: TrackLyricsIndexEntry,
): Promise<TrackLyricsDoc> {
  return fetchJson<TrackLyricsDoc>(`${BASE}/${entry.file}`);
}

export interface ToLyricLinesOptions {
  /** Seconds to spread lines across when the doc has no durationSec. */
  fallbackDurationSec?: number;
}

/**
 * Convert a lyric doc to `LyricLine[]` for kinetic typography components.
 *
 * Lines are distributed evenly across the track duration — ESTIMATED timing.
 * Empty docs (lyricsStatus "missing") yield an empty array.
 */
export function toLyricLines(
  doc: TrackLyricsDoc,
  opts: ToLyricLinesOptions = {},
): LyricLine[] {
  const flat: Array<{ text: string; section: string }> = [];
  for (const section of doc.sections ?? []) {
    for (const text of section.lines ?? []) {
      const trimmed = text.trim();
      if (trimmed) flat.push({ text: trimmed, section: section.name });
    }
  }
  if (flat.length === 0) return [];

  const duration = doc.durationSec ?? opts.fallbackDurationSec ?? 180;
  const perLine = duration / flat.length;
  return flat.map((line, i) => ({
    start: i * perLine,
    end: (i + 1) * perLine,
    text: line.text,
    section: line.section,
  }));
}
