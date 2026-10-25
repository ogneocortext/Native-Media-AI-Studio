"""Insight-generating end-to-end Demucs smoke test.

Generates a 10s synthetic track (kick + bass + lead), then runs the backend's
SourceSeparator against it on CUDA and verifies all 4 stems are produced.

Run from repo root:
    python tools/tests/test_demucs_sep.py
"""

import asyncio
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "backend"))

from app.services.source_separation import source_separator  # noqa: E402

TEST_WAV = ROOT / "tools" / "tests" / "demucs_test_input.wav"

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}  {detail}")
    if not ok:
        failures.append(label)


def make_test_track(path: Path, seconds: float = 10.0, sr: int = 44100) -> None:
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    # Kick: 120 BPM pulse train (low thump)
    kick = np.zeros_like(t)
    beat = 60.0 / 120.0
    for n in range(int(seconds / beat)):
        start = int(n * beat * sr)
        env = np.exp(-np.linspace(0, 30, int(0.15 * sr)))
        sig = np.sin(2 * np.pi * 55 * np.linspace(0, 0.15, int(0.15 * sr))) * env
        kick[start:start + len(sig)] += sig
    # Bass: 110 Hz saw-ish
    bass = 0.25 * np.sign(np.sin(2 * np.pi * 110 * t))
    # "Vocal": warbling 440 Hz
    vocal = 0.2 * np.sin(2 * np.pi * (440 + 30 * np.sin(2 * np.pi * 5 * t)) * t)
    mix = kick + bass + vocal
    mix = mix / max(1e-9, np.abs(mix).max()) * 0.9
    stereo = np.stack([mix, mix], axis=-1)
    sf.write(str(path), stereo, sr)
    print(f"wrote {path} ({seconds}s)")


async def main() -> int:
    make_test_track(TEST_WAV)

    check("source_separator available", source_separator.is_available())
    check("demucs cmd found", source_separator._find_demucs() is not None)
    check("device detected", source_separator._detect_device() is not None)

    started = time.perf_counter()
    result = await source_separator.separate(str(TEST_WAV), model="htdemucs")
    elapsed = time.perf_counter() - started

    check("separation completed without error", result.error is None,
          result.error or "")
    check("elapsed time recorded", elapsed > 0, f"{elapsed:.1f}s")
    check("model is htdemucs", result.model == "htdemucs",
          f"got {result.model}")
    check("duration > 0", result.duration > 0, f"{result.duration:.1f}s")

    # 4 stems produced
    check("4 stems returned", len(result.stems) == 4,
          f"got {len(result.stems)}: {sorted(result.stems.keys())}")

    # Each stem file exists and is larger than 1 KiB
    all_stems_ok = True
    for name, stem in sorted(result.stems.items()):
        p = Path(stem)
        size = p.stat().st_size if p.exists() else 0
        ok = p.exists() and size > 1000
        check(f"stem file valid: {name}", ok,
              f"{'missing' if not p.exists() else f'{size/1024:.0f} KiB'}")
        if not ok:
            all_stems_ok = False

    check("all 4 stem files valid on disk", all_stems_ok)

    print("\n" + ("ALL PASS" if not failures else f"FAILURES: {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
