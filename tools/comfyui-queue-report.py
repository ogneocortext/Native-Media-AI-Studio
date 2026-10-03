#!/usr/bin/env python
"""Report what ComfyUI is actually doing, so its queue is not misdiagnosed.

ComfyUI has looked unreliable in this project for about a year. It was not: it
completes images in a median of ~11s, while the client waited 300s and then left
the prompt running inside ComfyUI (fixed in D29). A deep ComfyUI queue therefore
reads as "ComfyUI is broken" when it usually means prompts were orphaned.

This reports the three things that distinguish those cases:
  1. How long prompts actually took, from ComfyUI's own /history.
  2. The live queue depth, and what kind of work is queued.
  3. Whether the queued prompt ids appear in our own logs. An id that is queued
     but in none of our logs is not in-flight work of ours - it is an orphan, or
     another client's job.

Read-only: it never cancels anything. Clearing a backlog is a deliberate act
because those prompts may be real work from another tool.

Usage:
    python tools/comfyui-queue-report.py [--url http://127.0.0.1:8188]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

DEFAULT_URL = "http://127.0.0.1:8188"
LOG_DIR = Path(__file__).resolve().parent.parent / "output" / "logs"

#: Node classes that mean "this is a video render", which takes minutes rather
#: than seconds and therefore dominates a queue's wall-clock.
VIDEO_MARKERS = ("Wan", "AnimateDiff", "VHS_", "VideoHelperSuite", "SVD")


def _get_json(url: str, path: str, timeout: float = 25.0):
    with urllib.request.urlopen(url.rstrip("/") + path, timeout=timeout) as r:
        return json.load(r)


def durations(history: dict) -> list[float]:
    """Seconds per completed prompt, from /history status messages."""
    out: list[float] = []
    for entry in history.values():
        start = end = None
        for kind, payload in (entry.get("status", {}) or {}).get("messages", []):
            if not isinstance(payload, dict):
                continue
            ts = payload.get("timestamp")
            if kind == "execution_start":
                start = ts
            elif kind in ("execution_success", "execution_error"):
                end = ts
        if start is not None and end is not None and end >= start:
            out.append((end - start) / 1000.0)
    return sorted(out)


def workflow_kinds(rows: list) -> Counter:
    kinds: Counter = Counter()
    for row in rows:
        prompt = row[2] if len(row) > 2 else {}
        classes = [
            str(n.get("class_type", ""))
            for n in (prompt or {}).values()
            if isinstance(n, dict)
        ]
        kinds["video" if any(m in c for c in classes for m in VIDEO_MARKERS) else "image/other"] += 1
    return kinds


def load_log_text(limit_bytes: int = 4_000_000) -> str:
    if not LOG_DIR.is_dir():
        return ""
    chunks: list[str] = []
    total = 0
    for f in sorted(LOG_DIR.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True):
        if total >= limit_bytes:
            break
        try:
            with open(f, "rb") as fh:
                fh.seek(0, 2)
                size = fh.tell()
                fh.seek(max(0, size - limit_bytes // 4))
                chunks.append(fh.read().decode("utf-8", errors="replace"))
                total += size // 4
        except OSError:
            continue
    return "\n".join(chunks)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--url", default=DEFAULT_URL, help="ComfyUI base URL")
    args = ap.parse_args(argv)
    url = args.url

    print(f"ComfyUI queue report - {url}\n" + "=" * 46)

    # 1. Durations from ComfyUI itself.
    try:
        history = _get_json(url, "/history")
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"  ERROR: cannot read {url}/history: {e}")
        print("  ComfyUI may be down. That is not the same as 'unreliable'.")
        return 2

    ds = durations(history)
    if ds:
        p90 = ds[min(len(ds) - 1, int(len(ds) * 0.9))]
        print(f"\ncompleted prompts : {len(history)} (with timing: {len(ds)})")
        print(f"  min={ds[0]:.1f}s  median={ds[len(ds)//2]:.1f}s  "
              f"p90={p90:.1f}s  max={ds[-1]:.1f}s")
        over = sum(1 for d in ds if d > 300)
        if over:
            print(f"  !! {over} prompt(s) exceeded 300s - check whether a client "
                  "timeout is shorter than a legitimate render")
        else:
            print("  none exceeded 300s, so a 'timed out after 300s' error means "
                  "the client gave up early, not that ComfyUI was slow")
    else:
        print("\ncompleted prompts : %d (no timing in history)" % len(history))

    # 2. Live queue.
    try:
        q = _get_json(url, "/queue", timeout=15)
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"\n  ERROR: cannot read /queue: {e}")
        return 2

    running = q.get("queue_running", []) or []
    pending = q.get("queue_pending", []) or []
    print(f"\nlive queue        : running={len(running)} pending={len(pending)}")

    if pending:
        nums = [r[0] for r in pending if isinstance(r, (list, tuple)) and r]
        if nums:
            print(f"  queue numbers   : {min(nums)}..{max(nums)} "
                  f"(history holds {len(history)} entries)")
            if min(nums) > len(history):
                print("  -> submitted after the last completed prompt and never "
                      "collected")
        print(f"  pending by kind : {dict(workflow_kinds(pending))}")
    for row in running:
        prompt = row[2] if len(row) > 2 else {}
        classes = sorted({
            str(n.get("class_type", "?")) for n in (prompt or {}).values()
            if isinstance(n, dict)
        })
        pid = row[1] if len(row) > 1 else "?"
        print(f"  running prompt  : {pid} [{', '.join(classes)[:70]}]")

    # 3. Is the backlog ours?
    ids = [r[1] for r in list(running) + list(pending)
           if isinstance(r, (list, tuple)) and len(r) > 1]
    if ids:
        log_text = load_log_text()
        ours = [i for i in ids if i and re.search(re.escape(i), log_text)]
        orphans = [i for i in ids if i not in ours]
        print(f"\nprovenance        : {len(ours)}/{len(ids)} queued ids appear in our logs")
        if orphans and not ours:
            print("  -> NONE of the queued prompts are ours. The backlog is orphaned")
            print("     work or another client's, not evidence this backend is stuck.")
        elif orphans:
            print(f"  -> {len(orphans)} queued id(s) absent from our logs "
                  "(orphaned, or not ours)")

    print("\nRead-only. Cancelling prompts is deliberate: a queued prompt may be "
          "real work\nfrom another tool. See "
          "docs/knowledge-library/backend-debugging-guide.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
