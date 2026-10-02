"""Auto-fix subprocess calls that decode with the Windows locale codec.

Adds ``encoding="utf-8", errors="replace"`` to any ``subprocess.run`` /
``Popen`` / ``check_output`` / ``check_call`` call that passes ``text=True``
without an ``encoding``. This is the shape that silently mis-decodes UTF-8 on a
cp1252 machine - see check-subprocess-encoding.py for why it matters.

``errors="replace"`` is added with it: without it, output that is not valid in
the chosen encoding raises UnicodeDecodeError inside subprocess, which is a
worse failure than a replacement character.

Run:  python tools/fix-subprocess-encoding.py [--check]
Exit 0 = clean or fixed; --check exits 1 without writing if any call needs it.
"""
from __future__ import annotations

import argparse
import ast
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNERS = {"run", "Popen", "check_output", "check_call", "call"}


def read_source(path: Path) -> str:
    """Read a Python file, tolerating a leading BOM.

    utf-8-sig strips the BOM when present and behaves identically when it is not,
    so this works either way. Plain utf-8 leaves the BOM in the string and
    ast.parse then fails with "invalid non-printable character U+FEFF", which is
    easy to misread as a syntax error in the file rather than an encoding issue.

    PowerShell's ``Set-Content -Encoding UTF8`` writes a BOM, so any file touched
    from the agent shell can have one.
    """
    return path.read_text(encoding="utf-8-sig")


def tracked_python_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "*.py"], cwd=ROOT, capture_output=True,
    ).stdout.decode("utf-8", "replace")
    return [ROOT / rel for rel in out.splitlines() if rel.strip()]


def needs_encoding(node: ast.Call) -> bool:
    if not isinstance(node.func, ast.Attribute) or node.func.attr not in RUNNERS:
        return False
    text_on = False
    for kw in node.keywords:
        if kw.arg in {"text", "universal_newlines"} and isinstance(kw.value, ast.Constant):
            text_on = bool(kw.value.value)
        if kw.arg == "encoding":
            return False
    return text_on


def fix_file(path: Path) -> int:
    """Insert encoding=/errors= into offending calls. Returns the count fixed."""
    original = read_source(path)
    try:
        tree = ast.parse(original, filename=str(path))
    except SyntaxError:
        return 0

    # Two cases, because a single-line call cannot take a new line:
    #
    #   subprocess.run([...], capture_output=True, text=True)
    #       -> insert inline, just before the first keyword
    #
    #   subprocess.run(          # multi-line
    #       [...],
    #       capture_output=True,
    #       text=True,
    #   )
    #       -> insert a whole line before the first keyword
    #
    # Keywords must follow positionals in Python, so the insertion point is
    # always the first keyword - never the end of the call, which would place
    # the new kwarg before text=/timeout= and produce invalid syntax.
    edits: list[tuple[int, int, str]] = []
    line_edits: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and needs_encoding(node)):
            continue
        # Skip calls with no keywords: their first argument is positional, and
        # inserting a kwarg at that line lands before the positional args and
        # yields "positional argument follows keyword argument". Those calls
        # should be rewritten by hand (or moved to _gitutil), not auto-patched.
        # Skip calls with no keywords at all: everything is positional, so there is no
        # keyword to insert before.
        if not node.keywords:
            continue
        # Skip calls whose arguments are not all leading positionals: if the
        # first argument already follows a keyword (e.g. capture_output= comes
        # before input=), there is no valid place to splice in another keyword.
        # Inserting one at that line yields
        # "positional argument follows keyword argument". Those calls need a
        # hand edit or _gitutil, not an auto-patch.
        if any(kw.arg is None for kw in node.keywords):
            continue  # **kwargs cannot be ordered, so be conservative
        first_kw = node.keywords[0]
        # The splice point is the first keyword only when every positional
        # argument precedes it - which is what lineno ordering tells us.
        if node.args and node.args[-1].lineno > first_kw.lineno:
            continue
        new_kw = 'encoding="utf-8", errors="replace"'
        if first_kw.lineno == node.end_lineno:
            # Single line: splice in place, trailing ", " separates it from the
            # keyword that follows.
            edits.append((first_kw.lineno - 1, first_kw.col_offset,
                          new_kw + ", "))
        else:
            # Multi-line: the new line needs its own terminating comma.
            indent = " " * first_kw.col_offset
            line_edits.append((first_kw.lineno - 1, f"{indent}{new_kw},\n"))

    if not edits and not line_edits:
        return 0

    # newline="" disables newline translation. Without it, write_text() maps every
    # "\n" to "\r\n" on Windows, silently converting an LF file to CRLF and
    # turning a one-line fix into a whole-file diff (61 files, ~5k lines) that
    # buries the real change in review.
    with open(path, encoding="utf-8-sig", newline="") as fh:
        lines = fh.read().splitlines(keepends=True)

    for line_idx, col, payload in sorted(edits, reverse=True):
        raw = lines[line_idx]
        newline = "\n" if raw.endswith("\n") else ""
        lines[line_idx] = raw[:col] + payload + raw[col:].rstrip("\r\n") + newline
    for line_idx, payload in sorted(line_edits, reverse=True):
        lines.insert(line_idx, payload)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write("".join(lines))

    # Prove the result still parses; a bad edit must not be committed.
    ast.parse(read_source(path), filename=str(path))
    return len(edits) + len(line_edits)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="report without writing; exit 1 if anything needs fixing")
    args = ap.parse_args()

    total = 0
    touched: list[tuple[Path, int]] = []
    for path in tracked_python_files():
        try:
            tree = ast.parse(read_source(path), filename=str(path))
        except (OSError, UnicodeDecodeError, SyntaxError):
            continue
        count = sum(
            1 for n in ast.walk(tree)
            if isinstance(n, ast.Call) and needs_encoding(n)
        )
        if count:
            touched.append((path, count))
            total += count

    if not touched:
        print("no subprocess calls decode with the locale codec")
        return 0

    for path, count in touched:
        try:
            rel = path.relative_to(ROOT)
        except ValueError:
            rel = path
        print(f"{rel}: {count}")

    print(f"\ntotal: {total} call(s) in {len(touched)} file(s)")
    if args.check:
        return 1

    fixed = 0
    for path, _ in touched:
        fixed += fix_file(path)
    print(f"fixed {fixed} call(s)")
    print("Run the gates afterwards:  python tools/run-gates.py --only ruff type")
    return 0


if __name__ == "__main__":
    sys.exit(main())
