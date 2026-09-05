import type { LyricLine } from "./components/KineticPresets";

/**
 * Parse lyrics from the normalized CSV format.
 * CSV format: track_name,section,start_time,end_time,text
 *
 * This is the preferred format - each lyric line has its own row
 * with explicit timing.
 */
export function parseLyricsFromNormalizedCsv(
  csvContent: string,
  trackName: string,
): LyricLine[] {
  if (!csvContent || !trackName) return [];

  // Normalize line endings and split
  const lines = csvContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  if (lines.length < 2) return [];

  // Find the header row to determine column indices
  const header = lines[0].split(",");
  const trackIdx = header.indexOf("track_name");
  const sectionIdx = header.indexOf("section");
  const startIdx = header.indexOf("start_time");
  const endIdx = header.indexOf("end_time");
  const textIdx = header.indexOf("text");

  if (
    trackIdx < 0 ||
    sectionIdx < 0 ||
    startIdx < 0 ||
    endIdx < 0 ||
    textIdx < 0
  ) {
    return []; // Invalid format
  }

  const cleanTrackName = trackName
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, "")
    .trim();
  const result: LyricLine[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line (handle quoted fields)
    const fields = parseCsvLine(line);
    if (
      fields.length <= Math.max(trackIdx, sectionIdx, startIdx, endIdx, textIdx)
    )
      continue;

    const csvName = fields[trackIdx]
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, "")
      .trim();

    // Fuzzy match
    if (cleanTrackName.includes(csvName) || csvName.includes(cleanTrackName)) {
      const start = parseFloat(fields[startIdx]);
      const end = parseFloat(fields[endIdx]);
      const text = fields[textIdx];
      const section = fields[sectionIdx];

      if (!isNaN(start) && !isNaN(end) && text) {
        result.push({ start, end, text, section });
      }
    }
  }

  return result;
}

/**
 * Parse LRC timed lyrics format.
 * Format: [mm:ss.xx]lyric text
 * Optional metadata: [ti:Title], [ar:Artist], [al:Album]
 */
