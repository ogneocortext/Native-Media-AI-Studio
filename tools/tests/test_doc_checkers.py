"""Self-tests for the documentation checkers.

A checker that silently stops failing is worse than no checker: it reports
green while the problem it exists to catch comes back. These tests introduce
each defect, confirm the checker notices, then restore the file byte-for-byte.

They mutate the working tree in place and restore from an in-memory copy, never
from git. That matters: this repository's .git directory is several gigabytes, so
a `git clone` per case is not viable, and `git checkout` would discard unrelated
in-flight work by another agent. Nothing here is ever committed.

Run:  python tools/tests/test_doc_checkers.py
Exit 0 = all cases detected, 1 = a checker missed something.
"""
from __future__ import print_function

import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAMPLE = os.path.join("docs", "knowledge-library", "ollama-prompting-2026.md")
MAP = os.path.join("docs", "README.md")
AGENTS = "AGENTS.md"


def run(script):
    p = subprocess.Popen([sys.executable, os.path.join("tools", script)], cwd=ROOT,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out, _ = p.communicate()
    return p.returncode, out.decode("utf-8", "replace")


class mutated(object):
    """Edit a file, then restore its exact original bytes on exit."""

    def __init__(self, rel):
        self.rel = rel
        self.path = os.path.join(ROOT, rel.replace("/", os.sep))
        with io.open(self.path, "rb") as f:
            self.orig = f.read()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        with io.open(self.path, "wb") as f:
            f.write(self.orig)
        return False

    def sub(self, old, new, count=1):
        with io.open(self.path, "rb") as f:
            data = f.read()
        if old.encode("utf-8") not in data:
            return False
        data = data.replace(old.encode("utf-8"), new.encode("utf-8"), count)
        with io.open(self.path, "wb") as f:
            f.write(data)
        return True

    def write(self, data):
        with io.open(self.path, "wb") as f:
            f.write(data)
        return True

    def crlf(self):
        with io.open(self.path, "rb") as f:
            data = f.read()
        return self.write(data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))

    def append(self, text):
        with io.open(self.path, "rb") as f:
            data = f.read()
        return self.write(data + text.encode("utf-8"))



CASES = [
    ("first tag is not a primary category", "validate-knowledge-tags.py",
     SAMPLE, lambda m: m.sub("  - ai\n", "  - visualization\n"),
     "not a primary category"),
    ("duplicate frontmatter key", "validate-knowledge-tags.py",
     SAMPLE, lambda m: m.sub("date: ", "date: 2099-01-01\ndate: "),
     "duplicate frontmatter key"),
    ("CRLF line endings", "validate-knowledge-tags.py",
     SAMPLE, lambda m: m.crlf(), "CRLF"),
    ("mojibake (C1 control)", "validate-knowledge-tags.py",
     SAMPLE, lambda m: m.append("\nStray control: \u009f here.\n"), "C1 control"),
    ("map names a directory that does not exist", "check-docs-map.py",
     MAP, lambda m: m.sub("| `plans/` | Proposed and in-flight implementation plans |",
                          "| `plans/` | Proposed and in-flight implementation plans |\n"
                          "| `no-such-dir/` | invented |"),
     "does not exist"),
    ("map omits a real directory", "check-docs-map.py",
     MAP, lambda m: m.sub("| `plans/` | Proposed and in-flight implementation plans |", ""),
     "does not list"),
    ("AGENTS.md stops pointing at the map", "check-docs-map.py",
     AGENTS, lambda m: m.sub("docs/README.md", "somewhere/else.md", 99),
     "does not point agents"),
]


def main():
    verbose = "-v" in sys.argv
    failures = []

    # Baseline: the real tree must be clean, or the cases prove nothing.
    for checker in ("validate-knowledge-tags.py", "check-docs-map.py",
                    "check-repo-layout.py"):
        code, out = run(checker)
        if code != 0:
            print("BASELINE FAILED: %s on the unmodified tree" % checker)
            for line in out.split("\n"):
                if line.strip():
                    print("    %s" % line)
            failures.append(checker)

    for label, checker, target, mutate, expect in CASES:
        with mutated(target) as m:
            if not mutate(m):
                print("SETUP FAILED (mutation did not apply): %s" % label)
                failures.append(label)
                continue
            code, out = run(checker)
        if code == 0:
            failures.append(label)
            print("NOT DETECTED: %-44s (%s)" % (label, checker))
        elif expect not in out:
            failures.append(label)
            print("WRONG MESSAGE: %-40s expected %r" % (label, expect))
            if verbose:
                print("    got: %s" % out.strip().split("\n")[-1][:90])
        else:
            print("detected:       %-44s (%s)" % (label, checker))
            if verbose:
                for line in out.split("\n"):
                    if expect in line:
                        print("    %s" % line.strip())

    print("=" * 66)
    if failures:
        print("FAILED (%d):" % len(failures))
        for f in failures:
            print("  - %s" % f)
        return 1
    print("all %d cases detected as expected" % len(CASES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
