import type { LyricLine } from "./components/KineticPresets";

/**
 * Parse lyrics from the normalized CSV format.
 * CSV format: track_name,section,start_time,end_time,text
 *
 * This is the preferred format - each lyric line has its own row
 * with explicit timing.
 */
export function parseLyricsFromNormalizedCsv(csvContent: string, trackName: string): LyricLine[] {
  if (!csvContent || !trackName) return [];

  // Normalize line endings and split
  const lines = csvContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  // Find the header row to determine column indices
  const header = lines[0].split(",");
  const trackIdx = header.indexOf("track_name");
  const sectionIdx = header.indexOf("section");
  const startIdx = header.indexOf("start_time");
  const endIdx = header.indexOf("end_time");
  const textIdx = header.indexOf("text");

  if (trackIdx < 0 || sectionIdx < 0 || startIdx < 0 || endIdx < 0 || textIdx < 0) {
    return []; // Invalid format
  }

  const cleanTrackName = trackName.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").trim();
  const result: LyricLine[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line (handle quoted fields)
    const fields = parseCsvLine(line);
    if (fields.length <= Math.max(trackIdx, sectionIdx, startIdx, endIdx, textIdx)) continue;

    const csvName = fields[trackIdx].toLowerCase().replace(/\s*\(.*?\)\s*/g, "").trim();

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

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip metadata lines like [ti:...], [ar:...], [al:...], [length:...]
    if (/^\[(ti|ar|al|length|by|offset|re|ve):/i.test(line)) continue;

    // Parse timestamps: [mm:ss.xx]text or [mm:ss.xx][mm:ss.xx]text
    const timestampMatch = line.match(/^\[(\d{2}):(\d{2})\.(\d{2})\](.*)$/);
    if (!timestampMatch) {
      // Check if it's a section marker like [Intro], [Verse], [Chorus], [Drop]
      const sectionMatch = line.match(/^\[(Intro|Verse|Chorus|Bridge|Drop|Breakdown|Build-Up|Pre-Chorus|Final\s*Chorus|Outro)\]$/i);
      if (sectionMatch) {
        const marker = sectionMatch[1].toLowerCase();
        if (marker.includes("intro")) currentSection = "INTRO";
        else if (marker.startsWith("verse")) currentSection = "VERSE";
        else if (marker.includes("chorus") && marker.includes("final")) currentSection = "FINAL CHORUS";
        else if (marker.includes("chorus")) currentSection = "CHORUS";
        else if (marker.includes("bridge")) currentSection = "BRIDGE";
        else if (marker.includes("drop")) currentSection = "DROP";
        else if (marker.includes("breakdown")) currentSection = "BREAKDOWN";
        else if (marker.includes("build-up")) currentSection = "BUILD-UP";
        else if (marker.includes("outro")) currentSection = "OUTRO";
        else currentSection = marker.toUpperCase();
      }
      continue;
    }

    const minutes = parseInt(timestampMatch[1], 10);
    const seconds = parseInt(timestampMatch[2], 10);
    const centiseconds = parseInt(timestampMatch[3], 10);
    const start = minutes * 60 + seconds + centiseconds / 100;
    const text = timestampMatch[4].trim();

    if (!text) continue;

    result.push({
      start,
      end: start + 2, // Will be recalculated when we know the next line's start
      text,
      section: currentSection,
    });
  }

  // Recalculate end times based on next line's start
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start;
  }

  // Last line gets a reasonable default duration
  if (result.length > 0) {
    result[result.length - 1].end = result[result.length - 1].start + 3;
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
export function parseLyricsFromCsv(csvContent: string, trackName: string, duration: number): LyricLine[] {
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
function parseLyricsFromLegacyCsv(csvContent: string, trackName: string, duration: number): LyricLine[] {
  if (!csvContent || !trackName) return [];

  const lines = csvContent.split("\n");
  const cleanTrackName = trackName.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").trim();

  for (const line of lines) {
    const match = line.match(/^"\d+","([^"]+)"/);
    if (!match) continue;

    const csvName = match[1];
    const cleanCsvName = csvName.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").trim();

    // Fuzzy match: track name contains CSV name or vice versa
    if (cleanTrackName.includes(cleanCsvName) || cleanCsvName.includes(cleanTrackName)) {
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
export function generateTimedLyrics(lyricsText: string, duration: number): LyricLine[] {
  if (!lyricsText || lyricsText.length < 10) return [];

  const sections: { section: string; lines: string[] }[] = [];
  let currentSection = "INTRO";
  let currentLines: string[] = [];

  // Check if this is format 1 (has explicit section markers)
  const hasSectionMarkers = /(?:VERSE|CHORUS|BRIDGE|INTRO|FINAL\s*Chorus|PRE-CHORUS|BREAKDOWN|BUILD-UP)/i.test(lyricsText);

  if (hasSectionMarkers) {
    // Parse lyrics text into sections
    // Split on section markers: Verse, Chorus, Bridge, Intro, Final Chorus, Pre-Chorus, Breakdown, Build-Up
    const parts = lyricsText.split(/(Verse\s*\d*|Chorus|Bridge|Intro|Final\s*Chorus|Pre-Chorus|Breakdown|Build-Up)/gi);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]?.trim();
      if (!part) continue;

      // Check if this part is a section marker
      const sectionMatch = part.match(/^(Verse\s*\d*|Chorus|Bridge|Intro|Final\s*Chorus|Pre-Chorus|Breakdown|Build-Up)$/i);
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
          .map(s => s.replace(/"/g, "").trim())
          .filter(s => s.length > 3 && !s.toLowerCase().includes("structure:") && !s.toLowerCase().includes("theme:"));

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
        .map(s => s.trim())
        .filter(s => s.length > 2);

      if (lyricLines.length > 0) {
        sections.push({ section: "VERSE", lines: lyricLines });
      }
    } else {
      // Fallback: just split by common separators
      const lyricLines = lyricsText
        .split(/[\/–—\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 5 && !s.toLowerCase().startsWith("theme:") && !s.toLowerCase().startsWith("structure:"));

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
  let time = 0;

  for (const section of sections) {
    for (const line of section.lines) {
      result.push({
        start: Math.round(time * 10) / 10,
        end: Math.round((time + timePerLine) * 10) / 10,
        text: line,
        section: section.section,
      });
      time += timePerLine;
    }
  }

  return result;
}
