"""Insight-generating test for the regex pattern at database.py line 520 (binary read).

Verifies that the re.compile() raw string literal on line 520 of
packages/backend/app/core/database.py compiles as a valid regex when read
in binary mode and decoded.

Run from repo root:
    python tools/tests/test_regex4.py
"""

import re
import sys
from pathlib import Path

DB_PATH = Path(
    r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio"
    r"\packages\backend\app\core\database.py"
)

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}  {detail}")
    if not ok:
        failures.append(label)


def main() -> int:
    if not DB_PATH.exists():
        print(f"FAIL  database.py not found: {DB_PATH}")
        return 1

    lines = DB_PATH.read_bytes().splitlines()
    # Line 1349 (1-indexed) = index 1348: _NORMALIZE_LINE_NUMBER_RE
    line = lines[1348]
    decoded = line.decode("utf-8")

    # Find the raw string literal
    start = decoded.index("re.compile(") + len("re.compile(")
    end = decoded.rindex(")")
    raw_literal = decoded[start:end].strip()

    # Evaluate it
    pattern_str = eval(raw_literal)

    check("pattern extracted from line 520 (binary read)", bool(pattern_str),
          f"len={len(pattern_str)}")

    # Compile the pattern
    try:
        compiled = re.compile(pattern_str)
        check("regex compiles successfully", True,
              f"pattern={pattern_str!r}")
    except re.error as e:
        check("regex compiles successfully", False, f"FAIL: {e}")
        compiled = None

    if compiled:
        test_string = r"\123.py:42"
        match = compiled.search(test_string)
        check("pattern matches \\d+.py:style strings", match is not None,
              f"test={test_string!r} match={match}")

    print("\n" + ("ALL PASS" if not failures else f"FAILURES: {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
