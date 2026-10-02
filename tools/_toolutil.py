"""Shared plumbing for the scripts in ``tools/``.

``tools/`` is 38 Python files / ~10,600 lines doing many unrelated jobs (audio
analysis, repo hygiene, database repair, MCP bridges, Blender export). Four
patterns were re-implemented per file while that work was done, and the copies
drifted. This module holds them once.

Why bother, and why a private module:

* Repo-root resolution was written 14 different ways (``parent.parent``,
  ``parents[1]``, and inline ``sys.path`` juggling), so a tool run from an
  unexpected cwd had to be tested separately to know where it looked.
* Read-only database access repeated across the audit and report tools, each
  re-deciding how to open. For an *audit* tool, opening read-write means it can
  create the very file it was only supposed to inspect.
* Backup-then-mutate and the ``VACUUM INTO``-verify-swap sequence were
  re-implemented per tool, with differing safety.
* Tracked-file enumeration was written twice in near-identical form and the
  docstrings drifted apart - the two copies no longer agreed on what they did.

Private (``_``-prefixed) because these are implementation details of sibling
scripts, not a public API. See ``_gitutil.py`` for the same idea applied to git
subprocesses, and for why the naive version produced wrong answers here.

Deliberately *not* here: anything importing ``app.*`` or touching the network. A
tool that runs standalone must stay standalone, so this module depends on nothing
beyond the standard library.
"""
from __future__ import annotations

import shutil
import sqlite3
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

# This file lives in <repo>/tools/.
TOOLS_DIR = Path(__file__).resolve().parent
REPO = TOOLS_DIR.parent

# Shared output/artifact roots the tools read and write.
OUTPUT_DIR = REPO / "output"
STORAGE_DIR = REPO / "storage"
AUDIO_DIR = OUTPUT_DIR / "audio"
DEFAULT_DB = STORAGE_DIR / "studio.db"


def ensure_repo_on_path() -> None:
    """Put ``tools/`` and the repo root on ``sys.path`` so sibling imports work.

    Several tools ``import _gitutil`` or a sibling ``tools`` module. That only
    works when python happens to have ``tools/`` on the path: true for
    ``python tools/foo.py``, false for ``python -m`` or an absolute path invoked
    from another directory. Calling this first makes the import unconditional.
    """
    for entry in (TOOLS_DIR, REPO):
        if str(entry) not in sys.path:
            sys.path.insert(0, str(entry))


def read_text(path: Path) -> str:
    """Read a source file, tolerating a UTF-8 BOM.

    ``utf-8-sig`` strips the BOM when present and is identical when it is not.
    Plain ``utf-8`` leaves it in the string and ``ast.parse`` then fails with
    "invalid non-printable character U+FEFF", which reads like a syntax error in
    the file rather than an encoding problem. PowerShell's
    ``Set-Content -Encoding UTF8`` writes a BOM, so anything touched from the
    agent shell can have one.
    """
    return path.read_text(encoding="utf-8-sig")


def tracked_files(
    root: Path | None = None, suffixes: tuple[str, ...] | None = None
) -> list[Path]:
    """Files git tracks under `root`, optionally filtered by suffix.

    Tracked files only. Ignored build output must never fail a hook, so this
    cannot glob the working tree: a stale ``__pycache__`` or an untracked scratch
    file would otherwise be reported as a problem.
    """
    base = (root or REPO).resolve()
    args = ["git", "ls-files", "-z"]
    if base != REPO.resolve():
        args.append(base.relative_to(REPO.resolve()).as_posix())
    out = subprocess.run(
        args, cwd=REPO, capture_output=True, encoding="utf-8", errors="replace"
    )
    if out.returncode != 0:
        return []
    files = []
    for name in out.stdout.split("\0"):
        if not name:
            continue
        p = base / name
        if suffixes and p.suffix not in suffixes:
            continue
        files.append(p)
    return files


def tracked_python_files(root: Path | None = None) -> list[Path]:
    """Tracked ``.py`` files. See :func:`tracked_files` for why tracked-only."""
    return tracked_files(root, suffixes=(".py",))


def human_bytes(n: float) -> str:
    """Format a byte count for a human-readable report."""
    return f"{n / 1048576:.1f} MB"


@contextmanager
def sqlite_readonly(db_path: Path) -> Iterator[sqlite3.Connection]:
    """Open `db_path` read-only, as a URI.

    Read-only is the point: an audit tool that accidentally opens read-write can
    create the very file it was only supposed to inspect, or journal against a
    live backend's write lock.
    """
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        yield conn
    finally:
        conn.close()


def backup_file(path: Path, label: str = "backup") -> Path:
    """Copy `path` beside itself with a timestamped suffix. Returns the copy."""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = path.with_name(f"{path.stem}.{label}-{stamp}{path.suffix}")
    shutil.copy2(path, dest)
    return dest


def compact_sqlite(db_path: Path, tmp_suffix: str = ".compacting") -> bool:
    """Rewrite `db_path` compactly via ``VACUUM INTO``, verifying before swapping.

    An in-place ``VACUUM`` on a large file promises nothing: if it is interrupted
    the original is already being rewritten. ``VACUUM INTO`` writes a separate
    file, so the original stays intact until the replacement verifies.

    Returns True on success. On failure the temporary file is removed and the
    original is left untouched.
    """
    tmp = db_path.with_name(db_path.name + tmp_suffix)
    tmp.unlink(missing_ok=True)
    try:
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("VACUUM INTO ?", (str(tmp),))
        finally:
            conn.close()

        check = sqlite3.connect(tmp)
        try:
            integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            check.close()
        if integrity != "ok":
            tmp.unlink(missing_ok=True)
            return False

        shutil.move(str(tmp), str(db_path))
        return True
    except (sqlite3.Error, OSError):
        tmp.unlink(missing_ok=True)
        return False


