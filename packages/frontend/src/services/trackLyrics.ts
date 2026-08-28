/**
 * Track prompt and lyrics data from HappyShrimp CSV.
 * Parsed from docs/TrackName-Prompt-LyricsKeyExcerptTheme.csv
 */

export interface TrackLyricsData {
  id: number;
  trackName: string;
  prompt: string;
  lyrics: string;
  isVariation: boolean;
  baseTrack?: string;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseTrackLyricsCSV(csvText: string): TrackLyricsData[] {
  const lines = csvText.split("\n").filter((l) => l.trim());
  const data: TrackLyricsData[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (cells.length < 4) continue;

    const id = parseInt(cells[0].replace(/"/g, ""), 10) || i;
    const trackName = cells[1].replace(/"/g, "").trim();
    let prompt = cells[2].replace(/"/g, "").trim();
    let lyrics = cells[3].replace(/"/g, "").trim();

    // Clean up "happyshrimp" markers
    prompt = prompt.replace(/happyshrimp$/, "").trim();
    lyrics = lyrics.replace(/happyshrimp$/, "").trim();

    const isVariation = trackName.includes("(variation)") || trackName.includes("(same prompt");
    let baseTrack: string | undefined;

    if (isVariation) {
      // Find base track name
      const match = trackName.match(/\((?:same prompt as #(\d+)|variation)\)/);
      if (match) {
        baseTrack = trackName.replace(/\s*\([^)]+\)/g, "").trim();
      }
    }

    data.push({ id, trackName, prompt, lyrics, isVariation, baseTrack });
  }

  return data;
}

// Embedded CSV data (from docs/TrackName-Prompt-LyricsKeyExcerptTheme.csv)
const CSV_DATA = `"#","Track Name","Prompt","Lyrics (key excerpt/theme)"
"1","The Signal Breaking Through the Noise","A melancholic yet euphoric 136 BPM Progressive Trance song about surviving grief and silence and finding your own frequency — infinite dawn landscape, electric blue horizon. Smooth breathy female lead, whispered male vocal in breakdown, four-on-the-floor kick, supersaw chords, minor-key arpeggiator lead","Structure: Verse–Verse–Pre-Chorus–Chorus(""I am the signal breaking through the noise..."")–Breakdown–Build-Up–Verse–Final Chorus"
"2","The Signal breaking through the Noise (variation)","Same prompt as #1","Same lyrics as #1"
"3","Before the Fade","Nocturnal future-garage, low-130s BPM, loose swung rhythm, warm modulating sub-bass, foggy reverb pads, intimate breathy male lead, minor-key harmony, spacious headphone-focused mix, introspective tone","Theme: rising before the fade, chasing self-made light, becoming who tomorrow makes you. Chorus: ""Still I rise before the fade / Still I chase the light I made..."""
"4","Still I Rise (variation)","Same prompt as #3","Same lyrics as #3"
"5","Borrowed Flame","Classic 90s West Coast G-Funk, smooth laid-back groove, sine wave synth lead, heavy melodic bassline, female rap vocals (UK accent), AK-47 gunshot FX texture, 92 BPM","Theme: rejecting manufactured media panic, reclaiming peace. Chorus: ""I won't ride with the choir anymore..."""
"6","I Won't Ride with the Choir (variation)","Same prompt as #5","Same lyrics as #5"
"7","Take the Crown","Drift phonk, 145-155 BPM, aggressive cowbell, distorted sub-808 bass, chopped dark vocal samples, minor-key synth stabs, triumphant dark-to-light arc about burning away self-doubt through growth","Theme: stepping out of shadow into confidence. ""Step out the shadow / Burn it to the ground / Watch the new king / Take the crown"""
"8","Built by Fire (same prompt as #7, different lyric take)","Same prompt as #7","Theme: strength forged through hardship. ""Built by fire, built by force / No retreat, I hold my course..."""
"9","System Override","Heavy dubstep/brostep with retro synthwave, aggressive LFO-modulated wobble bass, reese/FM growl tones, glitchy percussion, 80s analog synth pads, neon retro-futuristic backdrop","Short breakdown hook: ""System override / Neon in the veins / Modulation engaged / Enter the grid"""
"10","Learning How to Stay","Neo-noir cyberpunk synth score, 80s analog synth atmosphere, warbling bass pads, mournful sax-style lead, rain-soaked neon mood, 80-90 BPM, theme of exhaustion chasing an ever-changing future","Theme: struggling to keep pace with rapid change while learning self-acceptance. Chorus: ""I'm still learning how to stay / While the world rewrites its name..."""
"11","Learning How to Stay V2 (variation)","Same prompt as #10","Same lyrics as #10"`;

export function getTrackLyricsData(): TrackLyricsData[] {
  return parseTrackLyricsCSV(CSV_DATA);
}

export function getUniqueTracks(): TrackLyricsData[] {
  return getTrackLyricsData().filter((t) => !t.isVariation);
}

export function getTrackByName(name: string): TrackLyricsData | undefined {
  const tracks = getTrackLyricsData();
  // Exact match
  let found = tracks.find((t) => t.trackName.toLowerCase() === name.toLowerCase());
  if (found) return found;
  // Partial match
  found = tracks.find((t) => t.trackName.toLowerCase().includes(name.toLowerCase()));
  if (found) return found;
  // Match without variation suffix
  const baseName = name.replace(/\s*\([^)]+\)/g, "").trim();
  return tracks.find((t) => t.trackName.toLowerCase().includes(baseName.toLowerCase()));
}

export function getPromptForTrack(trackName: string): string {
  const track = getTrackByName(trackName);
  if (!track) return "";
  // If it's a variation, find the base track prompt
  if (track.isVariation && track.prompt.startsWith("Same prompt as")) {
    const baseTrack = getUniqueTracks().find((t) =>
      track.trackName.toLowerCase().includes(t.trackName.toLowerCase().split(" ")[0])
    );
    return baseTrack?.prompt || track.prompt;
  }
  return track.prompt;
}

export function getLyricsForTrack(trackName: string): string {
  const track = getTrackByName(trackName);
  return track?.lyrics || "";
}
