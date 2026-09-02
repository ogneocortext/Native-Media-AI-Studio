import { useEffect, useMemo, useRef, useState } from "react";
import type { LyricLine } from "./components/LyricOverlay";

export interface PhraseMarker {
  time: number;
  line: LyricLine;
  index: number;
}

export interface LrcSyncData {
  /** Current lyric line based on precise LRC timing */
  currentLine: LyricLine | null;
  /** Next lyric line for preview */
  nextLine: LyricLine | null;
  /** Progress through current line (0-1) */
  lineProgress: number;
  /** Progress through current section (0-1) */
  sectionProgress: number;
  /** Current section name */
  currentSection: string;
  /** Time until next phrase change (seconds) */
  timeToNextPhrase: number;
  /** Whether we're in the first 150ms of a new line (for phrase pulse) */
  isPhraseStart: boolean;
  /** Total number of lyric lines */
  totalLines: number;
  /** Current line index */
  currentIndex: number;
}

/**
 * Hook that provides precise LRC timing data for visual synchronization.
 * Uses binary search for O(log n) lookups even with large lyric files.
 */
export function useLrcSync(lyrics: LyricLine[], elapsed: number): LrcSyncData {
  const sectionBounds = useMemo(() => {
    const map = new Map<string, { start: number; end: number }>();
    for (const line of lyrics) {
      const sec = line.section || "VERSE";
      const cur = map.get(sec);
      if (!cur) map.set(sec, { start: line.start, end: line.end });
      else cur.end = Math.max(cur.end, line.end);
    }
    return map;
  }, [lyrics]);

  return useMemo(() => {
    if (!lyrics.length) {
      return {
        currentLine: null,
        nextLine: null,
        lineProgress: 0,
        sectionProgress: 0,
        currentSection: "VERSE",
        timeToNextPhrase: 0,
        isPhraseStart: false,
        totalLines: 0,
        currentIndex: -1,
      };
    }

    // Binary search for current line (O(log n)) — return null in gaps
    let lo = 0, hi = lyrics.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const line = lyrics[mid];
      if (elapsed < line.start) hi = mid - 1;
      else if (elapsed >= line.end) lo = mid + 1;
      else { found = mid; break; }
    }
    if (found === -1) {
      // Gap or before first line — show next line preview, no stale lyric
      let nextIdx = lo;
      if (nextIdx < 0) nextIdx = 0;
      if (nextIdx >= lyrics.length) {
        return {
          currentLine: null, nextLine: null, lineProgress: 0, sectionProgress: 0,
          currentSection: lyrics[lyrics.length - 1]?.section || "VERSE",
          timeToNextPhrase: 0, isPhraseStart: false, totalLines: lyrics.length, currentIndex: -1,
        };
      }
      const nextLine = lyrics[nextIdx] || null;
      return {
        currentLine: null, nextLine, lineProgress: 0, sectionProgress: 0,
        currentSection: nextLine?.section || lyrics[0]?.section || "VERSE",
        timeToNextPhrase: nextLine ? Math.max(0, nextLine.start - elapsed) : 0,
        isPhraseStart: false, totalLines: lyrics.length, currentIndex: -1,
      };
    }
    const currentIdx = found;
    const activeLine = lyrics[currentIdx];
    const nextLine = lyrics[currentIdx + 1] || null;
    const lineDuration = activeLine.end - activeLine.start;
    const lineProgress = lineDuration > 1e-6 ? (elapsed - activeLine.start) / lineDuration : 0;
    // Section progress using precomputed bounds (handles non-contiguous sections)
    const bounds = sectionBounds.get(activeLine.section || "VERSE");
    const sectionStart = bounds?.start ?? activeLine.start;
    const sectionEnd = bounds?.end ?? activeLine.end;
    const sectionDuration = sectionEnd - sectionStart;
    const sectionProgress = sectionDuration > 1e-6 ? (elapsed - sectionStart) / sectionDuration : 0;
    const isPhraseStart = elapsed - activeLine.start < 0.15;
    return {
      currentLine: activeLine, nextLine,
      lineProgress: Math.max(0, Math.min(1, lineProgress)),
      sectionProgress: Math.max(0, Math.min(1, sectionProgress)),
      currentSection: activeLine.section,
      timeToNextPhrase: nextLine ? Math.max(0, nextLine.start - elapsed) : Math.max(0, activeLine.end - elapsed),
      isPhraseStart, totalLines: lyrics.length, currentIndex: currentIdx,
    };
  }, [lyrics, elapsed]);
}

/**
 * Hook that provides phrase markers (line start times) for beat-synchronized effects.
 * Visual effects can use these to trigger on musical phrase boundaries.
 */
export function usePhraseMarkers(lyrics: LyricLine[]): PhraseMarker[] {
  return useMemo(() => {
    return lyrics.map((line, index) => ({
      time: line.start,
      line,
      index,
    }));
  }, [lyrics]);
}

/**
 * Hook that detects phrase boundaries for triggering visual events.
 * Returns true briefly after each new lyric line starts. Memoized — no extra render.
 */
export function usePhraseTrigger(
  lyrics: LyricLine[],
  elapsed: number,
  windowMs: number = 150,
): { isTriggering: boolean; currentIdx: number; progress: number } {
  return useMemo(() => {
    if (!lyrics.length) return { isTriggering: false, currentIdx: -1, progress: 0 };
    let lo = 0, hi = lyrics.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const l = lyrics[mid];
      if (elapsed < l.start) hi = mid - 1;
      else if (elapsed >= l.end) lo = mid + 1;
      else { found = mid; break; }
    }
    if (found === -1) return { isTriggering: false, currentIdx: -1, progress: 0 };
    const line = lyrics[found];
    const dur = line.end - line.start;
    const progress = dur > 1e-6 ? (elapsed - line.start) / dur : 0;
    return { isTriggering: elapsed - line.start < windowMs / 1000, currentIdx: found, progress: Math.max(0, Math.min(1, progress)) };
  }, [lyrics, elapsed, windowMs]);
}
