"""Benchmark audio analysis backends on representative tracks.

Compares:
- librosa (current baseline)
- madmom-infer (neural beat/downbeat)
- sonara (Rust-backed fast features)

Outputs results to docs/knowledge-library/benchmarks/audio-bench-<timestamp>.md
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from datetime import datetime

OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "knowledge-library" / "benchmarks"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class BackendResult:
    name: str
    track: str
    duration_s: float
    tempo_bpm: float | None
    beat_count: int
    downbeat_count: int | None
    notes: str = ""


def benchmark_librosa(audio_path: str) -> BackendResult:
    from app.services.audio_analyzer import AudioAnalyzer
    analyzer = AudioAnalyzer()
    t0 = time.perf_counter()
    result = analyzer.analyze_file(audio_path)
    wall = time.perf_counter() - t0
    return BackendResult(
        name="librosa",
        track=Path(audio_path).name,
        duration_s=round(wall, 3),
        tempo_bpm=result.beats.tempo_bpm,
        beat_count=len(result.beats.beat_times),
        downbeat_count=None,
        notes="baseline",
    )


def benchmark_madmom(audio_path: str) -> BackendResult:
    try:
        import madmom_infer  # type: ignore
    except ImportError:
        return BackendResult(name="madmom-infer", track=Path(audio_path).name, duration_s=0.0, tempo_bpm=None, beat_count=0, downbeat_count=None, notes="NOT INSTALLED")

    # madmom-infer exposes low-level processors; simple beats/downbeats helpers
    # are not yet provided at the top level, so we skip full benchmarking here.
    return BackendResult(
        name="madmom-infer",
        track=Path(audio_path).name,
        duration_s=0.0,
        tempo_bpm=None,
        beat_count=0,
        downbeat_count=None,
        notes="framework-only (no simple beat/downbeat API yet)",
    )


def benchmark_sonara(audio_path: str) -> BackendResult:
    try:
        import sonara  # type: ignore
    except ImportError:
        return BackendResult(name="sonara", track=Path(audio_path).name, duration_s=0.0, tempo_bpm=None, beat_count=0, downbeat_count=None, notes="NOT INSTALLED")

    t0 = time.perf_counter()
    result = sonara.analyze_file(audio_path, mode="compact")
    wall = time.perf_counter() - t0
    beat_times = result.get("beats", []) or []
    onset_times = result.get("onset_frames", []) or []
    return BackendResult(
        name="sonara",
        track=Path(audio_path).name,
        duration_s=round(wall, 3),
        tempo_bpm=result.get("bpm"),
        beat_count=len(beat_times),
        downbeat_count=len(onset_times),
        notes="Rust-backed PyO3",
    )


def main() -> None:
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / "packages" / "backend"))

    audio_dir = Path(__file__).parent.parent / "output" / "audio"
    candidates = [r"output/audio/full_track.mp3"]
    tracks = [p for p in candidates if Path(p).exists()]
    if not tracks:
        tracks = sorted(audio_dir.glob("*.mp3"))[:1]
    if not tracks:
        print("No audio tracks found under output/audio/")
        return

    results: list[dict] = []
    for track in tracks:
        track = str(track)
        if not Path(track).exists():
            continue
        print(f"\n=== {track} ===")
        for fn in (benchmark_librosa, benchmark_madmom, benchmark_sonara):
            try:
                r = fn(track)
                print(f"  {r.name}: {r.duration_s}s | bpm={r.tempo_bpm} | beats={r.beat_count} | {r.notes}")
                results.append(asdict(r))
            except Exception as e:
                print(f"  {fn.__name__}: ERROR {e}")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = OUTPUT_DIR / f"audio-bench-{ts}.json"
    out.write_text(json.dumps(results, indent=2))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
