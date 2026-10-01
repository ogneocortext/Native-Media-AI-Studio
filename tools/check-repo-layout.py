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
  5. documentation claims that contradict .gitignore;
  6. filenames carrying machine-generated identifiers, which read as noise to the
     next person and to an agent opening the file.

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

# Filenames that embed a machine-generated identifier instead of describing
# their contents. Examples seen in this repo:
#   audio-bench-20260906_194811.json   (run id: date + wall-clock time)
#   v2_Some Song.mp3_7325546-1788280340000.json  (content hash + epoch-ms)
# These are renamed to say what they are; a run id is stale the moment the run
# is repeated and means nothing to a reader or to an agent.
GENERATED_ID = [
    # date + wall-clock time: audio-bench-20260906_194811, run_20260906-194811
    (re.compile(r"[_-]\d{8}[_-]\d{6}\b"), "date+time run id"),
    # content hash + epoch-ms: v2_Song.mp3_7325546-1788280340000
    (re.compile(r"[_-]\d{6,}-\d{10,}\b"), "content hash + epoch-ms"),
    # bare epoch-ms or long hash
    (re.compile(r"[_-]\d{12,}\b"), "epoch-ms or hash timestamp"),
]

# Names that are conventionally machine-shaped and must NOT be flagged.
NAME_ALLOWLIST = {
    "__init__", "__main__", "setup", "conftest", "index", "package",
    "package-lock", "tsconfig", "turbo", "Makefile", "requirements",
}

# Only these extensions carry a human-readable stem worth reviewing.
REVIEWABLE_EXT = (
    ".md", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".py",
    ".json", ".yaml", ".yml", ".ps1", ".sh", ".html", ".css",
)


def git_check_ignore(path):
    """True if git would ignore this path."""
    proc = subprocess.Popen(["git", "check-ignore", "-q", path], cwd=ROOT,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    proc.communicate()
    return proc.returncode == 0


# Scripts referenced in AGENTS.md. Always POSIX: git reports paths with forward
# slashes, so mixing separators here silently breaks the "is it tracked?" test.
DOCUMENTED_SCRIPTS = (
    "scripts/check_ports.ps1",
    "scripts/manage-servers.ps1",
    "scripts/start-services.ps1",
    "scripts/start-studio.ps1",
    "scripts/start-unity-headless.ps1",
)


def documented_scripts(text):
    """Documented scripts that really are mentioned in AGENTS.md.

    AGENTS.md writes Windows paths with backslashes (`scripts\\start-services.ps1`)
    while git reports them with forward slashes, so both spellings are matched.
    """
    if not text:
        return []
    found = []
    for rel in DOCUMENTED_SCRIPTS:
        if rel in text or rel.replace("/", "\\") in text:
            found.append(rel)
    return found


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

    # 6. scripts that the docs tell you to run, but that .gitignore excludes.
    # A documented command that only exists because someone ran it by hand on
    # this machine is broken for everyone else: a fresh clone simply lacks the
    # file, and the failure looks like a missing dependency rather than a bad
    # ignore rule.
    for rel in documented_scripts(text if os.path.exists(agents) else ""):
        if rel in files:
            continue
        if git_check_ignore(rel):
            errors.append(
                "AGENTS.md documents `%s` but .gitignore excludes it, so it is "
                "absent from a fresh clone. Add a `!%s` re-include if it is real "
                "source." % (rel, rel))
        elif os.path.exists(os.path.join(ROOT, rel.replace("/", os.sep))):
            errors.append(
                "AGENTS.md documents `%s` but it is neither tracked nor ignored "
                "(it will be lost). Add it or remove the doc reference." % rel)

    # 7. tracked scripts that dot-source a PowerShell file .gitignore excludes.
    # This is not hypothetical: scripts/manage-servers.ps1 and start-studio.ps1
    # dot-source shared-utils.ps1, which the `scripts/**/*.ps1` rule excludes. The
    # scripts are tracked and look fine; they fail at runtime on a fresh clone
    # with an error that names no missing file.
    # Matches the dot-source forms seen here:
    #     . (Join-Path $PSScriptRoot 'shared-utils.ps1')
    #     . "$PSScriptRoot/shared-utils.ps1"
    #     . .\shared-utils.ps1
    sourced = re.compile(r"""^\s*\.\s+.*?['"]([^'"]+\.ps1)['"]""", re.M)
    for f in files:
        if not f.endswith(".ps1"):
            continue
        path = os.path.join(ROOT, f.replace("/", os.sep))
        try:
            with io.open(path, encoding="utf-8", errors="replace") as fh:
                body = fh.read()
        except (IOError, OSError):
            continue
        for line in body.splitlines():
            m = sourced.match(line)
            if not m:
                continue
            target = m.group(1).replace("\\", "/")
            # Dot-sources resolve against $PSScriptRoot when the script reaches
            # up to its own directory, and against $root (the repo root, set a
            # few lines above) when the path already names the top-level
            # directory. Both forms occur here; resolving everything against the
            # script's own directory would invent a bogus scripts/dev/scripts/
            # path for the second kind.
            # os.path.join ignores the first argument when the second is
            # absolute, so ROOT/script-dir is only a base here. normpath then
            # relpath turns an absolute result back into a repo-relative one,
            # which is what git and .gitignore both speak.
            if target.startswith("scripts/") or "/$root" in line:
                base = ROOT
            else:
                base = os.path.dirname(f.replace("/", os.sep))
            resolved = os.path.normpath(
                os.path.join(base, target.replace("/", os.sep)))
            try:
                rel = os.path.relpath(resolved, ROOT).replace(os.sep, "/")
            except ValueError:
                continue  # different drive; not a repo-relative reference
            if rel.startswith("..") or rel in files:
                continue
            if git_check_ignore(rel):
                errors.append(
                    "%s dot-sources `%s`, which .gitignore excludes — it is "
                    "absent from a fresh clone and the script will fail at "
                    "runtime. Add a `!%s` re-include." % (f, rel, rel))

    # 8. machine-generated identifiers baked into filenames
    for f in files:
        name = os.path.basename(f)
        stem, ext = os.path.splitext(name)
        if ext.lower() not in REVIEWABLE_EXT:
            continue
        if stem in NAME_ALLOWLIST or stem.startswith("."):
            continue
        for pat, why in GENERATED_ID:
            if pat.search(stem):
                errors.append(
                    "filename carries a %s instead of describing its contents: "
                    "%s  (rename it, or gitignore it if it is generated data)"
                    % (why, f))
                break

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
