"""Run pip inside the studio env without leaking stderr to the calling shell."""
import subprocess
import sys

STUDIO_PY = r"D:\conda-envs\nma-studio-cuda\Scripts\python.exe"

proc = subprocess.run(
    [STUDIO_PY, "-m", "pip", *sys.argv[1:]],
    capture_output=True,
    text=True,
    timeout=1800,
)
out = (proc.stdout or "") + (proc.stderr or "")
lines = [line for line in out.splitlines() if "Ignoring invalid distribution" not in line]
print("\n".join(lines[-25:]))
print(f"PIP_EXIT={proc.returncode}")
