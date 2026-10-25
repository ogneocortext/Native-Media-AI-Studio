"""Insight-generating test for the Demucs stem separation API.

Verifies:
1. POST /api/audio/separate returns 200 with all 4 stems (vocals, drums, bass, other)
2. Each stem file exists on disk and is larger than 1 KiB
3. GET /api/audio/stems/{name} lookup returns found=True with all 4 stem URLs
4. The model parameter is correctly reflected in the response

Run from repo root with the backend running:
    python tools/tests/test_demucs_api.py
"""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WAV = ROOT / "tools" / "tests" / "demucs_test_input.wav"

BASE = "http://127.0.0.1:8000"
EXPECTED_STEMS = {"vocals", "drums", "bass", "other"}

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}  {detail}")
    if not ok:
        failures.append(label)


def post_separate(wav_path: Path, model: str = "htdemucs", timeout: int = 600):
    boundary = "----demucstest"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{wav_path.name}"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + wav_path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{BASE}/api/audio/separate?model={model}",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def get_stems_lookup(name: str, timeout: int = 10):
    url = f"{BASE}/api/audio/stems/{name}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read())


def main() -> int:
    if not WAV.exists():
        print(f"FAIL  test input not found: {WAV}")
        return 1

    # 1. POST /api/audio/separate returns 200 with all 4 stems
    try:
        payload = post_separate(WAV)
    except urllib.error.HTTPError as e:
        check("separate HTTP 200", False, f"HTTP {e.code}: {e.read().decode()[:200]}")
        print("\nFAILURES:", failures)
        return 1
    except Exception as e:
        check("separate HTTP 200", False, f"{type(e).__name__}: {e}")
        print("\nFAILURES:", failures)
        return 1

    check("separate success", payload.get("success") is True, payload.get("error", ""))
    check("separate model is htdemucs", payload.get("model") == "htdemucs",
          f"got {payload.get('model')}")

    stems = payload.get("stems", {})
    check("separate returns 4 stems", set(stems.keys()) == EXPECTED_STEMS,
          f"got {set(stems.keys())}")

    # 2. Each stem file exists on disk and is larger than 1 KiB
    all_stems_ok = True
    for name, stem_path in sorted(stems.items()):
        p = Path(stem_path)
        exists = p.exists()
        size = p.stat().st_size if exists else 0
        ok = exists and size > 1024
        check(f"stem file exists and >1 KiB: {name}", ok,
              f"{'missing' if not exists else f'{size/1024:.0f} KiB'}")
        if not ok:
            all_stems_ok = False

    check("all 4 stem files valid on disk", all_stems_ok)

    # 3. GET /api/audio/stems/{name} lookup returns found=True with all 4 stems
    try:
        lookup = get_stems_lookup(WAV.name)
        check("stems lookup found", lookup.get("found") is True)
        lookup_stems = set(lookup.get("stems", {}))
        check("stems lookup returns all 4 stems", lookup_stems == EXPECTED_STEMS,
              f"got {lookup_stems}")
    except Exception as e:
        check("stems lookup HTTP 200", False, f"{type(e).__name__}: {e}")

    print("\n" + ("ALL PASS" if not failures else f"FAILURES: {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
