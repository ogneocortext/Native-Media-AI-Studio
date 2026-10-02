"""Shared helper for the git-backed tools in this directory.

Four tools here (check-dangling-commits, prune-checkpoint-refs,
report-large-git-objects, check-repo-layout) each grew their own private ``git()``
wrapper while this work was done. They were not equivalent, and two of them were
wrong in ways that produced confidently incorrect output on this machine:

- ``subprocess.run(..., text=True)`` with no ``encoding`` decodes using the
  **locale** codec (cp1252 here), so a UTF-8 BOM arrives as the three characters
  ``"\\u00ef\\u00bb\\u00bf"`` rather than U+FEFF. Any code stripping a BOM silently
  did nothing, and a commit already published on main was reported as missing.
- ``stdout`` is ``None`` whenever a command exits non-zero or emits undecodable
  bytes, and ``None`` then propagates into string concatenation, failing far from
  the actual cause.

Both are the same class of bug ``check-text-encoding.py`` exists to catch in
files, so it is worth solving once here rather than per-tool.

``run_git`` also fixes a third: feeding a large ``git show`` stream into
``git patch-id`` through a pipe deadlocks the reader thread on Windows. Use
``git_text_lines`` with an explicit file when the payload is large.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

# Bytes of a UTF-8 BOM. Kept as bytes because that is how it arrives from git
# before any decoding, and decoding it with the wrong codec is the whole trap.
UTF8_BOM = b"\xef\xbb\xbf"


def strip_bom(text: str) -> str:
    """Remove a leading BOM (or a BOM decoded as cp1252 mojibake) and whitespace.

    A commit subject written by a PowerShell redirect can carry a BOM. After
    cp1252 decoding that is ``"\\u00ef\\u00bb\\u00bf"``; decoded correctly as UTF-8
    it is ``"\\ufeff"``. Handle both so the comparison works regardless of which
    decode happened upstream.
    """
    return (
        text.replace("\ufeff", "")
            .replace("\u00ef\u00bb\u00bf", "")
            .strip()
    )


def run_git(*args: str, cwd: Path | str | None = None) -> str:
    """Run git and return stdout as UTF-8 text. Never returns None.

    Decoding is explicit on purpose - see the module docstring.
    """
    res = subprocess.run(
        ["git", *args], capture_output=True, cwd=cwd,
    )
    return res.stdout.decode("utf-8", "replace")


def git_lines(*args: str, cwd: Path | str | None = None) -> list[str]:
    """Run git and return stdout split into non-empty stripped lines."""
    return [ln for ln in run_git(*args, cwd=cwd).splitlines() if ln.strip()]


def git_ok(*args: str, cwd: Path | str | None = None) -> bool:
    """True when the git command exits zero."""
    return subprocess.run(["git", *args], capture_output=True, cwd=cwd).returncode == 0


def delete_ref(ref: str, cwd: Path | str | None = None) -> tuple[bool, str]:
    """Delete a single ref, returning (ok, stderr).

    One ``update-ref -d`` per ref. Batching through stdin - either the
    line-oriented or the ``-z`` form - failed on this machine with
    "expected SP but got: ?" and "invalid <old-oid>", which points at the record
    terminator being mangled rather than at the refs themselves. A process per ref
    is unambiguous and costs about a second for a few hundred refs.
    """
    res = subprocess.run(
        ["git", "update-ref", "-d", ref], capture_output=True, cwd=cwd,
    )
    return res.returncode == 0, res.stderr.decode("utf-8", "replace").strip()
