#!/usr/bin/env python3
"""Compare stems side-by-side: runs analyze.py on each file, prints a table.
Usage: compare_stems.py bass.mp3 drums.mp3 vocals.mp3 other.mp3
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out-compare")
os.makedirs(OUT, exist_ok=True)

rows = []
for f in sys.argv[1:]:
    name = os.path.splitext(os.path.basename(f))[0]
    dest = os.path.join(OUT, name)
    subprocess.run([sys.executable, os.path.join(HERE, "analyze.py"), f, dest],
                   check=True, capture_output=True)
    with open(os.path.join(dest, "analysis.json")) as fh:
        d = json.load(fh)
    be = d["band_energy_pct"]
    rows.append({
        "stem": name,
        "dur_s": d["duration_s"],
        "tempo": d["tempo_bpm"],
        "key": f'{d["estimated_key"]} ({d["key_confidence_r"]})',
        "rms_dbfs": d["rms_dbfs"],
        "peak_dbfs": d["peak_dbfs"],
        "sub_%": be["sub_20_120"],
        "centroid": d["spectral_centroid_hz"],
        "stereo_corr": d["stereo_correlation"],
        "width": d["stereo_width_side_mid_ratio"],
    })

cols = ["stem", "dur_s", "tempo", "key", "rms_dbfs", "peak_dbfs",
        "sub_%", "centroid", "stereo_corr", "width"]
widths = {c: max(len(c), max(len(str(r[c])) for r in rows)) for c in cols}
hdr = "  ".join(c.ljust(widths[c]) for c in cols)
print(hdr)
print("-" * len(hdr))
for r in rows:
    print("  ".join(str(r[c]).ljust(widths[c]) for c in cols))

# balance summary: relative RMS vs loudest stem
loud = max(r["rms_dbfs"] for r in rows)
print("\nBalance vs loudest stem:")
for r in rows:
    print(f'  {r["stem"]}: {r["rms_dbfs"] - loud:+.1f} dB')
print(f"\nSaved per-stem analyses under {OUT}/")
