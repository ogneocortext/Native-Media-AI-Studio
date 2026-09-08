from pathlib import Path

import numpy as np
from PIL import Image

OUT_DIR = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\frontend\tests\browser\out")
frames = sorted(OUT_DIR.glob("frame_*.png"))

diffs = []
ref_size = None
for i in range(1, len(frames)):
    prev = np.array(Image.open(frames[i-1]).convert("L"))
    curr = np.array(Image.open(frames[i]).convert("L"))
    if ref_size is None:
        ref_size = (prev.shape[1], prev.shape[0])
    elif prev.shape != curr.shape or prev.shape[::-1] != ref_size:
        prev = np.array(Image.open(frames[i-1]).convert("L").resize(ref_size))
        curr = np.array(Image.open(frames[i]).convert("L").resize(ref_size))
    diff = np.abs(prev.astype(np.int16) - curr.astype(np.int16))
    diff_pct = (np.sum(diff > 30) / diff.size) * 100
    diffs.append((i, diff_pct, np.mean(diff)))

print(f"Analyzed {len(frames)} frames ({len(diffs)} intervals)")
print("\nMotion intensity per interval (higher = more animation):")
for i, pct, mean in diffs:
    bar = "#" * int(pct / 2)
    print(f"  frame {i:02d}->{i+1:02d}: {pct:5.2f}% changed | avg diff {mean:5.1f} | {bar}")

print(f"\nAvg motion: {np.mean([pct for _, pct, _ in diffs]):.2f}%")
print(f"Peak motion: {np.max([pct for _, pct, _ in diffs]):.2f}% at frame {np.argmax([pct for _, pct, _ in diffs]) + 1}")
print(f"Still intervals (motion <0.5%): {sum(1 for _, pct, _ in diffs if pct < 0.5)}/{len(diffs)}")
