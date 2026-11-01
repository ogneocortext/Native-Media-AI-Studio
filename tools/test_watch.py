"""
tools/test_watch.py

Watch-mode test runner for development sessions.

Watches backend source and test files for changes and automatically re-runs
the fast-gate test suite (sub-10s feedback loop) whenever a file changes.

This enables the Red-Green-Refactor TDD cycle: tests run automatically on
every save, giving instant feedback without manual intervention.

Usage:

    python tools/test_watch.py              # watch all backend files
    python tools/test_watch.py --only audio # watch only audio-related files
    python tools/test_watch.py --pattern "*.py"  # custom glob pattern

Exits on Ctrl-C.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "packages" / "backend"
OUT_DIR = ROOT / "tools" / "test-insights-out"

WATCH_DIRS = [BACKEND / "app", BACKEND / "tests"]
IGNORE_DIRS = {"__pycache__", ".pytest_cache", ".git", "node_modules"}


def file_fingerprint(path: Path) -> str:
    """Return a hash of the file's contents for change detection."""
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except Exception:
        return ""


def snapshot() -> dict[str, str]:
    """Snapshot current file contents for all watched files."""
    fingerprints: dict[str, str] = {}
    for watch_dir in WATCH_DIRS:
        if not watch_dir.is_dir():
            continue
        for path in watch_dir.rglob("*.py"):
            if any(part in IGNORE_DIRS for part in path.parts):
                continue
            fingerprints[str(path)] = file_fingerprint(path)
    return fingerprints


def run_fast_gate(only: str | None = None) -> int:
    """Run the fast-gate test suite via test_insights.py."""
    import subprocess

    cmd = [
        sys.executable, "tools/test_insights.py",
        "--fast-gate", "--html", "--json",
    ]
    if only:
        cmd.extend(["--only", only])

    print(f"\n[{time.strftime('%H:%M:%S')}] Running fast-gate tests...",
          file=sys.stderr)
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                          encoding="utf-8")
    print(proc.stdout, end="")
    if proc.stderr:
        print(proc.stderr, end="", file=sys.stderr)
    return proc.returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Watch-mode test runner for NMA Studio backend")
    parser.add_argument("--only", metavar="FEATURE",
                        help="only run tests matching this feature keyword")
    parser.add_argument("--interval", type=float, default=2.0,
                        help="polling interval in seconds (default: 2.0)")
    parser.add_argument("--pattern", metavar="GLOB", default="*.py",
                        help="file pattern to watch (default: *.py)")
    args = parser.parse_args()

    print(f"[test_watch] Watching {', '.join(str(d) for d in WATCH_DIRS)}")
    print(f"[test_watch] Polling every {args.interval}s. Press Ctrl-C to stop.\n")

    last_snapshot = snapshot()

    # Run once immediately.
    rc = run_fast_gate(args.only)
    print(f"\n[{time.strftime('%H:%M:%S')}] Initial run complete "
          f"(exit code {rc}). Waiting for changes...\n")

    try:
        while True:
            time.sleep(args.interval)
            current = snapshot()
            if current != last_snapshot:
                changed = [k for k in current if k not in last_snapshot
                           or current[k] != last_snapshot[k]]
                print(f"\n[{time.strftime('%H:%M:%S')}] Detected changes:")
                for f in changed[:5]:
                    print(f"  - {f}")
                if len(changed) > 5:
                    print(f"  ... and {len(changed) - 5} more")
                last_snapshot = current
                rc = run_fast_gate(args.only)
                print(f"\n[{time.strftime('%H:%M:%S')}] Re-run complete "
                      f"(exit code {rc}). Waiting for changes...\n")
    except KeyboardInterrupt:
        print("\n[test_watch] Stopped by user.")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
