import { useRef, useEffect, useMemo } from "react";
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
  const lastLineIdx = useRef(-1);
  const sectionStartTimes = useRef<Map<string, number>>(new Map());

  // Pre-compute section start times
  useEffect(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < lyrics.length; i++) {
      const section = lyrics[i].section;
      if (!map.has(section)) {
        map.set(section, lyrics[i].start);
      }
    }
    sectionStartTimes.current = map;
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

    // Binary search for current line (O(log n))
    let lo = 0, hi = lyrics.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const line = lyrics[mid];
      if (elapsed < line.start) hi = mid - 1;
      else if (elapsed >= line.end) lo = mid + 1;
      else { lo = mid; break; }
    }

    const idx = Math.max(0, Math.min(lo, lyrics.length - 1));
    const current = lyrics[idx];
    const isInRange = elapsed >= current.start && elapsed < current.end;

    // If not in range, find the closest line
    let currentIdx = idx;
    if (!isInRange) {
      if (elapsed < current.start && idx > 0) {
        currentIdx = idx - 1;
      } else if (elapsed >= current.end && idx < lyrics.length - 1) {
        // Check if we're between lines
        currentIdx = idx;
      }
    }

    const activeLine = lyrics[currentIdx];
    if (!activeLine || elapsed < activeLine.start) {
      return {
        currentLine: null,
        nextLine: lyrics[0] || null,
        lineProgress: 0,
        sectionProgress: 0,
        currentSection: lyrics[0]?.section || "VERSE",
        timeToNextPhrase: lyrics[0] ? Math.max(0, lyrics[0].start - elapsed) : 0,
        isPhraseStart: false,
        totalLines: lyrics.length,
        currentIndex: -1,
      };
    }

    const nextLine = lyrics[currentIdx + 1] || null;
    const lineDuration = activeLine.end - activeLine.start;
    const lineProgress = lineDuration > 0 ? (elapsed - activeLine.start) / lineDuration : 0;

    // Section progress
    const sectionStart = activeLine.start;
    let sectionEnd = activeLine.end;
    for (let i = currentIdx + 1; i < lyrics.length; i++) {
      if (lyrics[i].section === activeLine.section) {
        sectionEnd = lyrics[i].end;
      } else {
        break;
      }
    }
    const sectionDuration = sectionEnd - sectionStart;
    const sectionProgress = sectionDuration > 0 ? (elapsed - sectionStart) / sectionDuration : 0;

    // Phrase pulse detection
    const timeSinceStart = elapsed - activeLine.start;
    const isPhraseStart = timeSinceStart < 0.15;

    // Reset last line index if seeking backwards
    if (currentIdx < lastLineIdx.current) {
      lastLineIdx.current = currentIdx;
    }
    lastLineIdx.current = currentIdx;

    return {
      currentLine: activeLine,
      nextLine,
      lineProgress: Math.max(0, Math.min(1, lineProgress)),
      sectionProgress: Math.max(0, Math.min(1, sectionProgress)),
      currentSection: activeLine.section,
      timeToNextPhrase: nextLine ? Math.max(0, nextLine.start - elapsed) : Math.max(0, activeLine.end - elapsed),
      isPhraseStart,
      totalLines: lyrics.length,
      currentIndex: currentIdx,
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
 * Returns true briefly after each new lyric line starts.
 */
export function usePhraseTrigger(
  lyrics: LyricLine[],
  elapsed: number,
  windowMs: number = 150
): { isTriggering: boolean; currentIdx: number; progress: number } {
  const [state, setState] = useState({ isTriggering: false, currentIdx: -1, progress: 0 });

  useEffect(() => {
    if (!lyrics.length) return;

    // Find current line
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (elapsed >= lyrics[i].start && elapsed < lyrics[i].end) {
        idx = i;
        break;
      }
    }

    if (idx >= 0) {
      const line = lyrics[idx];
      const timeSinceStart = elapsed - line.start;
      const progress = (elapsed - line.start) / (line.end - line.start);
      setState({
        isTriggering: timeSinceStart < windowMs / 1000,
        currentIdx: idx,
        progress,
      });
    } else {
      setState({ isTriggering: false, currentIdx: -1, progress: 0 });
    }
  }, [lyrics, elapsed, windowMs]);

  return state;
}

import { useState } from "react";
