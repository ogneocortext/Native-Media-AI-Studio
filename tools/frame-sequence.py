"""Frame-sequence utility: inspect gaps and write frames.json manifests.

    python tools/frame-sequence.py inspect <dir> [--pattern frame_%04d.png]
    python tools/frame-sequence.py manifest <dir> --producer NAME --fps 24 --width 1920 --height 1080
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "packages" / "backend"))

from app.services.video.frame_sequence import (  # noqa: E402
    DEFAULT_PATTERN,
    inspect_sequence,
    write_manifest,
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("inspect", help="report frame count, range, and gaps")
    pi.add_argument("directory", type=Path)
    pi.add_argument("--pattern", default=DEFAULT_PATTERN)

    pm = sub.add_parser("manifest", help="write frames.json sidecar")
    pm.add_argument("directory", type=Path)
    pm.add_argument("--producer", required=True)
    pm.add_argument("--fps", type=int, required=True)
    pm.add_argument("--width", type=int, required=True)
    pm.add_argument("--height", type=int, required=True)
    pm.add_argument("--pattern", default=DEFAULT_PATTERN)
    pm.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                    help="extra manifest field, repeatable")

    args = ap.parse_args()

    if args.cmd == "inspect":
        info = inspect_sequence(args.directory, args.pattern)
        print(f"dir          {info.directory}")
        print(f"pattern      {info.pattern}")
        print(f"frames       {info.count}")
        if info.count:
            print(f"range        {info.first_index}..{info.last_index}")
            print(f"contiguous   {info.contiguous}")
        for e in info.errors:
            print(f"ERROR        {e}")
        return 0 if info.contiguous else 1

    extra = {}
    for kv in args.set:
        k, _, v = kv.partition("=")
        extra[k] = v
    out = write_manifest(
        args.directory,
        producer=args.producer,
        fps=args.fps,
        width=args.width,
        height=args.height,
        pattern=args.pattern,
        extra=extra or None,
    )
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
