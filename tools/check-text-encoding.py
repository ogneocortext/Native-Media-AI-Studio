"""
Reject text files that are not UTF-8.

Two real incidents motivated this:

  - `tools/design-feedback/README.md` was committed as UTF-16LE (a PowerShell
    `>` redirect on Windows). Git reported it as a binary blob, every text tool
    read mojibake, and the pre-existing mojibake checks could not parse it.
  - A timed-out editor write left NUL bytes inside a .tsx file, silently
    truncating its closing JSX. TypeScript caught that one; nothing would have
    caught it in a .md.

A UTF-8 BOM is allowed and is NOT an error: PowerShell and Unity require it in
several tracked files (.ps1, .csproj, .slnx, .json). Only real UTF-16 or invalid
byte sequences fail.

Run:  python tools/check-text-encoding.py [--verbose]
Exit 0 = clean, 1 = at least one bad file.
"""
from __future__ import print_function

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TEXT_EXTENSIONS = (
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".md", ".json", ".yaml", ".yml", ".toml",
    ".ps1", ".sh", ".css", ".html", ".txt", ".cfg", ".ini",
)
# Binary-ish extensions that legitimately contain arbitrary bytes.
SKIP_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".mp3", ".wav", ".flac", ".mp4", ".mov", ".m4a", ".ogg",
    ".woff", ".woff2", ".ttf", ".otf", ".glsl",
)


def tracked_files():
    """Tracked files only - ignored build output must never fail the hook."""
    proc = subprocess.Popen(
        ["git", "ls-files"],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    out, _ = proc.communicate()
    return [p for p in out.decode("utf-8", "replace").split("\n") if p.strip()]


def check(path):
    """Return None if the file is acceptable, else a reason string."""
    full = os.path.join(ROOT, path)
    try:
        with open(full, "rb") as fh:
            raw = fh.read()
    except (IOError, OSError) as e:
        return "unreadable (%s)" % e

    if not raw:
        return None
    # UTF-16 BOMs: text stored as UTF-16 breaks every text tool and git shows
    # the file as binary.
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return "UTF-16 encoded (BOM %s); convert to UTF-8" % raw[:2].hex()
    if b"\x00" in raw:
        return "contains NUL bytes (corrupt or non-text content)"
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError as e:
        return "invalid UTF-8 at byte %d (%s)" % (e.start, e.reason)
    return None


def main():
    verbose = "-v" in sys.argv or "--verbose" in sys.argv
    bad = []
    scanned = 0
    for path in tracked_files():
        if path.lower().endswith(SKIP_EXTENSIONS):
            continue
        if not path.lower().endswith(TEXT_EXTENSIONS):
            continue
        scanned += 1
        reason = check(path)
        if reason:
            bad.append((path, reason))

    if verbose:
        print("scanned %d tracked text files" % scanned)

    if not bad:
        print("all text files are valid UTF-8 (%d scanned)" % scanned)
        return 0

    print("FAILED: %d file(s) are not valid UTF-8" % len(bad))
    for path, reason in bad:
        print("  %s: %s" % (path, reason))
    print("")
    print("Convert with Python (safe - rewrites content, not encoding damage):")
    print('  python -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); '
          'p.write_bytes(p.read_bytes().decode(sys.argv[2]).encode(\'utf-8\'))" '
          '<file> utf-16')
    return 1


if __name__ == "__main__":
    sys.exit(main())