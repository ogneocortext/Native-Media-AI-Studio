"""Generate storyboard.built-this.json for Built This From A Dream.

Uses the authored concept.json narrative arc as the primary beat structure,
then assigns lyric lines into acts by time overlap. This avoids the
single-section-tag problem in the raw lyrics.
"""
from pathlib import Path
import json

ROOT = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\tools\hyperframes-built-this-from-a-dream")

with open(ROOT / "lyrics.json", "r", encoding="utf-8") as f:
    lyrics = json.load(f)["lyrics"]

with open(ROOT / "concept.json", "r", encoding="utf-8") as f:
    concept = json.load(f)

arc = concept["narrative_arc"]

# Assign each lyric line to the arc act with the most overlap.
for line in lyrics:
    line_start = float(line.get("start", 0.0))
    line_end = float(line.get("end", 0.0))
    best_act = None
    best_overlap = 0.0
    for act in arc:
        a0, a1 = act["time_range"]
        overlap = max(0.0, min(line_end, a1) - max(line_start, a0))
        if overlap > best_overlap:
            best_overlap = overlap
            best_act = act
    line["_act_index"] = arc.index(best_act) if best_act is not None else -1
    line["_act"] = best_act["title"] if best_act is not None else "UNKNOWN"

# Group lyrics by act.
from collections import defaultdict
act_lines = defaultdict(list)
for line in lyrics:
    if line["_act_index"] >= 0:
        act_lines[line["_act_index"]].append(line)

beats = []
for i, act in enumerate(arc):
    lines = sorted(act_lines.get(i, []), key=lambda l: float(l.get("start", 0.0)))
    start = float(act["time_range"][0])
    end = float(act["time_range"][1])
    # If no lyrics landed in this act, fall back to adjacent act lines or empty.
    hook = ""
    if lines:
        # Longest non-bracket line under 90 chars.
        candidates = [l.get("text", "").strip() for l in lines if not l.get("text", "").strip().startswith("[") and len(l.get("text", "").strip()) < 90]
        hook = max(candidates, key=len) if candidates else (lines[0].get("text", "") or "")
    else:
        # Use the lyric hook from concept if no lines match.
        hook = act.get("lyric_hooks", [""])[0]

    beats.append({
        "id": f"act-{i + 1}",
        "index": i,
        "act": i + 1,
        "actTitle": f"{['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][min(i, 11)]}. {act['title']}",
        "section": act["motif"].upper(),
        "start": start,
        "end": end,
        "rawMood": 0.35 + 0.5 * (i / max(1, len(arc) - 1)),
        "palette": act["palette"],
        "camera": act["camera"],
        "motif": act["motif"],
        "hook": hook,
        "lineCount": len(lines),
        "cinematic": act["cinematic"],
    })

# Contrast-stretch moods.
raw_moods = [b["rawMood"] for b in beats]
lo = min(raw_moods)
hi = max(raw_moods)
span = hi - lo
for b in beats:
    b["mood"] = (0.05 + 0.9 * ((b["rawMood"] - lo) / span)) if span > 1e-3 else b["rawMood"]

storyboard = {
    "track": concept["track"],
    "duration": concept["duration"],
    "source": "concept narrative arc + lyric assignment",
    "beats": beats,
}

out_path = ROOT / "storyboard.built-this.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(storyboard, f, indent=2)

print(f"Wrote {out_path}")
print(f"Beats: {len(storyboard['beats'])}")
for b in storyboard["beats"]:
    print(f"  Act {b['act']:02d} | {b['actTitle']:<20} | {b['section']:<12} | {b['start']:6.1f}s->{b['end']:6.1f}s | mood={b['mood']:.2f} | lines={b['lineCount']} | hook={b['hook'][:60]}")
