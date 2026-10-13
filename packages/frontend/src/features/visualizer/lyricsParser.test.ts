import { describe, it, expect } from "vitest";
import {
  parseLrcContent,
  parseLrc,
  parseLyricsFromNormalizedCsv,
  parseLyricsFromCsv,
  generateTimedLyrics,
} from "./lyricsParser";

/**
 * Lyric parsing (LRC + normalized CSV). A mis-parse here never throws — it
 * shifts a line's start/end or drops its section, which surfaces as "the lyric
 * highlight is a beat off" or "the whole verse shows as one line". These pin
 * timestamp→seconds conversion (including the centisecond/millisecond divisor
 * and the [offset:] shift), standalone/embedded section markers, the metadata
 * skip-list, fuzzy track matching in CSV, and the duration distribution in
 * generateTimedLyrics.
 */

describe("parseLrcContent", () => {
  it("parses timestamps and skips metadata tags", () => {
    const lrc = ["[ti:Title]", "[ar:Artist]", "[00:12.50]Hello world", "[00:15.750]Second"].join("\n");
    const lines = parseLrcContent(lrc);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ start: 12.5, text: "Hello world" });
    // 3-digit fraction is milliseconds: .750 → 0.75s.
    expect(lines[1]).toMatchObject({ start: 15.75, text: "Second" });
  });

  it("applies a global [offset:] shift in milliseconds", () => {
    const lrc = ["[offset:250]", "[00:10.00]Shifted"].join("\n");
    expect(parseLrcContent(lrc)[0].start).toBeCloseTo(10.25, 6);
    // Negative offsets clamp at zero rather than going negative.
    const neg = parseLrcContent(["[offset:-99999]", "[00:01.00]Clamped"].join("\n"));
    expect(neg[0].start).toBe(0);
  });

  it("tracks section markers for the lines that follow", () => {
    // A section applies only once a [Marker] line sets it; the default is
    // VERSE, so the first line below needs an explicit [Intro].
    const lrc = [
      "[Intro]",
      "[00:00.00]Intro line",
      "[Chorus]",
      "[00:20.00]Chorus line",
      "[Pre-Chorus]",
      "[00:30.00]Pre line",
    ].join("\n");
    const lines = parseLrcContent(lrc);
    expect(lines[0].section).toBe("INTRO");
    expect(lines[1].section).toBe("CHORUS");
    expect(lines[2].section).toBe("PRE-CHORUS");
  });

  it("expands multiple timestamps on one line into separate entries", () => {
    const lines = parseLrcContent(["[00:05.00][00:45.00]Refrain"].join("\n"));
    expect(lines.map((l) => l.start)).toEqual([5, 45]);
    expect(lines.every((l) => l.text === "Refrain")).toBe(true);
  });

  it("returns empty for blank or metadata-only input", () => {
    expect(parseLrcContent("")).toEqual([]);
    expect(parseLrcContent("[ti:Only metadata]")).toEqual([]);
  });
});

describe("parseLrc", () => {
  it("sets each single-timestamp line's end to start + 4s", () => {
    // parseLrc derives end per physical line from its own timestamp list, so a
    // one-timestamp line ends +4s later; it does NOT chain to the next line's
    // start (that chaining lives in lyricsSync.parseLRC, a different parser).
    const lrc = ["[00:10.00]First", "[00:20.00]Second"].join("\n");
    const lines = parseLrc(lrc);
    expect(lines).toHaveLength(2);
    expect(lines[0].end).toBe(14);
    expect(lines[1].end).toBe(24);
  });

  it("chains multiple timestamps on one line to each other", () => {
    const lines = parseLrc("[00:05.00][00:45.00]Refrain");
    expect(lines).toHaveLength(2);
    expect(lines[0].end).toBe(45);
    expect(lines[1].end).toBe(49);
  });

  it("skips the full metadata tag list including offset", () => {
    const lrc = ["[ar:A]", "[ti:T]", "[al:L]", "[offset:100]", "[by:x]", "[00:01.00]Real"].join("\n");
    const lines = parseLrc(lrc);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Real");
  });

  it("applies an embedded [Section] marker to following lines", () => {
    const lrc = ["[00:10.00]Verse line", "[00:33.92][Drop]", "[00:35.00]Drop line"].join("\n");
    const lines = parseLrc(lrc);
    expect(lines[0].section).toBe("VERSE");
    // The marker line itself carries text, but must set the section used by
    // every line after it.
    expect(lines[lines.length - 1].section).toBe("DROP");
  });

  it("returns empty for blank input", () => {
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("   ")).toEqual([]);
  });
});

