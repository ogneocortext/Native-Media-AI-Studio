/**
 * LRC (Lyric) format parser and sync engine.
 *
 * Standard LRC format:
 *   [mm:ss.xx] lyric text
 *   [00:12.50] Hello world
 *
 * Word-level LRC (karaoke):
 *   [mm:ss.xx]<mm:ss.xx> word1 <mm:ss.xx> word2
 *   [00:12.50]<00:12.50> Hello <00:13.00> world
 */

export interface LyricLine {
  start: number; // seconds
  end: number;   // seconds
  text: string;
  words?: WordTiming[];
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/**
 * Parse standard LRC format into structured lyric lines.
 */
export function parseLRC(lrcContent: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const timestampRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

  for (const line of lrcContent.split('\n')) {
    const matches = [...line.matchAll(timestampRegex)];
    if (matches.length === 0) continue;

    // Get text after the last timestamp
    const lastMatch = matches[matches.length - 1];
    const text = line.slice(lastMatch.index! + lastMatch[0].length).trim();
    if (!text) continue;

    // Use the first timestamp as the line start time
    const minutes = parseInt(matches[0][1]);
    const seconds = parseInt(matches[0][2]);
    const centis = matches[0][3].length === 2
      ? parseInt(matches[0][3])
      : parseInt(matches[0][3]) / 10;
    const start = minutes * 60 + seconds + centis / 100;

    lines.push({ start, end: start + 5, text }); // end will be updated
  }

  // Update end times based on next line's start
  for (let i = 0; i < lines.length; i++) {
    if (i < lines.length - 1) {
      lines[i].end = lines[i + 1].start;
    }
  }

  return lines;
}

/**
 * Parse word-level LRC (karaoke format) with per-word timestamps.
 */
export function parseWordLevelLRC(lrcContent: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const lineTimestampRegex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  const wordTimestampRegex = /<(\d{2}):(\d{2})\.(\d{2,3})>\s*([^<]+)/g;

  for (const line of lrcContent.split('\n')) {
    const lineMatch = line.match(lineTimestampRegex);
    if (!lineMatch) continue;

    const minutes = parseInt(lineMatch[1]);
    const seconds = parseInt(lineMatch[2]);
    const centis = lineMatch[3].length === 2
      ? parseInt(lineMatch[3])
      : parseInt(lineMatch[3]) / 10;
    const lineStart = minutes * 60 + seconds + centis / 100;

    // Extract word timings
    const words: WordTiming[] = [];
    const wordText: string[] = [];

    const wordLine = line.slice(lineMatch.index! + lineMatch[0].length);
    for (const match of wordLine.matchAll(wordTimestampRegex)) {
      const wMin = parseInt(match[1]);
      const wSec = parseInt(match[2]);
      const wCent = match[3].length === 2
        ? parseInt(match[3])
        : parseInt(match[3]) / 10;
      const wStart = wMin * 60 + wSec + wCent / 100;
      const wText = match[4].trim();

      words.push({ word: wText, start: wStart, end: wStart + 0.5 });
      wordText.push(wText);
    }

    if (words.length > 0) {
      const text = wordText.join(' ');
      const end = words[words.length - 1].end;
      lines.push({ start: lineStart, end, text, words });
    } else {
      // Fallback to standard LRC parsing
      const text = line.slice(lineMatch.index! + lineMatch[0].length).trim();
      if (text) {
        lines.push({ start: lineStart, end: lineStart + 5, text });
      }
    }
  }

  // Update end times for standard lines
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].end === lines[i].start + 5 && i < lines.length - 1) {
      lines[i].end = lines[i + 1].start;
    }
  }

  return lines;
}

/**
 * Find the lyric line that should be displayed at a given time.
 */
export function findCurrentLine(lines: LyricLine[], time: number): LyricLine | null {
  for (const line of lines) {
    if (time >= line.start && time < line.end) {
      return line;
    }
  }
  return null;
}

/**
 * Find the current word within a line at a given time.
 */
export function findCurrentWord(line: LyricLine, time: number): { word: WordTiming; index: number } | null {
  if (!line.words) return null;

  for (let i = 0; i < line.words.length; i++) {
    if (time >= line.words[i].start && time < line.words[i].end) {
      return { word: line.words[i], index: i };
    }
  }
  return null;
}

/**
 * Calculate highlight progress for word-by-word animation.
 * Returns 0-1 for how much of the word has been "sung".
 */
export function getWordProgress(line: LyricLine, time: number, index: number): number {
  if (!line.words || index >= line.words.length) return 0;
  const word = line.words[index];
  if (time < word.start) return 0;
  if (time >= word.end) return 1;
  return (time - word.start) / (word.end - word.start);
}
