"""Insight-generating test for a hardcoded regex pattern.

Verifies that the regex pattern compiles successfully and matches digit
sequences preceding .py: or .py  in a path-like string.

Run from repo root:
    python tools/tests/test_regex3.py
"""

import re
import sys

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}  {detail}")
    if not ok:
        failures.append(label)


def main() -> int:
    pat = r"(?<=\\)\d+(?=\.py[:\s])"

    # 1. Pattern compiles
    try:
        compiled = re.compile(pat)
        check("regex compiles successfully", True,
              f"pattern={pat!r}")
    except re.error as e:
        check("regex compiles successfully", False, f"FAIL: {e}")
        compiled = None

    # 2. Pattern matches digits before .py: or .py  in path-like strings
    if compiled:
        test_cases = [
            (r"C:\Users\foo\bar\123.py:42", "123"),
            (r"C:\Users\foo\bar\456.py:100", "456"),
            (r"C:\Users\foo\bar\789.py ", "789"),
            (r"C:\Users\foo\bar\number.txt:42", None),  # not .py
            (r"C:\Users\foo\bar\123.py", None),  # no colon or space after .py
        ]
        for test_str, expected in test_cases:
            match = compiled.search(test_str)
            if expected is None:
                check(f"no match for non-.py or missing suffix: {test_str!r}",
                      match is None,
                      f"got {match.group() if match else None}")
            else:
                check(f"match digits for {test_str!r}", match is not None,
                      f"got {match.group() if match else None}")
                if match:
                    check(f"captured digits = {expected}", match.group() == expected,
                          f"got {match.group()!r}")

    print("\n" + ("ALL PASS" if not failures else f"FAILURES: {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
