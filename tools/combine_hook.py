#!/usr/bin/env python
"""Combine hook types and function body into the final hook file.

A one-shot codegen step: concatenate ``tools/hook_types.ts`` with the body of
``useVisualizerState.ts`` and write the result back over the latter.

Run from anywhere (paths resolve against the repo root, not the cwd)::

    python tools/combine_hook.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _ioutil import write_text_like  # noqa: E402

TYPES_PATH = ROOT / "tools" / "hook_types.ts"
TARGET = ROOT / "packages" / "frontend" / "src" / "features" / "visualizer" / "useVisualizerState.ts"


def main() -> int:
    for path in (TYPES_PATH, TARGET):
        if not path.is_file():
            print(f"missing input: {path}", file=sys.stderr)
            return 1

    types = TYPES_PATH.read_text(encoding="utf-8")
    function = TARGET.read_text(encoding="utf-8")

    # The function file is expected to contain only the export function; its own
    # docstring is already present in the generated output above.
    result = types + "\n" + function
    write_text_like(TARGET, result)
    print(f"Written: {len(result)} chars -> {TARGET.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