describe("parseLyricsFromNormalizedCsv", () => {
  const CSV = [
    "track_name,section,start_time,end_time,text",
    "song a,VERSE,0.0,2.0,Hello",
    "song a,CHORUS,2.0,4.0,Chorus line",
    "other track,VERSE,0.0,2.0,Wrong track",
  ].join("\n");

  it("fuzzy-matches the requested track and ignores other rows", () => {
    // "Song A (live)" cleans to "song a" and must match the csv track name.
    const lines = parseLyricsFromNormalizedCsv(CSV, "Song A (live)");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ start: 0, end: 2, text: "Hello", section: "VERSE" });
    expect(lines[1].text).toBe("Chorus line");
  });

  it("handles a quoted data field containing a comma", () => {
    // The header uses the documented unquoted columns (it is read with a naive
    // split); only the data rows are quote-aware via parseCsvLine, so a text
    // field with an embedded comma must survive intact.
    const quoted = [
      "track_name,section,start_time,end_time,text",
      'song a,VERSE,0.0,2.0,"Hello, world"',
    ].join("\n");
    const lines = parseLyricsFromNormalizedCsv(quoted, "song a");
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Hello, world");
  });

  it("returns empty for an invalid header or empty inputs", () => {
    expect(parseLyricsFromNormalizedCsv("a,b,c\n1,2,3", "song a")).toEqual([]);
    expect(parseLyricsFromNormalizedCsv("", "song a")).toEqual([]);
    expect(parseLyricsFromNormalizedCsv(CSV, "")).toEqual([]);
  });

  it("drops rows whose start or end is not a number", () => {
    const bad = [
      "track_name,section,start_time,end_time,text",
      "song a,VERSE,not-a-number,2.0,Bad",
      "song a,VERSE,1.0,2.0,Good",
    ].join("\n");
    const lines = parseLyricsFromNormalizedCsv(bad, "song a");
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Good");
  });
});

describe("generateTimedLyrics", () => {
  it("distributes duration across lines split by section markers", () => {
    const text = 'Verse ""aaa bbb"" Chorus ""ccc ddd""';
    const lines = generateTimedLyrics(text, 10);
    expect(lines).toHaveLength(2);
    expect(lines[0].section).toBe("VERSE");
    expect(lines[0].start).toBe(0);
    expect(lines[0].end).toBe(5);
    expect(lines[1].section).toBe("CHORUS");
    expect(lines[1].end).toBe(10);
  });

  it("splits a theme+quoted block into a single VERSE", () => {
    const lines = generateTimedLyrics('Theme: love. ""line one / line two""', 8);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.section === "VERSE")).toBe(true);
    expect(lines.map((l) => l.text)).toEqual(["line one", "line two"]);
    expect(lines[1].end).toBe(8);
  });

  it("returns empty for text too short to contain lyrics", () => {
    expect(generateTimedLyrics("short", 10)).toEqual([]);
    expect(generateTimedLyrics("", 10)).toEqual([]);
  });
});

describe("parseLyricsFromCsv", () => {
  it("prefers the normalized format when it matches", () => {
    const normalized = [
      "track_name,section,start_time,end_time,text",
      "song a,VERSE,0.0,2.0,Hello",
    ].join("\n");
    // duration is ignored when the normalized parse succeeds.
    expect(parseLyricsFromCsv(normalized, "song a", 99)).toHaveLength(1);
  });

  it("falls back to the legacy format when normalized finds nothing", () => {
    const legacy = [
      '"1","Song A","a prompt","""verse line one / verse line two"""',
    ].join("\n");
    const lines = parseLyricsFromCsv(legacy, "Song A", 10);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.section === "VERSE")).toBe(true);
  });
});
