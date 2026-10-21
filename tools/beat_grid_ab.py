"""Beat-grid A/B: run every available beat backend on one track and compare.

Built for the 2026-10 beat-accuracy work. A track analysis came back at
~77% beat confidence with three backends in the codebase (librosa,
madmom, sonara) and no measured way to say whose grid was right. This
tool runs them all on the same decoded buffer, prints tempo / beat
count / beat_confidence side by side, and writes one
beat-over-onset-envelope PNG per backend so a human (or a vision model)
can see which grid actually lands on the drum hits.

Usage:
    python tools/beat_grid_ab.py <audio_path> [--out DIR]

Backends are optional: one whose package is not installed is reported
as unavailable instead of failing the run. The librosa-legacy leg
recreates the pre-c2256d7 behaviour (full mix, fixed 120 BPM prior) so
old-vs-new is measured on the same file, not remembered.

Outputs (default dir: output/beat-grid-ab/):
    <stem>.beat-grid-ab.json  — full results incl. beat times
    <stem>-<backend>.png      — beats plotted over the onset envelope
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from tools.lib.audio import _beat_onset_envelope, analyze_beats, load_audio
from tools.lib.paths import add_backend_to_path

add_backend_to_path()

HOP = 512
SR = 22050


def _record(results: list, name: str, tempo, beat_times, confidence, note: str = "") -> None:
    results.append(
        {
            "backend": name,
            "tempo": round(float(tempo), 2),
            "beats": len(beat_times),
            "confidence": round(float(confidence), 3),
            "beat_times": [round(float(t), 3) for t in beat_times],
            "note": note,
        }
    )


def _error(results: list, name: str, message: str) -> None:
    results.append({"backend": name, "error": message})


def run_backends(y, sr: int) -> list:
    import librosa
    import numpy as np
    from app.services import audio_analyzer as aa

    results: list = []

    # Legacy librosa: the behaviour analyze_beats replaced in c2256d7.
    try:
        tempo, beats = librosa.beat.beat_track(
            y=y, sr=sr, hop_length=HOP, start_bpm=120.0, tightness=100.0
        )
        times = librosa.frames_to_time(beats, sr=sr, hop_length=HOP).tolist()
        t = float(np.atleast_1d(tempo)[0])
        _record(
            results,
            "librosa-legacy",
            t,
            times,
            aa.beat_confidence(times, t),
            "full mix, fixed 120 prior (pre-c2256d7)",
        )
    except Exception as exc:  # a failed leg is data, not a crashed run
        _error(results, "librosa-legacy", f"{type(exc).__name__}: {exc}")

    # Current librosa: percussive envelope + two-pass tempo + rescoring.
    try:
        r = analyze_beats(y, sr, use_gpu=False)
        note = f"prior={r['start_bpm_used']:.1f}"
        if r.get("tempo_rescored_from"):
            note += f", rescored from {r['tempo_rescored_from']}"
        _record(
            results,
            "librosa",
            r["tempo"],
            r["beat_times"],
            aa.beat_confidence(r["beat_times"], r["tempo"]),
            note,
        )
    except Exception as exc:
        _error(results, "librosa", f"{type(exc).__name__}: {exc}")

    # madmom (RNN+DBN) on the decoded buffer, via the analyzer's own path.
    if getattr(aa, "MADMOM_AVAILABLE", False):
        try:
            feats = aa.AudioAnalyzer()._madmom_beats_from_signal(y, sr)
            _record(
                results,
                "madmom",
                feats.tempo_bpm,
                feats.beat_times,
                feats.confidence,
                "RNN+DBN grid",
            )
        except Exception as exc:
            _error(results, "madmom", f"{type(exc).__name__}: {exc}")
    else:
        _error(results, "madmom", "madmom_infer not installed")

    # sonara (Rust) on the decoded buffer.
    if getattr(aa, "SONARA_AVAILABLE", False):
        try:
            feats = aa.AudioAnalyzer()._sonara_beats_from_signal(y, sr)
            _record(
                results, "sonara", feats.tempo_bpm, feats.beat_times, feats.confidence, "Rust grid"
            )
        except Exception as exc:
            _error(results, "sonara", f"{type(exc).__name__}: {exc}")
    else:
        _error(results, "sonara", "sonara not installed")

    return results


def write_plots(y, sr: int, results: list, out_dir: Path, stem: str) -> list:
    """One PNG per successful backend: beats over the onset envelope."""
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not available — skipping plots")
        return []

    import librosa

    env = _beat_onset_envelope(y, sr, HOP)
    env_times = librosa.frames_to_time(range(len(env)), sr=sr, hop_length=HOP)
    written = []
    for r in results:
        if "error" in r:
            continue
        fig, ax = plt.subplots(figsize=(14, 3))
        ax.plot(env_times, env, linewidth=0.5, color="#666666")
        for t in r["beat_times"]:
            ax.axvline(t, color="#d62728", linewidth=0.5, alpha=0.7)
        ax.set_xlim(0, float(env_times[-1]) if len(env_times) else 0)
        ax.set_xlabel("seconds")
        ax.set_ylabel("onset strength")
        ax.set_title(
            f"{stem} — {r['backend']}: {r['tempo']:.1f} BPM, "
            f"{r['beats']} beats, confidence {r['confidence']:.3f}"
        )
        fig.tight_layout()
        path = out_dir / f"{stem}-{r['backend']}.png"
        fig.savefig(path, dpi=110)
        plt.close(fig)
        written.append(str(path))
    return written


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("audio", help="Path to the audio file to analyze")
    parser.add_argument(
        "--out",
        default="output/beat-grid-ab",
        help="Directory for the JSON report and PNGs (default: output/beat-grid-ab)",
    )
    args = parser.parse_args(argv)

    audio_path = Path(args.audio)
    if not audio_path.exists():
        print(f"Audio file not found: {audio_path}", file=sys.stderr)
        return 2

    y, sr = load_audio(audio_path, sr=SR)
    if len(y) == 0:
        print(f"Audio file decoded to zero samples: {audio_path}", file=sys.stderr)
        return 2

    results = run_backends(y, sr)

    print(f"\n=== Beat-grid A/B: {audio_path.name} ({len(y) / sr:.1f} s @ {sr} Hz) ===")
    print(f"{'backend':<16} {'tempo':>7} {'beats':>6} {'conf':>6}  note")
    for r in results:
        if "error" in r:
            print(f"{r['backend']:<16} {'—':>7} {'—':>6} {'—':>6}  UNAVAILABLE: {r['error']}")
        else:
            print(
                f"{r['backend']:<16} {r['tempo']:>7.1f} {r['beats']:>6} "
                f"{r['confidence']:>6.3f}  {r['note']}"
            )

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = audio_path.stem.replace(" ", "-")
    report = {
        "audio_file": str(audio_path),
        "sample_rate": sr,
        "duration_seconds": round(len(y) / sr, 3),
        "results": results,
    }
    json_path = out_dir / f"{stem}.beat-grid-ab.json"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nReport: {json_path}")

    for p in write_plots(y, sr, results, out_dir, stem):
        print(f"Plot:   {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
