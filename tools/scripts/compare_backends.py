"""Compare librosa / madmom-infer / sonara on the real HITL track.

Runs the two optional backends in-process and cross-checks their beat grids
against the librosa analysis, so the studio can switch backends per use case
(madmom = bar lines; sonara = timbre/loudness + fast grid; librosa = default).
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))  # project root first: `tools.lib.audio` + app imports
sys.path.insert(0, str(ROOT / "packages" / "backend"))

from app.services.audio_analyzer import (  # noqa: E402
    MADMOM_AVAILABLE,
    SONARA_AVAILABLE,
    AudioAnalyzer,
)

TRACK = ROOT / "output" / "audio" / "Suno-V6-Mini" / "SunoV6Mini-Human-in-the-Loop-V2.m4a"
OUT = ROOT / "output" / "audio_analysis" / "backend-comparison-hitl.json"

analyzer = AudioAnalyzer()
report = {"track": TRACK.name, "backends": {}}


def grid_stats(times):
    if not times:
        return {"beats": 0}
    import numpy as np

    iv = np.diff(np.asarray(times, dtype=float))
    iv = iv[iv > 1e-6]
    return {
        "beats": len(times),
        "first": times[0],
        "last": times[-1],
        "tempo": round(60.0 / float(np.median(iv)), 1) if len(iv) else 0.0,
    }


for name in ("librosa", "madmom", "sonara"):
    avail = {"librosa": True, "madmom": MADMOM_AVAILABLE, "sonara": SONARA_AVAILABLE}[name]
    if not avail:
        report["backends"][name] = {"skipped": "not installed"}
        print(f"{name}: SKIPPED (not installed)")
        continue
    t0 = time.perf_counter()
    try:
        res = analyzer.analyze_file(str(TRACK), backend=name)
        entry = {
            "elapsed_s": round(time.perf_counter() - t0, 1),
            "bpm": res.beats.tempo_bpm,
            "confidence": res.beats.confidence,
            "grid": grid_stats(res.beats.beat_times),
            "downbeats": len(res.beats.downbeat_times or []),
            "onsets": len(res.beats.onset_times),
            "metadata_backend": res.metadata.get("backend"),
        }
        if res.metadata.get("sonara"):
            entry["sonara_extra"] = res.metadata["sonara"]
        report["backends"][name] = entry
        print(f"{name}: {json.dumps(entry)[:400]}")
    except Exception as e:
        report["backends"][name] = {"error": f"{type(e).__name__}: {e}"}
        print(f"{name}: ERROR {e}")

OUT.write_text(json.dumps(report, indent=1), encoding="utf-8")
print("wrote", OUT)
