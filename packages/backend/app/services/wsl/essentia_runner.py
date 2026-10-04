"""Batch tempo estimation with essentia. Runs INSIDE WSL.

Invoked by the Windows backend via `essentia_bridge`, once for many tracks: a
wsl.exe round trip measured 5.65s, so a per-track call would make a 7-track probe
take ~40s. This reads a JSON list of {track, path} on stdin and writes a JSON list
of results to stdout, so one process analyses everything.

Kept in the repo rather than in WSL so it is version-controlled with the rest of
the studio; WSL reads it through /mnt/d.

essentia is Linux-only (its Windows build has no Python bindings), so this is the
only place the library is used. `RhythmExtractor2013` returns a 5-tuple: index 0 is
BPM, index 2 is confidence.
"""

import json
import os
import sys


def main() -> int:
    try:
        from essentia.standard import MonoLoader, RhythmExtractor2013
    except ImportError as exc:
        json.dump({"error": f"essentia unavailable: {exc}"}, sys.stdout)
        return 0

    payload = json.loads(sys.stdin.read() or "[]")
    results = []
    for item in payload:
        track = item.get("track")
        path = item.get("path")
        if not track or not path or not os.path.exists(path):
            # Reported rather than skipped: a silent omission looks like a track
            # that was never asked about, which is how a broken bridge hides.
            results.append({"track": track, "bpm": None, "confidence": None,
                            "error": "missing or unreadable stem"})
            continue
        try:
            audio = MonoLoader(filename=path, sampleRate=44100)()
            extractor = RhythmExtractor2013(method="multifeature")
            out = extractor(audio)
            results.append({
                "track": track,
                "bpm": float(out[0]),
                "confidence": float(out[2]),
                "error": None,
            })
        except Exception as exc:  # noqa: BLE001 - one bad track must not lose the batch
            results.append({"track": track, "bpm": None, "confidence": None,
                            "error": str(exc)[:160]})
    json.dump({"results": results}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
