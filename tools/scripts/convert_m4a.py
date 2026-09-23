"""Convert SunoV6Mini mp4 -> m4a. Stream-copy if AAC, else re-encode to AAC 320k."""
import subprocess
import sys
from pathlib import Path

SRC = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\audio\Suno-V6-Mini\SunoV6Mini-Human-in-the-Loop-V2.mp4")
DST = SRC.with_suffix(".m4a")

# Probe audio codec
probe = subprocess.run(
    ["ffprobe", "-v", "error", "-select_streams", "a:0",
     "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate,duration",
     "-of", "default=noprint_wrappers=1", str(SRC)],
    capture_output=True, text=True, timeout=60,
)
print("probe:", probe.stdout.strip(), probe.stderr.strip())

codec = ""
for line in probe.stdout.splitlines():
    if line.startswith("codec_name="):
        codec = line.split("=", 1)[1]

if codec == "aac":
    cmd = ["ffmpeg", "-y", "-i", str(SRC), "-vn", "-c:a", "copy", str(DST)]
    print("mode: stream copy (source is AAC)")
else:
    cmd = ["ffmpeg", "-y", "-i", str(SRC), "-vn", "-c:a", "aac", "-b:a", "320k", str(DST)]
    print(f"mode: re-encode to AAC 320k (source codec: {codec or 'unknown'})")

r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
print("ffmpeg rc:", r.returncode)
print(r.stderr[-800:])
if r.returncode == 0 and DST.exists():
    print(f"OK: {DST} ({DST.stat().st_size / 1024:.0f} KiB)")
    sys.exit(0)
sys.exit(1)
