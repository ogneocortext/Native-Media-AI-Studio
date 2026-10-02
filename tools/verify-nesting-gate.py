#!/usr/bin/env python3
"""Prove the nesting-baseline gate fails on a real regression.

Deepens an *existing* function in a real source file, runs the gate, then
restores the file. This is the mutation check for `report-nesting.py --baseline`:
without it, "the gate passes" is only evidence that it has never been observed
to fail.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TARGET = REPO / "packages" / "backend" / "app" / "api" / "docs.py"
FUNC = "def _parse_frontmatter"


def main() -> int:
    original = TARGET.read_text(encoding="utf-8")
    lines = original.splitlines(keepends=True)

    # Inject the deep block *inside* the existing function's body rather than
    # adding a second function with the same name. Adding a duplicate would not
    # deepen the tracked function at all, which is what made the first version of
    # this script report a false PASS.
    idx = next(i for i, ln in enumerate(lines) if ln.startswith(FUNC))
    body_start = idx
    for i in range(idx + 1, min(idx + 6, len(lines))):
        if lines[i].strip():
            body_start = i
            break
    injected = []
    for d in range(8):
        pad = "    " * (d + 1)
        injected.append(pad + ("if True:\n" if d == 0 else "for _ in range(1):\n"))
    injected.append("    " * 9 + "pass\n")

    mutated = "".join(lines[: body_start + 1]) + "".join(injected) + "".join(lines[body_start + 1 :])
    TARGET.write_text(mutated, encoding="utf-8")
    try:
        proc = subprocess.run(
            [
                sys.executable, "-X", "utf8",
                str(REPO / "tools" / "report-nesting.py"),
                "--baseline", str(REPO / "tools" / "nesting-baseline.json"),
                str(REPO / "packages" / "backend" / "app"),
            ],
            capture_output=True, encoding="utf-8", errors="replace", cwd=REPO,
        )
    finally:
        TARGET.write_text(original, encoding="utf-8")

    out = (proc.stdout or "").strip().splitlines()
    print("\n".join(out[-4:]))
    print(f"exit code: {proc.returncode}")
    if proc.returncode == 0:
        print("\nFAIL: the gate passed on a deliberate nesting regression")
        return 1
    print("\nOK: the gate rejected the regression, and the file was restored")
    return 0


if __name__ == "__main__":
    sys.exit(main())
