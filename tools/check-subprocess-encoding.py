"""Reject subprocess calls that decode output with the Windows locale codec.

Three separate bugs during the checkpoint work had the same root cause: reading
a subprocess's bytes without specifying an encoding.

  - ``subprocess.run([...], capture_output=True, text=True)`` with no
    ``encoding`` decodes with the **locale** codec, which is cp1252 on this
    machine. A UTF-8 BOM then arrives as the three characters "ï»¿" instead of
    U+FEFF, so BOM-stripping silently did nothing and a commit already on main
    was reported as missing.
  - The same call returns ``stdout=None`` when a command exits non-zero or emits
    undecodable bytes. That ``None`` propagates into string concatenation and
    fails a long way from the cause.
  - ``subprocess.run(...)`` with ``text=True`` also returns ``str``, so
    ``.encode()`` / ``.decode()`` on the result raises ``AttributeError``.

This is the same class of bug ``check-text-encoding.py`` catches in files, seen
from the other end: that one rejects UTF-16 and NUL bytes in tracked text, this
one rejects locale-decoded subprocess output in tracked Python.

``capture_output=True`` with ``text=True`` and no ``encoding`` is the exact
pattern. Use ``tools/_gitutil.py`` (run_git) for git, or decode explicitly:

    subprocess.run(cmd, capture_output=True).stdout.decode("utf-8", "replace")

Run:  python tools/check-subprocess-encoding.py [--verbose]
Exit 0 = clean, 1 = at least one violation.
"""
from __future__ import annotations

import argparse
import ast
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def read_source(path: Path) -> str:
    """Read a Python file, tolerating a leading BOM.

    utf-8-sig strips the BOM when present and behaves identically when it is not.
    Plain utf-8 leaves the BOM in the string and ast.parse then fails with
    "invalid non-printable character U+FEFF", which reads like a syntax error in
    the file rather than an encoding issue. PowerShell's
    ``Set-Content -Encoding UTF8`` writes a BOM, so any file touched from the
    agent shell can have one.
    """
    return path.read_text(encoding="utf-8-sig")


def tracked_python_files() -> list[Path]:
    """Tracked .py files only.

    Ignored build output must never fail a hook, so this cannot use a glob over
    the working tree.
    """
    out = subprocess.run(
        ["git", "ls-files", "*.py"], cwd=ROOT, capture_output=True,
    ).stdout.decode("utf-8", "replace")
    return [ROOT / rel for rel in out.splitlines() if rel.strip()]


def text_mode_true(call: ast.Call) -> bool:
    for kw in call.keywords:
        if kw.arg == "text" and isinstance(kw.value, ast.Constant):
            return bool(kw.value.value)
        # universal_newlines is the older alias with the same problem.
        if kw.arg == "universal_newlines" and isinstance(kw.value, ast.Constant):
            return bool(kw.value.value)
    return False


def find_violations(path: Path) -> list[tuple[int, str]]:
    """Return (line, reason) for each locale-decoding subprocess call."""
    try:
        tree = ast.parse(read_source(path), filename=str(path))
    # A checker that silently stops checking is worse than no checker: a file it
    # cannot parse would be skipped, so the defect it is meant to catch could
    # return unnoticed. A file that does not parse is itself reported.
    except SyntaxError as exc:
        return [(exc.lineno or 0, f"file does not parse ({exc.msg}) - "
                                 "cannot check, and this is a syntax error")]

    bad: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute)
                and func.attr in {"run", "Popen", "check_output", "call"}):
            continue
        if not text_mode_true(node):
            continue
        has_encoding = any(kw.arg == "encoding" for kw in node.keywords)
        if has_encoding:
            continue
        bad.append((
            node.lineno,
            "text=True without encoding= decodes with the locale codec "
            "(cp1252 here); a UTF-8 BOM becomes mojibake. "
            "Use tools/_gitutil.run_git() or decode explicitly.",
        ))
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    files = tracked_python_files()
    offenders: list[tuple[Path, int, str]] = []
    for path in files:
        for line, reason in find_violations(path):
            offenders.append((path, line, reason))

    if args.verbose:
        print(f"scanned {len(files)} tracked Python files")

    if not offenders:
        print(f"no locale-decoded subprocess calls ({len(files)} files scanned)")
        return 0

    print(f"FAILED: {len(offenders)} subprocess call(s) decode with the "
          f"locale codec")
    for path, line, reason in offenders:
        try:
            rel = path.relative_to(ROOT)
        except ValueError:
            rel = path
        print(f"  {rel}:{line}: {reason}")

    print("\nFix by using the shared helper for git:")
    print("  from _gitutil import run_git, git_lines, delete_ref")
    print("\nor decode explicitly elsewhere:")
    print('  subprocess.run(cmd, capture_output=True)'
          '.stdout.decode("utf-8", "replace")')
    return 1


if __name__ == "__main__":
    sys.exit(main())
