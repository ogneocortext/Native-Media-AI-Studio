#!/usr/bin/env python3
"""
Convert track-prompts-lyrics.csv to a normalized format.

New format: track_name|section|start_time|end_time|text

Each lyric line gets its own row with explicit timing derived from
track BPM and section structure.
"""

import csv
import re
import sys

def parse_structure_sections(text):
    """Parse 'Structure: Verse–Verse–Chorus(""lyrics..."')' format."""
    sections = []
    # Extract the structure part
    structure_match = re.search(r'Structure:\s*(.+)', text, re.IGNORECASE)
    if not structure_match:
        return sections
    
    structure = structure_match.group(1)
    
    # Split on section markers (handle en-dash and em-dash separators)
    # The separator is en-dash (–) or em-dash (—)
    parts = re.split(r'(Verse\s*\d*|Chorus|Bridge|Intro|Final\s*Chorus|Pre-Chorus|Breakdown|Build-Up)', structure, flags=re.IGNORECASE)
    
    current_section = "INTRO"
    for part in parts:
        part = part.strip()
        # Remove leading/trailing dashes
        part = part.lstrip('–—').rstrip('–—').strip()
        if not part:
            continue
        
        # Check if section marker
        section_match = re.match(r'^(Verse\s*\d*|Chorus|Bridge|Intro|Final\s*Chorus|Pre-Chorus|Breakdown|Build-Up)$', part, re.IGNORECASE)
        if section_match:
            marker = section_match.group(1).lower()
            if marker.startswith("verse"):
                current_section = "VERSE"
            elif marker.startswith("final"):
                current_section = "FINAL CHORUS"
            elif marker.startswith("pre"):
                current_section = "PRE-CHORUS"
            elif marker.startswith("breakdown"):
                current_section = "BREAKDOWN"
            elif marker.startswith("build"):
                current_section = "BUILD-UP"
            else:
                current_section = marker.upper()
        else:
            # Extract lyrics from this section
            # Lyrics are in quotes (CSV reader already converted "" to ")
            lyrics = re.findall(r'"([^"]+)"', part)
            for lyric in lyrics:
                lyric = lyric.strip()
                if lyric and len(lyric) > 3 and not lyric.lower().startswith(("structure", "theme")):
                    sections.append((current_section, lyric))
    
    return sections


def parse_theme_sections(text):
    """Parse 'Theme: description. "lyric 1 / lyric 2"' format."""
    sections = []

    # Extract quoted lyrics (CSV reader already converted "" to ")
    quoted = re.findall(r'"([^"]+)"', text)
    for quote in quoted:
        # Split by / or – (en-dash) or — (em-dash)
        lines = re.split(r'\s*/\s*|\s*[–—]\s*', quote)
        for line in lines:
            line = line.strip()
            if line and len(line) > 2:
                sections.append(("VERSE", line))

    return sections


def parse_chorus_sections(text):
    """Parse 'Chorus: "lyric 1 / lyric 2"' format."""
    sections = []

    chorus_match = re.search(r'Chorus:\s*"(.+?)"', text, re.IGNORECASE)
    if chorus_match:
        lines = re.split(r'\s*/\s*|\s*[–—]\s*', chorus_match.group(1))
        for line in lines:
            line = line.strip()
            if line and len(line) > 2:
                sections.append(("CHORUS", line))

    return sections


def parse_short_hook(text):
    """Parse 'Short breakdown hook: "lyric 1 / lyric 2"' format."""
    sections = []

    hook_match = re.search(r'(?:Short\s+)?(?:breakdown\s+)?hook:\s*"(.+?)"', text, re.IGNORECASE)
    if hook_match:
        lines = re.split(r'\s*/\s*|\s*[–—]\s*', hook_match.group(1))
        for line in lines:
            line = line.strip()
            if line and len(line) > 2:
                sections.append(("BREAKDOWN", line))

    return sections


def extract_bpm(prompt):
    """Extract BPM from prompt text."""
    bpm_match = re.search(r'(\d+)\s*-\s*(\d+)\s*BPM', prompt)
    if bpm_match:
        return (int(bpm_match.group(1)) + int(bpm_match.group(2))) // 2
    bpm_match = re.search(r'(\d+)\s*BPM', prompt)
    if bpm_match:
        return int(bpm_match.group(1))
    return 120  # default


def compute_timing(sections, bpm, duration=120):
    """Compute start/end times for each section based on BPM."""
    if not sections:
        return []
    
    # Estimate: each line gets roughly equal time
    total_lines = len(sections)
    time_per_line = duration / total_lines
    
    # But try to be smarter: group by section
    section_groups = {}
    for section, text in sections:
        if section not in section_groups:
            section_groups[section] = []
        section_groups[section].append(text)
    
    result = []
    current_time = 0.0
    
    # Distribute time: choruses get more time, verses get standard
    for section, texts in section_groups.items():
        section_weight = 1.5 if section in ("CHORUS", "FINAL CHORUS") else 1.0
        time_for_section = len(texts) * time_per_line * section_weight
        
        for text in texts:
            line_duration = time_for_section / len(texts)
            result.append({
                "section": section,
                "start": round(current_time, 1),
                "end": round(current_time + line_duration, 1),
                "text": text,
            })
            current_time += line_duration
    
    return result


def convert_csv(input_path, output_path):
    """Convert the CSV to normalized format."""
    rows = []
    
    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)  # Skip header
        
        for row in reader:
            if len(row) < 4:
                continue
            
            track_num = row[0].strip('"')
            track_name = row[1].strip('"')
            prompt = row[2].strip('"')
            lyrics_text = row[3].strip('"')
            
            # Skip "same as" entries
            if lyrics_text.lower().startswith("same lyrics as"):
                continue
            
            bpm = extract_bpm(prompt)
            
            # Determine lyrics format and parse
            sections = []
            
            if re.search(r'Structure:', lyrics_text, re.IGNORECASE):
                sections = parse_structure_sections(lyrics_text)
            elif re.search(r'Chorus:', lyrics_text, re.IGNORECASE):
                sections = parse_chorus_sections(lyrics_text)
            elif re.search(r'(?:Short\s+)?(?:breakdown\s+)?hook:', lyrics_text, re.IGNORECASE):
                sections = parse_short_hook(lyrics_text)
            elif '""' in lyrics_text:
                sections = parse_theme_sections(lyrics_text)
            
            if not sections:
                continue
            
            # Compute timing
            timed_lyrics = compute_timing(sections, bpm)
            
            for lyric in timed_lyrics:
                rows.append({
                    "track_name": track_name,
                    "section": lyric["section"],
                    "start_time": lyric["start"],
                    "end_time": lyric["end"],
                    "text": lyric["text"],
                })
    
    # Write normalized CSV
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["track_name", "section", "start_time", "end_time", "text"])
        for row in rows:
            writer.writerow([
                row["track_name"],
                row["section"],
                row["start_time"],
                row["end_time"],
                row["text"],
            ])
    
    print(f"Converted {len(rows)} lyric lines from {input_path} to {output_path}")


if __name__ == "__main__":
    input_path = sys.argv[1] if len(sys.argv) > 1 else "packages/frontend/public/track-prompts-lyrics.csv"
    output_path = sys.argv[2] if len(sys.argv) > 2 else "packages/frontend/public/track-lyrics-normalized.csv"
    convert_csv(input_path, output_path)