export function parseLrcContent(lrcContent: string): LyricLine[] {
  if (!lrcContent) return [];

  const lines = lrcContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const result: LyricLine[] = [];
  let currentSection = "VERSE";
  let offsetMs = 0;
  const offsetMatch = lrcContent.match(/\[offset:\s*([+-]?\d+)\]/i);
  if (offsetMatch) offsetMs = parseInt(offsetMatch[1], 10) || 0;

  const sectionFor = (m: string) => {
    const marker = m.toLowerCase().trim();
    if (marker.includes("intro")) return "INTRO";
    if (marker.startsWith("verse")) return "VERSE";
    if (marker.includes("final") && marker.includes("drop")) return "FINAL DROP";
    if (marker.includes("final") && marker.includes("chorus")) return "FINAL CHORUS";
    if (marker.includes("pre-chorus") || marker.includes("pre chorus")) return "PRE-CHORUS";
    if (marker.includes("chorus")) return "CHORUS";
    if (marker.includes("bridge")) return "BRIDGE";
    if (marker.includes("drop")) return "DROP";
    if (marker.includes("breakdown")) return "BREAKDOWN";
    if (marker.includes("build-up") || marker.includes("build up") || marker.includes("buildup")) return "BUILD-UP";
    if (marker.includes("instrumental") || marker.includes("interlude") || marker.includes("solo")) return "INSTRUMENTAL";
    if (marker.includes("outro")) return "OUTRO";
    if (marker.includes("hook") || marker.includes("refrain")) return "CHORUS";
    return marker.toUpperCase();
  };

  const tsRegex = /\[(\d{1,3}):(\d{2})[.:](\d{1,3})\]/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\[(ti|ar|al|length|by|re|ve):/i.test(line)) continue;
    if (/^\[offset:/i.test(line)) continue;

    // Standalone section marker like [Chorus] (no timestamp)
    const standaloneSection = line.match(/^\[(Intro|Verse\s*\d*|Chorus|Bridge|Drop|Breakdown|Build-?Up|Pre-Chorus|Final\s*(Chorus|Drop)|Outro|Instrumental|Interlude|Hook|Refrain|Solo)\]$/i);
    if (standaloneSection) {
      currentSection = sectionFor(standaloneSection[1]);
      continue;
    }

    // Collect all timestamps on this line
    const stamps = [...line.matchAll(tsRegex)];
    if (stamps.length === 0) continue;
    let text = line.replace(tsRegex, "").trim();
    // Word-level LRC: support <mm:ss.xx> inline tags (enhanced LRC) and 2026 karaoke style
    // e.g. "[00:05.80]Blue <00:06.10>light's <00:06.40>the" or "[00:05.80]word [00:06.10]word"
    const wordTagRegex = /<(\d{1,3}):(\d{2})[.:](\d{1,3})>/g;
    const inlineWordTags = [...text.matchAll(wordTagRegex)];
    // Section marker embedded as text after timestamps: [00:12.00][Chorus]
    const embeddedSection = text.match(/^\[(Intro|Verse\s*\d*|Chorus|Bridge|Drop|Breakdown|Build-?Up|Pre-Chorus|Final\s*(Chorus|Drop)|Outro|Instrumental|Interlude|Hook|Refrain|Solo)\]$/i);
    if (embeddedSection) {
      currentSection = sectionFor(embeddedSection[1]);
      continue;
    }
    if (!text) continue;

    // If inline word tags exist, parse as word-level timing
    if (inlineWordTags.length > 0) {
      const lineStartMins = parseInt(stamps[0][1], 10);
      const lineStartSecs = parseInt(stamps[0][2], 10);
      const lineStartFrac = stamps[0][3];
      const lineStartDiv = lineStartFrac.length === 3 ? 1000 : lineStartFrac.length === 1 ? 10 : 100;
      const lineStart = lineStartMins * 60 + lineStartSecs + parseInt(lineStartFrac, 10) / lineStartDiv + offsetMs / 1000;
      // Split text by word tags to reconstruct words with timing
      const words: Array<{ word: string; start: number; end: number }> = [];
      let lastTime = Math.max(0, lineStart);
      // First word is before first <tag>
      const firstTagIdx = text.indexOf("<");
      let firstWord = firstTagIdx > 0 ? text.slice(0, firstTagIdx).trim() : "";
      if (firstWord) words.push({ word: firstWord, start: lastTime, end: lastTime + 0.4 });
      for (const wt of inlineWordTags) {
        const wMins = parseInt(wt[1], 10);
        const wSecs = parseInt(wt[2], 10);
        const wFrac = wt[3];
        const wDiv = wFrac.length === 3 ? 1000 : wFrac.length === 1 ? 10 : 100;
        const wStart = wMins * 60 + wSecs + parseInt(wFrac, 10) / wDiv + offsetMs / 1000;
        // Text between this tag and next tag (or end) is the word
        const tagEnd = (wt as any).index! + wt[0].length;
        const nextTagIdx = text.indexOf("<", tagEnd);
        const wordText = (nextTagIdx >= 0 ? text.slice(tagEnd, nextTagIdx) : text.slice(tagEnd)).trim().split(/\s+/)[0] || "";
        if (wordText) {
          // Close previous word's end at this word's start
          if (words.length > 0) words[words.length - 1].end = Math.max(words[words.length - 1].start + 0.2, wStart);
          words.push({ word: wordText, start: Math.max(0, wStart), end: Math.max(0, wStart) + 0.5 });
          lastTime = wStart;
        }
      }
      // Fix last word end to next line's start or +1.2s
      if (words.length > 0) {
        // Derive line end from next timestamp in file (peek ahead) or default
        const lineText = words.map(w => w.word).join(" ");
        const lastWordEnd = words[words.length - 1].start + 0.6;
        result.push({ start: Math.max(0, lineStart), end: lastWordEnd, text: lineText, section: currentSection, words } as any);
      }
      continue;
    }

    for (const m of stamps) {
      const mins = parseInt(m[1], 10);
      const secs = parseInt(m[2], 10);
      const fracStr = m[3];
      const div = fracStr.length === 3 ? 1000 : fracStr.length === 1 ? 10 : 100;
      const start = mins * 60 + secs + parseInt(fracStr, 10) / div + offsetMs / 1000;
      const clamped = Math.max(0, start);
      result.push({ start: clamped, end: clamped + 2, text, section: currentSection });
    }
  }

  result.sort((a, b) => a.start - b.start);
  // Recalculate end times with caps to avoid unreadably short/long lines
  for (let i = 0; i < result.length - 1; i++) {
    const gap = result[i + 1].start - result[i].start;
    let end = result[i + 1].start;
    if (gap > 0.5) end = Math.min(result[i].start + 6, result[i + 1].start - 0.2);
    if (end < result[i].start + 1.5) end = Math.min(result[i + 1].start, result[i].start + 1.5);
    result[i].end = end;
  }
  if (result.length > 0) {
    const last = result[result.length - 1];
    last.end = last.start + 3;
  }

  return result;
}

