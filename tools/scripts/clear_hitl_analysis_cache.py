"""Clear the stale cached analysis for the HITL track so it re-analyzes with new code."""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "storage" / "studio.db"
INDEX = ROOT / "output" / "audio_analysis" / "index.json"
KEYS = ["Suno-V6-Mini/SunoV6Mini-Human-in-the-Loop-V2.m4a",
        "SunoV6Mini-Human-in-the-Loop-V2.m4a",
        "SunoV6Mini-Human-in-the-Loop-V2.wav"]

conn = sqlite3.connect(DB)
for k in KEYS:
    cur = conn.execute("UPDATE audio_files SET analysis_result = NULL WHERE filename = ?", (k,))
    print(f"db cleared {cur.rowcount} row(s) for {k}")
conn.commit()
conn.close()

idx = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {}
removed = []
for k in list(idx):
    if Path(k).name in {"SunoV6Mini-Human-in-the-Loop-V2.m4a", "SunoV6Mini-Human-in-the-Loop-V2.wav"}:
        job = idx.pop(k)
        removed.append((k, job))
        f = ROOT / "output" / "audio_analysis" / f"{job}_analysis.json"
        f.unlink(missing_ok=True)
INDEX.write_text(json.dumps(idx, indent=2, ensure_ascii=False), encoding="utf-8")
print("index entries removed:", removed)
print("cache clear done")
