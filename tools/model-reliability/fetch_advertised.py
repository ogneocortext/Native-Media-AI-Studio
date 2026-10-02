#!/usr/bin/env python3
"""Snapshot advertised-free model lists from provider websites/APIs.

Public data only: no API keys, no account access, no model probing.
Run weekly, or before choosing a model for a long session:

    python tools/model-reliability/fetch_advertised.py

Writes tools/model-reliability/snapshots/<source>-YYYYMMDD-HHMMSS.json
(one file per source; score.py uses the latest per source).
"""

import datetime
import json
import os
import sys
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
SNAP_DIR = os.path.join(BASE, "snapshots")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def is_zero(v):
    try:
        return float(v) == 0.0
    except (TypeError, ValueError):
        return False


def fetch_openrouter():
    """Free = $0 prompt AND $0 completion on the public models API."""
    d = get_json("https://openrouter.ai/api/v1/models")
    out = []
    for m in d.get("data", []):
        p = m.get("pricing", {})
        if is_zero(p.get("prompt")) and is_zero(p.get("completion")):
            out.append({"id": m["id"], "context_length": m.get("context_length")})
    return out


def fetch_kilo():
    """Free = isFree flag on the public Kilo gateway models endpoint."""
    d = get_json("https://api.kilo.ai/api/gateway/models")
    return [
        {"id": m["id"], "context_length": m.get("context_length")}
        for m in d.get("data", [])
        if m.get("isFree") is True
    ]


SOURCES = {"openrouter": fetch_openrouter, "kilo": fetch_kilo}


def main():
    os.makedirs(SNAP_DIR, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = now.strftime("%Y%m%d-%H%M%S")
    for name, fn in SOURCES.items():
        try:
            models = fn()
        except Exception as e:  # noqa: BLE001 - report, keep other sources
            print(f"{name}: FETCH FAILED ({e})", file=sys.stderr)
            continue
        snap = {
            "source": name,
            "fetched_at": now.isoformat(),
            "model_count": len(models),
            "models": sorted(models, key=lambda m: m["id"]),
        }
        path = os.path.join(SNAP_DIR, f"{name}-{stamp}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(snap, f, indent=1)
        print(f"{name}: {len(models)} advertised-free -> {os.path.basename(path)}")


if __name__ == "__main__":
    main()
