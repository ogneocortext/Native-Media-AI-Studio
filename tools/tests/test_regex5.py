"""Insight-generating test for the regex pattern at database.py line 520.

Verifies the pattern compiles and reports character details for debugging,
then confirms the pattern is a valid regex that matches expected strings.

Run from repo root:
    python tools/tests/test_regex5.py
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
    line = lines[1348]
    decoded = line.decode("utf-8")

    # Find the raw string literal
    start = decoded.index("re.compile(") + len("re.compile(")
    end = decoded.rindex(")")
    raw_literal = decoded[start:end].strip()

    pattern_str = eval(raw_literal)

    check("pattern extracted", bool(pattern_str), f"len={len(pattern_str)}")

    # Report character details (debugging aid retained)
    for i, c in enumerate(pattern_str):
        print(f"  {i}: {repr(c)} (ord={ord(c)})")

    # Compile the pattern - the key assertion
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