/**
 * Parse a single LRC line, handling quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);

  return fields;
}

/**
 * Parse lyrics from CSV content for a given track name.
 * Tries normalized format first, falls back to legacy format.
 */
export function parseLyricsFromCsv(
  csvContent: string,
  trackName: string,
  duration: number,
): LyricLine[] {
  // Try normalized format first
  const normalized = parseLyricsFromNormalizedCsv(csvContent, trackName);
  if (normalized.length > 0) return normalized;

  // Fall back to legacy format parsing
  return parseLyricsFromLegacyCsv(csvContent, trackName, duration);
}

/**
 * Parse lyrics from the legacy CSV format.
 * Legacy format: "#","Track Name","Prompt","Lyrics (key excerpt/theme)"
 */
function parseLyricsFromLegacyCsv(
  csvContent: string,
  trackName: string,
  duration: number,
): LyricLine[] {
  if (!csvContent || !trackName) return [];

  const lines = csvContent.split("\n");
  const cleanTrackName = trackName
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, "")
    .trim();

  for (const line of lines) {
    const match = line.match(/^"\d+","([^"]+)"/);
    if (!match) continue;

    const csvName = match[1];
    const cleanCsvName = csvName
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, "")
      .trim();

    // Fuzzy match: track name contains CSV name or vice versa
    if (
      cleanTrackName.includes(cleanCsvName) ||
      cleanCsvName.includes(cleanTrackName)
    ) {
      // Extract lyrics from the 4th column - everything after the 3rd comma-separated field
      const lyricsColMatch = line.match(/^"\d+","[^"]*","[^"]*","(.*)"$/);
      if (!lyricsColMatch) continue;

      const lyricsText = lyricsColMatch[1];
      return generateTimedLyrics(lyricsText, duration);
    }
  }

  return [];
}

/**
 * Generate timed lyric lines from lyrics text with section markers.
 *
 * Handles two formats:
 * 1. Section markers: 'Structure: Verse–Verse–Pre-Chorus–Chorus(""lyric..."")–Breakdown–Build-Up–Verse–Final Chorus'
 * 2. Theme + quoted: 'Theme: description. ""lyric 1 / lyric 2 / lyric 3""'
 */
