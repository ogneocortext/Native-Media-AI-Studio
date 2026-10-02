#!/usr/bin/env python3
"""Snapshot the registered /api/audio routes as a split/regression guard.

audio.py is large enough that it is a candidate for splitting. Any refactor must
leave the public API byte-identical: same paths, same methods, same operation
ids. A split that silently drops or renames one route is a production outage
that no unit test would catch, because the tests call functions, not routes.

So: capture the surface, and diff it before/after.

Usage::

    python tools/snapshot-audio-routes.py --write     # update the baseline
    python tools/snapshot-audio-routes.py --check     # fail if it drifted

--check compares against the committed baseline and is suitable for a gate.
Both forms talk to a running backend, so start it first.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASELINE = REPO / "tools" / "audio_routes_baseline.json"
API = "http://127.0.0.1:8000/openapi.json"
PREFIX = "/api/audio"


def fetch_routes() -> list[str]:
    """Return sorted "METHOD /path" strings for every audio route."""
    with urllib.request.urlopen(API, timeout=20) as resp:
        spec = json.loads(resp.read().decode("utf-8", "replace"))

    routes: list[str] = []
    for path, methods in spec.get("paths", {}).items():
        if not path.startswith(PREFIX):
            continue
        for method, op in methods.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            op_id = (op or {}).get("operationId", "?")
            routes.append(f"{method.upper():6s} {path}  ->  {op_id}")
    return sorted(routes)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true", help="update the baseline")
    group.add_argument("--check", action="store_true", help="diff against baseline")
    args = ap.parse_args()

    try:
        routes = fetch_routes()
    except Exception as exc:
        print(f"could not reach the backend at {API}: {exc}")
        print("start it first:  pwsh -File scripts/manage-servers.ps1 -Action start -Services backend")
        return 2

    if args.write:
        BASELINE.write_text(json.dumps(routes, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {len(routes)} audio routes to {BASELINE.name}")
        return 0

    if not BASELINE.exists():
        print(f"no baseline at {BASELINE.name}; run with --write first")
        return 2

    expected = json.loads(BASELINE.read_text(encoding="utf-8"))
    before, after = set(expected), set(routes)

    removed = sorted(before - after)
    added = sorted(after - before)

    if not removed and not added:
        print(f"audio routes unchanged ({len(routes)} routes)")
        return 0

    print(f"audio route surface changed: {len(removed)} removed, {len(added)} added")
    for route in removed:
        print(f"  REMOVED {route}")
    for route in added:
        print(f"  ADDED   {route}")
    print("\nIf the change is intentional, refresh the baseline with --write.")
    return 1


if __name__ == "__main__":
    sys.exit(main())