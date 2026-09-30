"""Check repository organisation: what has drifted and should not be tracked.

These are the classes of problem that accumulate quietly - a generated artifact
committed by accident, a byte-identical file copied into two places, a
convention that erodes. Each check is reported; the tool never edits or deletes.

Checks:
  1. tracked files that match an ignore pattern (build output, caches, scratch);
  2. byte-identical files tracked in more than one place, excluding vendored
     and generated trees where duplication is expected;
  3. case-insensitive path collisions (fatal on a case-sensitive filesystem);
  4. large tracked files that are build output rather than source;
  5. documentation claims that contradict .gitignore.

Run:  python tools/check-repo-layout.py
Exit 0 = clean, 1 = issues found.
"""
from __future__ import print_function

import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Tracked files matching these should almost certainly be ignored.
SHOULD_IGNORE = [
    (r"(^|/)tests/browser/out/", "agent/browser scratch output"),
    (r"\.b64$", "base64 blob - a generated artifact"),
    (r"(^|/)__pycache__/", "python cache"),
    (r"\.py[co]$", "compiled python"),
    (r"(^|/)\.pytest_cache/", "pytest cache"),
    (r"(^|.*/)UserSettings/", "Unity per-user editor state (Unity's own "
     "template gitignores this; it is machine-specific)"),
]

# Trees where duplicate content is normal and not worth reporting.
VENDORED = ("node_modules/", "site-packages/", ".venv/", "dist/", "output/")

LARGE_BUILD_OUTPUT = re.compile(r"(/renders?/|\.mp4$|\.b64$)", re.I)
LARGE_BYTES = 20 * 1024 * 1024


def run(args):
    return subprocess.check_output(args, cwd=ROOT,
                                   stderr=subprocess.DEVNULL).decode("utf-8", "replace")


def tracked():
    return [f for f in run(["git", "ls-files"]).split("\n") if f]


def size_of(rel):
    p = os.path.join(ROOT, rel.replace("/", os.sep))
    try:
        return os.path.getsize(p)
    except OSError:
        return 0


def main():
    files = tracked()
    errors, notes = [], []

    # 1. tracked files that should be ignored
    for f in files:
        for pat, why in SHOULD_IGNORE:
            if re.search(pat, f):
                errors.append("tracked but looks like %s: %s" % (why, f))
                break

    # 2. byte-identical duplicates outside vendored/generated trees
    index = {}
    for line in run(["git", "ls-files", "-s"]).split("\n"):
        parts = line.split()
        if len(parts) < 4:
            continue
        sha = parts[1]
        path = " ".join(parts[3:])
        if not path or any(v in path for v in VENDORED):
            continue
        if path.endswith((".meta", ".sum", ".lock", ".json")):
            continue
        index.setdefault(sha, []).append(path)
    for sha, paths in sorted(index.items()):
        if len(paths) > 1:
            # Two Unity projects sharing ProjectSettings is expected, not drift.
            if all("ProjectSettings/" in p for p in paths) and \
               len({p.split("/")[0] for p in paths}) > 1:
                continue
            notes.append("identical content in %d places: %s"
                         % (len(paths), "  ==  ".join(paths)))

    # 3. case-insensitive collisions
    lower = {}
    for f in files:
        lower.setdefault(f.lower(), []).append(f)
    for key, group in sorted(lower.items()):
        if len(group) > 1:
            errors.append("case collision: %s" % ", ".join(sorted(group)))

    # 4. large build output
    for f in files:
        n = size_of(f)
        if n >= LARGE_BYTES and LARGE_BUILD_OUTPUT.search(f):
            errors.append("large build output tracked (%.1f MB): %s" % (n / 1048576.0, f))

    # 5. docs claiming something is ignored when it is not
    agents = os.path.join(ROOT, "AGENTS.md")
    if os.path.exists(agents):
        with io.open(agents, encoding="utf-8") as f:
            text = f.read()
        probe = "packages/frontend/tests/browser/out"
        if re.search(r"tests/browser/out.*gitignored", text, re.I | re.S):
            tracked_here = [x for x in files if x.startswith(probe + "/")]
            if tracked_here:
                errors.append(
                    "AGENTS.md says %s is gitignored, but %d file(s) there are "
                    "tracked (e.g. %s)" % (probe, len(tracked_here), tracked_here[0]))

    for n in notes:
        print("  note: %s" % n)
    if errors:
        print("ISSUES (%d):" % len(errors))
        for e in errors:
            print("  - %s" % e)
        return 1
    print("repository layout is clean (%d tracked files)" % len(files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
