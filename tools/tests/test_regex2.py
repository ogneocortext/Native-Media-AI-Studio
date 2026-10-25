"""Insight-generating test for the regex pattern at database.py line 520.

Verifies that the re.compile() raw string literal on line 520 of
packages/backend/app/core/database.py compiles as a valid regex.

Run from repo root:
    python tools/tests/test_regex2.py
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

    lines = DB_PATH.read_text(encoding="utf-8").splitlines()
    # Line 1349 (1-indexed) = index 1348: _NORMALIZE_LINE_NUMBER_RE
    line = lines[1348]

    # Extract the raw string literal from re.compile(...)
    start = line.index("re.compile(") + len("re.compile(")
    end = line.rindex(")")
    raw_literal = line[start:end].strip()

    # Evaluate the raw string literal
    pattern_str = eval(raw_literal)

    check("pattern extracted from line 520", bool(pattern_str),
          f"len={len(pattern_str)}")

    # Compile the pattern - this is the key assertion
    try:
        compiled = re.compile(pattern_str)
        check("regex compiles successfully", True,
              f"pattern={pattern_str!r}")
    except re.error as e:
        check("regex compiles successfully", False, f"{e}")
        compiled = None

    if compiled:
        # Smoke test: the pattern should match at least something reasonable
        # (it's designed to match \d+.py patterns)
        test_string = r"\123.py:42"
        match = compiled.search(test_string)
        check("pattern matches \\d+.py:style strings", match is not None,
              f"test={test_string!r} match={match}")

    print("\n" + ("ALL PASS" if not failures else f"FAILURES: {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
