import { describe, it, expect } from "vitest";
import {
  parseLRC,
  parseWordLevelLRC,
  findCurrentLine,
  findCurrentWord,
  getWordProgress,
  type LyricLine,
} from "./lyricsSync";

/**
 * LRC parsing and lookup. Every timed visual (lyric highlighting, the LRC
 * overlay) reads from these, and the failure mode is silent: a mis-parsed
 * timestamp does not throw, it just highlights the wrong word at the wrong
 * time, which reads as "the sync is a bit off" rather than as a bug.
 */

const STANDARD_LRC = `[ti:Song]
[ar:Artist]
[00:12.50] Hello world
[00:15.00] Second line
[00:20.25] Third line`;

describe("parseLRC", () => {
  it("parses timestamps into seconds", () => {
    const lines = parseLRC(STANDARD_LRC);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ start: 12.5, text: "Hello world" });
    expect(lines[1]).toMatchObject({ start: 15, text: "Second line" });
    expect(lines[2]).toMatchObject({ start: 20.25, text: "Third line" });
  });

  it("sets each line's end to the next line's start", () => {
    const lines = parseLRC(STANDARD_LRC);
    expect(lines[0].end).toBe(lines[1].start);
    expect(lines[1].end).toBe(lines[2].start);
  });

  it("ignores ID tags such as [ti:] and [ar:]", () => {
    const lines = parseLRC(STANDARD_LRC);
    // Three lyric lines, not five: metadata tags carry no timestamp.
    expect(lines.some((l) => l.text.includes("Song"))).toBe(false);
    expect(lines.some((l) => l.text.includes("Artist"))).toBe(false);
  });

  it("skips timestamped lines with no text", () => {
    // An empty line between two lyrics must not become a blank highlight.
    const lines = parseLRC("[00:10.00]\n[00:12.00] Only this one");
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Only this one");
  });

  it("handles three-digit fractions as milliseconds", () => {
    const lines = parseLRC("[00:01.125] precise");
    // 125ms = 0.125s, so start is 1.125 - not 1 + 125/100.
    expect(lines[0].start).toBeCloseTo(1.125, 10);
  });

  it("returns an empty array for input with no timestamps", () => {
    expect(parseLRC("just some text\nand more")).toEqual([]);
    expect(parseLRC("")).toEqual([]);
  });

  it("keeps lines in file order even if timestamps are out of order", () => {
    // The parser preserves source order rather than sorting. Recorded so a
    // future sort is a deliberate change, not an accident that silently
    // reorders someone's lyrics.
    const lines = parseLRC("[00:20.00] late\n[00:10.00] early");
    expect(lines.map((l) => l.text)).toEqual(["late", "early"]);
  });
});

const WORD_LRC = `[00:12.00]<00:12.00> Hello <00:13.00> world <00:14.50> again`;

describe("parseWordLevelLRC", () => {
  it("parses per-word timings", () => {
    const lines = parseWordLevelLRC(WORD_LRC);
    expect(lines).toHaveLength(1);
    const words = lines[0].words!;
    expect(words.map((w) => w.word)).toEqual(["Hello", "world", "again"]);
    expect(words[0].start).toBeCloseTo(12, 10);
    expect(words[1].start).toBeCloseTo(13, 10);
    expect(words[2].start).toBeCloseTo(14.5, 10);
  });

  it("falls back to a plain lyric when a line has no word timings", () => {
    const lines = parseWordLevelLRC("[00:20.00] plain line");
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("plain line");
    expect(lines[0].words).toBeUndefined();
  });

  it("joins word text with single spaces", () => {
    const lines = parseWordLevelLRC(WORD_LRC);
    expect(lines[0].text).toBe("Hello world again");
  });
});

describe("findCurrentLine", () => {
  const lines = parseLRC(STANDARD_LRC);

  it("returns the line containing the time", () => {
    expect(findCurrentLine(lines, 13)?.text).toBe("Hello world");
  });

  it("returns null before the first and after the last line", () => {
    expect(findCurrentLine(lines, 0)).toBeNull();
    expect(findCurrentLine(lines, 999)).toBeNull();
  });

  it("treats the end boundary as exclusive", () => {
    // At exactly the next line's start the next line owns the display;
    // an inclusive end would briefly show both.
    expect(findCurrentLine(lines, 15)?.text).toBe("Second line");
  });

  it("returns null for an empty line list", () => {
    expect(findCurrentLine([], 5)).toBeNull();
  });
});

describe("findCurrentWord", () => {
  it("returns the word active at the given time", () => {
    const line = parseWordLevelLRC(WORD_LRC)[0];
    expect(findCurrentWord(line, 13.2)?.word.word).toBe("world");
  });

  it("returns null outside any word window", () => {
    const line = parseWordLevelLRC(WORD_LRC)[0];
    expect(findCurrentWord(line, 0)).toBeNull();
  });

  it("returns null for a line without word timings", () => {
    const line = parseLRC(STANDARD_LRC)[0];
    expect(findCurrentWord(line, 13)).toBeNull();
  });
});

describe("getWordProgress", () => {
  const line = parseWordLevelLRC(WORD_LRC)[0];

  it("is 0 before the word and 1 after it", () => {
    expect(getWordProgress(line, 11, 0)).toBe(0);
    expect(getWordProgress(line, 99, 0)).toBe(1);
  });

  it("ramps linearly through the word", () => {
    const word = line.words![0];
    const mid = (word.start + word.end) / 2;
    expect(getWordProgress(line, mid, 0)).toBeCloseTo(0.5, 10);
  });

  it("stays within 0..1", () => {
    for (const t of [0, 11.9, 12.1, 13.5, 100]) {
      for (let i = 0; i < line.words!.length; i++) {
        const p = getWordProgress(line, t, i);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns 0 for an out-of-range index or a line with no words", () => {
    expect(getWordProgress(line, 13, 99)).toBe(0);
    // A negative index used to throw rather than return 0.
    expect(getWordProgress(line, 13, -1)).toBe(0);
    expect(getWordProgress(line, 13, -5)).toBe(0);
    expect(getWordProgress(parseLRC(STANDARD_LRC)[0], 13, 0)).toBe(0);
  });

  it("never returns NaN for a zero-length word window", () => {
    // A zero span divides by zero; the guard must return a real number.
    const zeroSpan: LyricLine = {
      start: 0,
      end: 1,
      text: "x",
      words: [{ word: "x", start: 5, end: 5 }],
    };
    expect(getWordProgress(zeroSpan, 4, 0)).toBe(0);
    expect(getWordProgress(zeroSpan, 5, 0)).toBe(1);
    expect(Number.isNaN(getWordProgress(zeroSpan, 6, 0))).toBe(false);
  });
});