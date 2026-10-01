"""Run every documentation and repository check in one command.

Three checkers exist, each runnable alone, but there is no single command that
runs them all. That gap is easy to miss: a fourth checker gets added, nobody
notices the aggregate is incomplete, and the pre-commit hook quietly runs a
subset. This runner is the single entry point, and `tools/tests/` covers it.

Checks, in order of cost (cheapest first, so a fast failure surfaces early):
  1. tools/validate-knowledge-tags.py  - frontmatter, tags, tracker, index
  2. tools/check-docs-map.py           - docs/README.md is an accurate map
  3. tools/check-repo-layout.py        - generated output, duplicates, collisions
  4. tools/check-text-encoding.py      - rejects UTF-16 / NUL / invalid UTF-8

Run:  python tools/check-all.py
Exit 0 = all pass, 1 = at least one failed.
"""
from __future__ import print_function

import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (label, script, extra args). Ordered cheapest-first by measured runtime.
CHECKS = [
    ("docs map", "check-docs-map.py", []),
    ("text encoding", "check-text-encoding.py", []),
    ("knowledge tags", "validate-knowledge-tags.py", []),
    ("repo layout", "check-repo-layout.py", []),
    # Report-only: exits 0 by design, so it cannot fail the run. Kept here so
    # one command gives the whole picture, including the outside-library view.
    ("docs triage (report)", "docs-triage.py", []),
]


def run(label, script, args):
    path = os.path.join(ROOT, "tools", script)
    if not os.path.exists(path):
        print("MISSING: tools/%s" % script)
        return 1, 0.0, ""
    start = time.time()
    try:
        proc = subprocess.Popen([sys.executable, path] + args,
                                cwd=ROOT, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT)
        out, _ = proc.communicate()
        code = proc.returncode
    except OSError as e:
        out = ("could not run: %s" % e).encode("utf-8", "replace")
        code = 1
    return code, time.time() - start, out.decode("utf-8", "replace")


def main():
    verbose = "-v" in sys.argv or "--verbose" in sys.argv
    failures = []
    print("Running %d checks" % len(CHECKS))
    print("=" * 68)

    for label, script, args in CHECKS:
        code, elapsed, out = run(label, script, args)
        status = "PASS" if code == 0 else "FAIL"
        print("[%s] %-22s %5.0f ms  (%s)" % (status, label, elapsed * 1000, script))
        if code != 0:
            failures.append(label)
            for line in out.split("\n"):
                if line.strip():
                    print("         %s" % line)
        elif verbose:
            for line in out.strip().split("\n")[-1:]:
                if line.strip():
                    print("         %s" % line)

    print("=" * 68)
    if failures:
        print("FAILED: %s" % ", ".join(failures))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
