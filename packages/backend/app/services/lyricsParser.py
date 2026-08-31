"""
Lyrics parsing utilities.

Handles parsing of LRC format and other lyric formats into structured data.
"""


def parse_lrc_to_lines(lrc_content: str) -> list[dict]:
    """
    Parse standard LRC format into structured line data.

    LRC format:
        [mm:ss.xx] lyric text
        [00:12.50] Hello world

    Returns list of dicts with keys: start_time, end_time, text
    """
    lines = []
    timestamp_regex = r"\[(\d{2}):(\d{2})\.(\d{2,3})\]"

    import re

    for line in lrc_content.split("\n"):
        matches = re.findall(timestamp_regex, line)
        if not matches:
            continue

        # Get text after the last timestamp
        last_match_str = re.match(r".*?" + timestamp_regex, line)
        text = re.sub(timestamp_regex, "", line).strip()
        if not text:
            continue

        # Use the first timestamp as the line start time
        minutes = int(matches[0][1])
        seconds = int(matches[0][2])
        centis = matches[0][3].length = len(matches[0][3])
        if centis == 2:
            fractional = int(matches[0][3]) / 100
        else:
            fractional = int(matches[0][3]) / 1000
        start = minutes * 60 + seconds + fractional

        lines.append({
            "start_time": round(start, 2),
            "end_time": round(start + 5, 2),  # Will be updated later
            "text": text,
        })

    # Update end times based on next line's start
    for i in range(len(lines) - 1):
        lines[i]["end_time"] = lines[i + 1]["start_time"]

    return lines


def parse_word_level_lrc(lrc_content: str) -> list[dict]:
    """
    Parse word-level LRC (karaoke format) with per-word timestamps.

    Format:
        [mm:ss.xx] line text
        [mm:ss.xx]<mm:ss.xx> word1 <mm:ss.xx> word2
    """
    lines = []
    import re

    line_timestamp_regex = r"^\[(\d{2}):(\d{2})\.(\d{2,3})\]"
    word_timestamp_regex = r"<(\d{2}):(\d{2})\.(\d{2,3})>\s*([^<]+)"

    for line in lrc_content.split("\n"):
        line_match = re.match(line_timestamp_regex, line)
        if not line_match:
            continue

        w_min = int(line_match.group(1))
        w_sec = int(line_match.group(2))
        w_cent = line_match.group(3)
        centis = len(w_cent)
        if centis == 2:
            fractional = int(w_cent) / 100
        else:
            fractional = int(w_cent) / 1000
        line_start = w_min * 60 + w_sec + fractional

        # Extract word timings
        word_line = line[line_match.end():]
        words = []
        for match in re.findall(word_timestamp_regex, word_line):
            word_min = int(match[1])
            word_sec = int(match[2])
            word_cent = match[3]
            word_centis = len(word_cent)
            if word_centis == 2:
                word_frac = int(word_cent) / 100
            else:
                word_frac = int(word_cent) / 1000
            word_start = word_min * 60 + word_sec + word_frac
            word_text = match[4].strip()
            words.append({"word": word_text, "start_time": round(word_start, 2)})

        if words:
            text = " ".join(w["word"] for w in words)
            end_time = max(w["start_time"] for w in words) + 0.5
            lines.append({
                "start_time": round(line_start, 2),
                "end_time": round(end_time, 2),
                "text": text,
            })

    return lines


def generate_lrc(lines: list[dict], title: str = "") -> str:
    """Generate LRC format from structured line data."""
    lrc_lines = []
    if title:
        lrc_lines.append(f"[ti:{title}]")
    lrc_lines.append("")

    for line in lines:
        mins = int(line["start_time"] // 60)
        secs = line["start_time"] % 60
        lrc_lines.append(f"[{mins:02d}:{secs:05.2f}] {line['text']}")

    return "\n".join(lrc_lines)
