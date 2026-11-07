#!/usr/bin/env python3
"""Guard against scratch files and over-broad staging reaching a commit.

Recurring failure mode in this repo (multiple agent sessions): ad-hoc
investigation scripts (``fix_kv*.py``, ``inspect_*.py``) get swept into a
commit by ``git add -A``, or a staged file-set spans unrelated areas because
one agent's ``add -A`` collected another's work-in-progress.

Two signals, one verdict:

* FAIL - a staged path looks like scratch: root-level ``fix_*``,
  ``inspect_*``, ``debug_*``, ``tmp*``, ``scratch*``, ``repro_*`` files, or
  ``*.orig`` / ``*.rej`` / ``*.bak`` / ``*.log`` merge/scratch leftovers.
* Advisory (printed, exit stays 0) - the staged set spans more than
  ``BREADTH_LIMIT`` distinct top-level areas, which usually means ``add -A``
  collected unrelated work. Cross-cutting commits happen; this only nags.

Run:  python tools/check-staged-hygiene.py
Exit 0 = clean or advisory-only, 1 = scratch file staged.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Scratch signatures are anchored to the repo ROOT on purpose: ``fix_*.py``
# inside ``tools/`` or a test named ``test_fix.py`` is legitimate; the same
# name at the root is almost always a leftover investigation script.
SCRATCH_RE = re.compile(
    r"^(?:fix|inspect|debug|tmp|temp|scratch|repro|dump|probe|check_me|"
    r"untitled|new|old)_[^/]*$"
    r"|^tmp[^/]*$"
    r"|^[^/]*\.(?:orig|rej|bak|log|tmp)$",
    re.IGNORECASE,
)
# Media/binary artifacts staged accidentally.
BINARY_ADVISORY_RE = re.compile(
    r"\.(?:wav|mp3|flac|mp4|mov|mkv|exe|dll|zip|7z|db|sqlite)$",
    re.IGNORECASE,
)
BREADTH_LIMIT = 5


def _staged_files() -> list[str]:
    out = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    if out.returncode != 0:
        return []
    return [line.strip().replace("\\", "/")
            for line in out.stdout.splitlines() if line.strip()]


def main() -> int:
    staged = _staged_files()
    if not staged:
        print("[OK] staged hygiene - nothing staged")
        return 0

    scratch = [f for f in staged
               if "/" not in f and SCRATCH_RE.match(Path(f).name)]
    binary = [f for f in staged if BINARY_ADVISORY_RE.search(f)]

    top_areas = {f.split("/", 1)[0] for f in staged}
    broad = len(top_areas) > BREADTH_LIMIT

    if scratch:
        print(f"[FAIL] {len(scratch)} scratch-looking file(s) staged at "
              f"repo root:")
        for f in scratch:
            print(f"       {f}")
        print("       These are almost always investigation leftovers. "
              "Unstage with `git restore --staged <file>` or move them "
              "under docs/scratch/ if they should be kept.")
        return 1

    if binary:
        print(f"[WARN] {len(binary)} binary/media file(s) staged - "
              f"confirm intentional:")
        for f in binary[:10]:
            print(f"       {f}")

    if broad:
        print(f"[WARN] staged set spans {len(top_areas)} top-level areas "
              f"({', '.join(sorted(top_areas)[:8])}{'...' if len(top_areas) > 8 else ''}) "
              f"- if this is `git add -A`, you may be sweeping up another "
              f"agent's WIP. Stage only the files your task touched.")

    if not scratch and not binary and not broad:
        print(f"[OK] staged hygiene - {len(staged)} file(s), "
              f"{len(top_areas)} area(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
