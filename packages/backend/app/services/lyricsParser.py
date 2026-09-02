"""
Lyrics parsing utilities.

Handles parsing of LRC format and other lyric formats into structured data.
"""


def parse_lrc_to_lines(lrc_content: str) -> list[dict]:
    """
    Parse standard LRC format into structured line data.

    Supports mm:ss.xx, mm:ss.xxx, single-digit minutes, and [offset:+ms].
    Returns list of dicts with keys: start_time, end_time, text
    """
    import re
    lines = []
    timestamp_regex = r"\[(\d{1,3}):(\d{2})[.:](\d{1,3})\]"
    offset_ms = 0
    # Detect global offset tag
    m_off = re.search(r"\[offset:\s*([+-]?\d+)\]", lrc_content, re.IGNORECASE)
    if m_off:
        try: offset_ms = int(m_off.group(1))
        except: offset_ms = 0

    for raw_line in lrc_content.split("\n"):
        line = raw_line.strip()
        if not line or re.match(r"^\[(ti|ar|al|length|by|re|ve):", line, re.IGNORECASE):
            continue
        if re.match(r"^\[offset:", line, re.IGNORECASE):
            continue
        matches = re.findall(timestamp_regex, line)
        if not matches:
            continue
        text = re.sub(timestamp_regex, "", line).strip()
        if not text:
            continue
        for mm, ss, frac in matches:
            frac_len = len(frac)
            if frac_len == 3:
                fractional = int(frac) / 1000
            elif frac_len == 1:
                fractional = int(frac) / 10
            else:
                fractional = int(frac) / 100
            start = int(mm) * 60 + int(ss) + fractional + offset_ms / 1000.0
            # Clamp negative offset starts to 0
            if start < 0:
                start = 0
            lines.append({
                "start_time": round(start, 2),
                "end_time": round(start + 5, 2),
                "text": text,
            })

    lines.sort(key=lambda x: x["start_time"])
    # Update end times based on next line's start (cap to avoid unreadably long lines)
    for i in range(len(lines) - 1):
        nxt = lines[i + 1]["start_time"]
        cur_start = lines[i]["start_time"]
        # Cap line duration to min(6s, gap-0.2s) but at least 1.5s
        gap = nxt - cur_start
        capped_end = min(cur_start + 6.0, nxt - 0.2 if gap > 0.5 else nxt)
        if capped_end < cur_start + 1.5:
            capped_end = min(nxt, cur_start + 1.5)
        lines[i]["end_time"] = round(capped_end, 2)

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
        for word_match in re.findall(word_timestamp_regex, word_line):
            # findall returns tuple (mm, ss, frac, text)
            mm, ss, frac, txt = word_match
            frac_len = len(frac)
            if frac_len == 3:
                word_frac = int(frac) / 1000
            elif frac_len == 1:
                word_frac = int(frac) / 10
            else:
                word_frac = int(frac) / 100
            word_start = int(mm) * 60 + int(ss) + word_frac
            word_text = txt.strip()
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
        total = float(line["start_time"])
        mins = int(total // 60)
        secs = total % 60
        # Handle rollover where secs rounds to 60.00
        if secs >= 59.995:
            mins += 1
            secs = 0
        lrc_lines.append(f"[{mins:02d}:{secs:05.2f}] {line['text']}")

    return "\n".join(lrc_lines)
