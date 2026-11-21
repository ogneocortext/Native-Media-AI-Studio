#!/usr/bin/env python3
"""Fail when a tracked text file's dominant line-ending style flips vs HEAD.

Why this gate exists
--------------------
Most of this repo is LF (3,634 of 4,078 tracked text files by the 2026-11-21
census), but 418 files are CRLF and 21 contain both styles, because different
agents' editors and tools disagree and `.gitattributes` pins LF for only three
directories.

An internally-consistent CRLF file is harmless. The damage is a **flip**: a tool
rewrites a CRLF-stored file with LF endings (or the reverse), and git then
reports every line as changed. This is not hypothetical — it is what
`Path.write_text` does on Windows, where text-mode writes translate every
`"\\n"` to `"\\r\\n"`:

    Path("t.txt").write_text("a\\nb\\nc\\n", encoding="utf-8")
    # -> b'a\\r\\nb\\r\\nc\\r\\n'   (measured, Python 3.11 win32)

During the 2026-11-21 work that turned a 41-line append into a 795-line diff and
six files had to be repaired by hand. `.gitattributes` records the same failure
in commit 22ff3d5: a 20-line edit produced 234 added / 234 deleted.

No existing gate caught it. `check-text-encoding.py` validates UTF-8 and never
looks at `\\r`; `validate-knowledge-tags.py` checks CRLF but only under
`docs/knowledge-library/`; `check-banned-chars.py` does not inspect CR.

What "style" means here
-----------------------
The **dominant** style: whichever of LF-only / CRLF-only appears more. A file
with 274 CRLF lines and one lone LF line is a CRLF file; that lone line is drift,
not the style. Comparing dominant styles is what detects the real failure while
leaving ordinary mixed files (which are drift, not flips) alone.

Only files that **differ from HEAD** are checked. That is precisely the set a
change is about to commit; it never fires on untouched files, so the 418 existing
CRLF files stay as they are (re-normalising them is a 4,500-file change belonging
in its own commit) and the gate needs no baseline file.

Usage::

    python tools/check-line-endings.py            # check the working tree
    python tools/check-line-endings.py --staged   # check the index instead
    python tools/check-line-endings.py --fix      # rewrite offenders to HEAD's style

Exit 0 = no flips (or all repaired with --fix), 1 = at least one flip.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from _ioutil import CRLF, LF, UNKNOWN  # noqa: E402

# Extensions treated as text. Anything else (images, audio, models, archives) is
# skipped: `.gitattributes` marks those binary, and counting newlines in a 4 GB
# .gguf would be absurd.
TEXT_SUFFIXES = {
    ".py", ".md", ".json", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".yml", ".yaml", ".toml", ".txt", ".ps1", ".psm1", ".go", ".rs", ".cs",
    ".sh", ".css", ".scss", ".html", ".cfg", ".ini", ".sql", ".glsl",
    ".vert", ".frag", ".comp", ".hlsl", ".shader", ".xml", ".csv",
}

# Generated or vendored trees where line endings are not ours to enforce.
SKIP_PREFIXES = (
    "node_modules/", "output/", "storage/", "venv/", ".venv/",
    "huggingface_cache/", "third_party/",
)

# Below this many newlines a file's dominant style is not meaningful (a two-line
# file is one style by construction), so it is left alone.
_MIN_NEWLINES = 4


def git(*args: str, binary: bool = False):  # noqa: FBT002 - internal helper
    """Run git and return stdout as bytes/str, or None when the command fails."""
    proc = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, check=False
    )
    if proc.returncode != 0:
        return None
    return proc.stdout if binary else proc.stdout.decode("utf-8", "replace")


def style_of(data: bytes) -> str:
    """Dominant line-ending style of an in-memory blob.

    ``"lf"`` / ``"crlf"`` when one style clearly dominates, ``"unknown"`` when
    there is nothing to classify (binary, tiny, or no newlines at all).

    A mixed file resolves to its **majority** style rather than being rejected:
    a lone stray line is drift, and treating the whole file as unclassifiable
    would let a real flip through whenever a file happens to contain one.
    """
    if len(data) < 64 or b"\x00" in data[:4096]:
        return UNKNOWN
    crlf = data.count(b"\r\n")
    lf = data.count(b"\n") - crlf
    if crlf + lf < _MIN_NEWLINES:
        return UNKNOWN
    if crlf and not lf:
        return CRLF
    if lf and not crlf:
        return LF
    # Mixed: majority wins; ties go to LF, the repo's dominant style.
    return LF if lf >= crlf else CRLF


def changed_files(*, staged: bool) -> list[str]:
    """Tracked files that differ from HEAD (index instead when staged=True)."""
    args = ["diff", "--name-only"]
    if staged:
        args.append("--cached")
    args.append("HEAD")
    out = git(*args)
    if out is None:
        return []
    return [line for line in out.split("\n") if line]


def is_text(rel: str) -> bool:
    if rel.startswith(SKIP_PREFIXES):
        return False
    return Path(rel).suffix.lower() in TEXT_SUFFIXES


def _restore_style(disk: bytes, head: bytes | None, want: str, got: str) -> bytes:
    """Return ``disk`` with its line endings converted from ``got`` to ``want``.

    Unchanged lines keep HEAD's **exact** terminator (so a stray LF line inside
    an otherwise-CRLF file stays a stray LF line), and lines the edit added or
    removed get the dominant style. A naive "join every line with CRLF" instead
    rewrites those stray lines too, turning a one-line change into a three-line
    diff. That distinction is the whole point of this function.
    """
    if head is not None and _same_content(disk, head):
        # Content untouched apart from line endings: HEAD's bytes are correct and
        # produce a zero-line diff.
        return head
    if head is not None:
        return _remap_endings(disk, head, want)
    # No HEAD version (new file): use the dominant style uniformly.
    if want == LF:
        return disk.replace(b"\r\n", b"\n")
    return disk.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")


def _split_lines(data: bytes) -> list[tuple[bytes, bytes]]:
    """Split into ``(content, terminator)`` pairs, terminator included.

    Unlike ``bytes.splitlines()`` this keeps the terminators, which is what makes
    a byte-exact reassembly possible.
    """
    out: list[tuple[bytes, bytes]] = []
    i = 0
    n = len(data)
    while i < n:
        nl = data.find(b"\n", i)
        if nl == -1:
            out.append((data[i:], b""))
            break
        if nl > i and data[nl - 1] == 0x0D:  # \r
            out.append((data[i:nl - 1], b"\r\n"))
        else:
            out.append((data[i:nl], b"\n"))
        i = nl + 1
    return out


def _remap_endings(disk: bytes, head: bytes, want: str) -> bytes:
    """Re-emit ``disk``'s lines, reusing HEAD's terminator per unchanged line."""
    head_lines = _split_lines(head)
    head_by_content: dict[bytes, list[bytes]] = {}
    for content, term in head_lines:
        head_by_content.setdefault(content, []).append(term)
    used: dict[bytes, int] = {}

    fallback = b"\r\n" if want == CRLF else b"\n"
    parts: list[bytes] = []
    for content, term in _split_lines(disk):
        if not term:
            parts.append(content)  # no trailing newline: leave it bare
            continue
        # Prefer the terminator HEAD used for this exact content, in order.
        options = head_by_content.get(content)
        if options:
            idx = used.get(content, 0)
            if idx < len(options):
                parts.append(content + options[idx])
                used[content] = idx + 1
                continue
        parts.append(content + fallback)
    return b"".join(parts)


def _same_content(disk: bytes, head: bytes) -> bool:
    """True when two blobs differ only in line-ending style."""
    return disk.replace(b"\r\n", b"\n") == head.replace(b"\r\n", b"\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--staged", action="store_true",
                    help="compare the index against HEAD instead of the working tree")
    ap.add_argument("--fix", action="store_true",
                    help="rewrite offenders to HEAD's dominant style")
    args = ap.parse_args()

    files = [f for f in changed_files(staged=args.staged) if is_text(f)]
    if not files:
        print("check-line-endings: no changed text files to check")
        return 0

    violations: list[tuple[str, str, str]] = []
    skipped = 0

    for rel in files:
        head = git("show", f"HEAD:{rel}", binary=True)
        if head is None:
            continue  # new file: nothing to flip away from
        head_style = style_of(head)
        if head_style == UNKNOWN:
            skipped += 1
            continue

        path = ROOT / rel
        if not path.exists():
            continue  # deleted
        disk_style = style_of(path.read_bytes())
        if disk_style == UNKNOWN:
            skipped += 1
            continue

        if disk_style != head_style:
            violations.append((rel, head_style, disk_style))

    if violations:
        for rel, want, got in violations:
            print(f"FLIP {rel}: HEAD is {want.upper()}, working tree is {got.upper()}")
        print()
        print(f"{len(violations)} file(s) changed dominant line-ending style vs HEAD.")
        print("Root cause is usually a text-mode write on Windows: Path.write_text")
        print("translates '\\n' to CRLF. Use tools/_ioutil.write_text_like().")
        if args.fix:
            print()
            for rel, want, got in violations:
                path = ROOT / rel
                head = git("show", f"HEAD:{rel}", binary=True)
                # Prefer HEAD's exact line-ending pattern where the content
                # still matches, so --fix restores HEAD rather than imposing a
                # uniform style on a file that legitimately mixes (a stray lone
                # LF line is drift worth keeping, not something to rewrite).
                path.write_bytes(_restore_style(path.read_bytes(), head, want, got))
                print(f"fixed {rel}: -> {want.upper()}")
            print(f"\n--fix: rewrote {len(violations)} file(s) to HEAD's style.")
            return 0
        print("Re-run with --fix to restore HEAD's style.")
        return 1

    note = f" ({skipped} unclassifiable left alone)" if skipped else ""
    print(f"check-line-endings: {len(files)} changed text file(s) match HEAD's style{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
