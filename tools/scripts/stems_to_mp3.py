"""Convert Demucs WAV stems to MP3 (VBR ~190kbps) alongside the originals."""
import subprocess
import sys
from pathlib import Path

STEM_DIR = Path(
    r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio"
    r"\output\stems\htdemucs\SunoV6Mini-Human-in-the-Loop-V2"
)

total_wav = total_mp3 = 0
for name in ["vocals", "drums", "bass", "other"]:
    wav = STEM_DIR / f"{name}.wav"
    mp3 = STEM_DIR / f"{name}.mp3"
    if not wav.exists():
        print(f"MISSING: {wav}")
        sys.exit(1)
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "2", str(mp3)],
        capture_output=True, text=True, timeout=300,
    )
    if r.returncode != 0 or not mp3.exists():
        print(f"FAIL {name}: {r.stderr[-400:]}")
        sys.exit(1)
    w, m = wav.stat().st_size, mp3.stat().st_size
    total_wav += w
    total_mp3 += m
    print(f"{name}: {w / 1024 / 1024:.1f} MiB wav -> {m / 1024 / 1024:.1f} MiB mp3 ({100 * m / w:.0f}%)")

print(f"\ntotal: {total_wav / 1024 / 1024:.1f} MiB -> {total_mp3 / 1024 / 1024:.1f} MiB "
      f"(saved {(total_wav - total_mp3) / 1024 / 1024:.1f} MiB, {100 * total_mp3 / total_wav:.0f}% of original)")
