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
# A real, tracked, deliberately-plain text file. Encoding cases mutate this one
# because it has no frontmatter, no table structure and no C1 characters, so a
# failure can only come from the encoding check itself and not from the
# knowledge-tag or docs-map checkers that also scan the tree.
PLAIN = os.path.join("packages", "frontend", "public", "docs",
                     "still-i-rise-analysis.json")


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
    # --- text encoding -----------------------------------------------------
    ("UTF-16LE encoded file", "check-text-encoding.py",
     PLAIN, lambda m: m.write(m.orig.decode("utf-8").encode("utf-16")),
     "UTF-16 encoded"),
    ("UTF-16BE encoded file", "check-text-encoding.py",
     # Prepend the big-endian BOM by hand: Python's utf-16-be codec emits no
     # BOM, and this exercises the checker's ff-fe branch rather than only the
     # far more common fe-ff one.
     PLAIN, lambda m: m.write(
         b"\xfe\xff" + m.orig.decode("utf-8").encode("utf-16-be")),
     "UTF-16 encoded"),
    ("NUL bytes in a text file", "check-text-encoding.py",
     PLAIN, lambda m: m.write(m.orig[:200] + b"\x00" + m.orig[200:]),
     "NUL bytes"),
    ("invalid UTF-8 byte sequence", "check-text-encoding.py",
     PLAIN, lambda m: m.write(m.orig[:200] + b"\xff\xfe\xfd" + m.orig[200:]),
     "invalid UTF-8"),
    ("lone UTF-8 continuation byte", "check-text-encoding.py",
     PLAIN, lambda m: m.write(m.orig[:200] + b"\x80\x81" + m.orig[200:]),
     "invalid UTF-8"),
    # --- tracked-but-ignored files -----------------------------------------
    # A documented command that .gitignore excludes is absent from every clone
    # that did not already have it on disk. Two distinct failures, so two cases:
    # untracked-and-ignored, and untracked-but-not-ignored.
    ("documented script is untracked and ignored", "check-repo-layout.py",
     SAMPLE,
     lambda m: _untrack_then("scripts/check_ports.ps1", unignore=True),
     "gitignore excludes"),
    ("documented script is untracked only", "check-repo-layout.py",
     SAMPLE,
     lambda m: _untrack_then("scripts/start-services.ps1"),
     "will be lost"),
]


UNTRACKED_PROBES = []
GITIGNORE = os.path.join(ROOT, ".gitignore")


def _untrack_then(rel, unignore=False):
    """Remove a path from the index so the checker sees it as untracked.

    `unignore=True` additionally strips any `!` re-include for that path from
    .gitignore, reproducing the original bug exactly: the file was both
    untracked *and* excluded. Without it the checker correctly reports
    "neither tracked nor ignored", which is a different (already fixed) state.

    The index is restored in restore_untracked_probes() rather than here, because
    the checker runs after this returns - restoring immediately would defeat the
    test.
    """
    was_tracked = subprocess.call(
        ["git", "ls-files", "--error-unmatch", rel], cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE) == 0
    if not was_tracked:
        return False
    subprocess.call(["git", "rm", "--cached", "-q", "-f", rel], cwd=ROOT,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    UNTRACKED_PROBES.append(rel)

    if unignore and os.path.exists(GITIGNORE):
        with io.open(GITIGNORE, "rb") as f:
            original = f.read()
        GITIGNORE_PROBES.append(original)
        stripped = b"\n".join(
            line for line in original.split(b"\n")
            if line.strip() not in (b"!" + rel.replace("/", "\\").encode(),
                                    b"!" + rel.encode()))
        with io.open(GITIGNORE, "wb") as f:
            f.write(stripped)
    return True


GITIGNORE_PROBES = []


def restore_untracked_probes():
    """Put back everything _untrack_then removed, index and .gitignore."""
    while GITIGNORE_PROBES:
        with io.open(GITIGNORE, "wb") as f:
            f.write(GITIGNORE_PROBES.pop())
    while UNTRACKED_PROBES:
        rel = UNTRACKED_PROBES.pop()
        subprocess.call(["git", "add", "-f", rel], cwd=ROOT,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def negative_cases():
    """Cases the encoding checker must NOT flag.

    A checker that rejects everything is as broken as one that rejects nothing:
    it trains you to pass --no-verify. A UTF-8 BOM is the important one here,
    because PowerShell and Unity require it in several tracked files.
    """
    failures = []

    with mutated(PLAIN) as m:
        m.write(b"\xef\xbb\xbf" + m.orig)
        code, out = run("check-text-encoding.py")
    if code != 0:
        failures.append("UTF-8 BOM rejected")
        print("FALSE POSITIVE: UTF-8 BOM is explicitly allowed by the checker")
    else:
        print("not flagged:    %-44s (%s)"
              % ("UTF-8 BOM is allowed", "check-text-encoding.py"))

    # Every mutation above must have been restored byte-for-byte.
    code, out = run("check-text-encoding.py")
    if code != 0:
        failures.append("baseline not restored")
        print("BASELINE FAILED: encoding checker after restore")
        for line in out.split("\n"):
            if line.strip():
                print("    %s" % line)
    else:
        print("baseline clean: %s" % PLAIN.replace(os.sep, "/"))

    return failures


def main():
    verbose = "-v" in sys.argv
    failures = []

    # Baseline: the real tree must be clean, or the cases prove nothing.
    for checker in ("validate-knowledge-tags.py", "check-docs-map.py",
                    "check-repo-layout.py", "check-text-encoding.py"):
        code, out = run(checker)
        if code != 0:
            print("BASELINE FAILED: %s on the unmodified tree" % checker)
            for line in out.split("\n"):
                if line.strip():
                    print("    %s" % line)
            failures.append(checker)

    try:
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
    finally:
        # Whatever happened above, the index must be left as we found it:
        # an earlier version of this file could leave scripts/ untracked on a
        # failed run, which looks exactly like the bug the test is checking for.
        restore_untracked_probes()

    failures.extend(negative_cases())

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
