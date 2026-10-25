"""Insight-generating end-to-end Demucs test on a real Suno track.

Runs Demucs separation on the Suno V6 track and verifies:
1. All 4 stems are produced
2. Each stem file exists and is larger than 100 KiB
3. The API stems lookup endpoint used by the Visualizer/StemMixer returns found=True

Run from repo root:
    python tools/tests/test_demucs_suno.py
"""

import asyncio
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "backend"))

from app.services.source_separation import source_separator  # noqa: E402

M4A = ROOT / "output" / "audio" / "Suno-V6-Mini" / "SunoV6Mini-Human-in-the-Loop-V2.m4a"

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}  {detail}")
    if not ok:
        failures.append(label)


async def main() -> int:
    check("input file exists", M4A.exists(),
          f"{M4A.stat().st_size / 1024 / 1024:.1f} MiB" if M4A.exists() else "missing")

    if not M4A.exists():
        print("\nFAILURES:", failures)
        return 1

    print(f"input: {M4A} ({M4A.stat().st_size / 1024 / 1024:.1f} MiB)")
    check("demucs cmd found", source_separator._find_demucs() is not None)
    check("device detected", source_separator._detect_device() is not None)

    started = time.perf_counter()
    result = await source_separator.separate(str(M4A), model="htdemucs")
    elapsed = time.perf_counter() - started

    check("separation completed without error", result.error is None,
          result.error or "")
    check("elapsed time recorded", elapsed > 0, f"{elapsed:.1f}s")
    check("model is htdemucs", result.model == "htdemucs", f"got {result.model}")
    check("duration > 0", result.duration > 0, f"{result.duration:.1f}s")

    # 4 stems produced
    check("4 stems returned", len(result.stems) == 4,
          f"got {len(result.stems)}: {sorted(result.stems.keys())}")

    # Each stem file exists and is larger than 100 KiB
    all_stems_ok = True
    for name, stem in sorted(result.stems.items()):
        p = Path(stem)
        size = p.stat().st_size if p.exists() else 0
        ok = p.exists() and size > 100_000
        check(f"stem file valid: {name}", ok,
              f"{'missing' if not p.exists() else f'{size/1024/1024:.1f} MiB'}")
        if not ok:
            all_stems_ok = False

    check("all 4 stem files valid on disk (>100 KiB)", all_stems_ok)

    # Verify the API lookup the Visualizer/StemMixer uses
    try:
        url = "http://127.0.0.1:8000/api/audio/stems/" + urllib.parse.quote(M4A.name)
        with urllib.request.urlopen(url, timeout=10) as resp:
            lookup = json.loads(resp.read())
        check("API stems lookup found", lookup.get("found") is True)
        lookup_stems = set(lookup.get("stems", {}))
        check("API stems lookup returns stems", len(lookup_stems) > 0,
              f"got {lookup_stems}")
    except Exception as e:
        check("API stems lookup HTTP 200", False, f"{type(e).__name__}: {e}")

    print("\n" + ("ALL PASS" if not failures else f"FAILURES: {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