export function generateTimedLyrics(
  lyricsText: string,
  duration: number,
): LyricLine[] {
  if (!lyricsText || lyricsText.length < 10) return [];

  const sections: { section: string; lines: string[] }[] = [];
  let currentSection = "INTRO";
  let currentLines: string[] = [];

  // Check if this is format 1 (has explicit section markers)
  const hasSectionMarkers =
    /(?:VERSE|CHORUS|BRIDGE|INTRO|FINAL\s*Chorus|PRE-CHORUS|BREAKDOWN|BUILD-UP)/i.test(
      lyricsText,
    );

  if (hasSectionMarkers) {
    // Parse lyrics text into sections
    // Split on section markers: Verse, Chorus, Bridge, Intro, Final Chorus, Pre-Chorus, Breakdown, Build-Up
    const parts = lyricsText.split(
      /(Verse\s*\d*|Chorus|Bridge|Intro|Final\s*Chorus|Pre-Chorus|Breakdown|Build-Up)/gi,
    );

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]?.trim();
      if (!part) continue;

      // Check if this part is a section marker
      const sectionMatch = part.match(
        /^(Verse\s*\d*|Chorus|Bridge|Intro|Final\s*Chorus|Pre-Chorus|Breakdown|Build-Up)$/i,
      );
      if (sectionMatch) {
        if (currentLines.length) {
          sections.push({ section: currentSection, lines: [...currentLines] });
          currentLines = [];
        }
        // Normalize section name
        const marker = sectionMatch[1].toLowerCase();
        if (marker.startsWith("verse")) currentSection = "VERSE";
        else if (marker.includes("final")) currentSection = "FINAL CHORUS";
        else if (marker.includes("pre-chorus")) currentSection = "PRE-CHORUS";
        else if (marker.includes("breakdown")) currentSection = "BREAKDOWN";
        else if (marker.includes("build-up")) currentSection = "BUILD-UP";
        else currentSection = marker.toUpperCase();
      } else if (part.length > 5) {
        // Extract actual lyric lines from this section
        // Lyric lines are typically in double-quotes: ""lyric text""
        const extracted = part
          .split(/""/)
          .map((s) => s.replace(/"/g, "").trim())
          .filter(
            (s) =>
              s.length > 3 &&
              !s.toLowerCase().includes("structure:") &&
              !s.toLowerCase().includes("theme:"),
          );

        if (extracted.length > 0) {
          currentLines.push(...extracted);
        }
      }
    }
  } else {
    // Format 2: Theme + quoted lyrics
    // Extract quoted text between "" and ""
    const quotedMatch = lyricsText.match(/"{2}(.+?)"{2}/);
    if (quotedMatch) {
      const quotedText = quotedMatch[1];
      // Split by / or – or newlines
      const lyricLines = quotedText
        .split(/[\/–—\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 2);

      if (lyricLines.length > 0) {
        sections.push({ section: "VERSE", lines: lyricLines });
      }
    } else {
      // Fallback: just split by common separators
      const lyricLines = lyricsText
        .split(/[\/–—\n]/)
        .map((s) => s.trim())
        .filter(
          (s) =>
            s.length > 5 &&
            !s.toLowerCase().startsWith("theme:") &&
            !s.toLowerCase().startsWith("structure:"),
        );

      if (lyricLines.length > 0) {
        sections.push({ section: "VERSE", lines: lyricLines });
      }
    }
  }

  // Don't forget the last section
  if (currentLines.length) {
    sections.push({ section: currentSection, lines: [...currentLines] });
  }

  if (!sections.length) return [];

  // Distribute time across all lines
  const totalLines = sections.reduce((sum, s) => sum + s.lines.length, 0);
  if (totalLines === 0) return [];

  const timePerLine = duration / totalLines;
  const result: LyricLine[] = [];
  for (let idx = 0; idx < sections.reduce((n,s)=>n+s.lines.length,0); idx++) {
    // distribute exactly without accumulated rounding error
  }
  let time = 0;
  let lineIdx = 0;
  for (const section of sections) {
    for (const line of section.lines) {
      const start = time;
      const end = time + timePerLine;
      result.push({
        start: Math.round(start * 100) / 100,
        end: Math.round(end * 100) / 100,
        text: line,
        section: section.section,
      });
      time = end;
      lineIdx++;
    }
  }
  // Clamp last end to duration
  if (result.length) result[result.length-1].end = Math.round(duration * 100) / 100;

  return result;
}
