"""Line-ending-safe file writes for tools that rewrite tracked files.

Why this exists
---------------
`Path.write_text(...)` on Windows does **not** write the string you gave it.
Text-mode writes apply universal-newline translation, so every ``"\\n"`` becomes
``"\\r\\n"``. Measured on this machine (Python 3.11, win32)::

    Path("t.txt").write_text("a\\nb\\nc\\n", encoding="utf-8")
    # -> b'a\\r\\nb\\r\\nc\\r\\n'

That silently rewrites a file that was stored with LF. If the file is tracked and
its HEAD version is LF-dominant, git reports **every line as changed**, so a
41-line append renders as ~795 changed lines and the real edit is buried. It
happened repeatedly during the 2026-11-21 sessions (six files repaired by hand),
and `.gitattributes` records the same failure in commit 22ff3d5: a 20-line edit
to `docs/knowledge-library/index.md` produced 234 added / 234 deleted.

Nine call sites already passed ``newline="\\n"`` as a local workaround. That
fixes files that should be LF but is wrong for the 418 tracked files that are
CRLF, and it has to be remembered at every new call site. This module makes the
correct behaviour the default instead: write the **same line ending the file
already has**, so the diff contains only the lines that actually changed.

Usage
-----
    from _ioutil import write_text_like

    write_text_like(path, new_text)              # preserves the file's own style
    write_text_like(path, new_text, style="lf")  # force a style (new files)

Both return the style used. Nothing here touches git; ``detect_style`` reads the
file on disk, which is what a tool is about to overwrite.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

LF = "lf"
CRLF = "crlf"
UNKNOWN = "unknown"

# A file smaller than this cannot be meaningfully classified (a 1-2 line file is
# all one style by construction), so treat it as "leave it alone".
_MIN_BYTES_FOR_STYLE = 64


def detect_style(path: Path) -> str:
    """Return ``"lf"``, ``"crlf"``, or ``"unknown"`` for an existing file.

    ``"unknown"`` covers a missing file, an empty file, a file with no newline at
    all, and a file too small to classify. It also covers genuinely mixed files:
    when both styles appear, the **majority** wins, because that is the style a
    normalising rewrite would converge on and the one that minimises churn.

    Binary files are reported as ``"unknown"`` rather than being rewritten; the
    caller should not be writing text over a binary in the first place.
    """
    try:
        data = path.read_bytes()
    except OSError:
        return UNKNOWN

    if len(data) < _MIN_BYTES_FOR_STYLE:
        return UNKNOWN
    if b"\x00" in data[:4096]:
        return UNKNOWN

    crlf = data.count(b"\r\n")
    lf = data.count(b"\n") - crlf
    if crlf and not lf:
        return CRLF
    if lf and not crlf:
        return LF
    if not crlf and not lf:
        return UNKNOWN
    # Mixed: majority wins, ties go to LF (the repo's dominant style).
    return LF if lf >= crlf else CRLF


def _encode(text: str, style: str) -> bytes:
    """Encode ``text`` with LF or CRLF line endings, without newline translation."""
    normalised = text.replace("\r\n", "\n").replace("\r", "\n")
    if style == CRLF:
        normalised = normalised.replace("\n", "\r\n")
    return normalised.encode("utf-8")


def write_text_like(path: Path, text: str, style: str | None = None) -> str:
    """Write ``text`` to ``path`` using the file's existing line-ending style.

    ``style`` forces ``"lf"`` or ``"crlf"``; when omitted the style is detected
    from the file already on disk, defaulting to ``"lf"`` for a new file. This
    always writes bytes directly, so no newline translation can occur.

    Returns the style that was used.
    """
    resolved = style or detect_style(path)
    if resolved not in (LF, CRLF):
        resolved = LF
    path.write_bytes(_encode(text, resolved))
    return resolved


def normalise_bytes(data: bytes, style: str) -> bytes:
    """Return ``data`` re-encoded with ``style`` line endings.

    Exposed for tools that build a whole file in memory (or need to normalise a
    string before writing) and for the ``check-line-endings`` gate.
    """
    if b"\x00" in data[:4096]:
        return data  # never touch binary content
    text = data.decode("utf-8", errors="surrogateescape")
    return _encode(text, style)
