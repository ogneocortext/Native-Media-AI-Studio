"""Check that repo-relative path references point at real files.

The defect that motivated this: a batch of files was moved
(docs/track-prompts-lyrics.csv -> config/, docs/knowledge-library/*.json
-> config/docs-data/) without updating a single reader. The index-based
checkers (check-repo-layout, check-docs-map) enumerate `git ls-files`,
so they were blind to the unstaged move; it surfaced much later as six
404 API routes and two crashed gates. This checker reads file *content*
and verifies each literal repo-relative path it names against the
working tree, so a move without its readers is caught in the same
commit.

Precision rule -- a finding is a *moved-file signature*, not any
missing path: a reference is reported only when a tracked file with
the same basename (or the same last two path segments) exists
somewhere else in the repo. That is the shape of the real defect:
the reader names a path that used to hold a file that still exists,
under a different name. A reference to a path whose name appears
nowhere in the repo is undecidable from the tree alone -- it may be
a generated output, an external asset, a planned file, or prose --
so it is not reported. This is what keeps the gate usable: the first
run against this repo produced 176 raw misses, of which exactly the
suggestion-backed ones were real stale references and every other one
was a false positive class (see below).

What counts as a reference:
  1. a literal repo-relative path token starting with a top-level
     directory (docs/, scripts/, packages/, tools/, config/, shared/,
     unity-project-mcp/, unity-visualizer/, suno-templates/), in
     either separator style, including Windows backslash spellings
     and filenames that contain spaces;
  2. a root-joined path in code: `PROJECT_ROOT / "docs" / "x.csv"`
     or `os.path.join(PROJECT_ROOT, "docs", "x.csv")` (two or more
     segments, so the directory is carried in the string itself).

A reference is satisfied when any of these holds:
  - the path exists on disk;
  - the path with a code extension appended exists (.ts, .tsx, .js,
    .mjs, .jsx, .json, .md, .py, .css, .ps1) -- TS/Vite import
    specifiers are extension-less, e.g. `shared/types` means
    `shared/types.ts`;
  - the reference is an exact allowlisted string (MCP JSON-RPC
    method names `tools/call` and `tools/list` appear throughout the
    MCP bridges and are not paths).

What it deliberately does not report, and why:
  - .gitignore -- its lines are patterns for generated paths, most of
    which intentionally do not exist;
  - CHANGELOG.md -- a historical record; every path in it was valid
    when written and most have moved since, by design;
  - docs/notes/ and docs/scratch/ -- the non-authoritative scratch
    sets (decision-log D12);
  - output/ -- generated data; most references name write targets
    that do not exist yet, so existence proves nothing;
  - single-segment joins (VAULT_ROOT / "agent.manifest.json") -- the
    base constant's value would have to be evaluated to resolve the
    path, and a wrong guess invents defects. The multi-segment forms
    carry the directory in the string, so they resolve without
    evaluation;
  - tokens containing ".." (ellipsis shorthand like
    `packages/frontend/.../AISceneGenerator.tsx`) and templates or
    globs (<name>, {stem}, *) -- not concrete paths;
  - a token the regex had to truncate mid-word (next character is a
    letter, digit, underscore, $, {, * or ?) -- that is a glob, a
    URL path or an identifier, not a reference.

Prose handling: the token regex allows spaces so filenames like
"Knowledge Graph.canvas" match, which also absorbs trailing words
("tools/check-all.py runs in 900 ms"). When the full token does not
exist, space-separated words are dropped one at a time; if a prefix
exists the reference was prose, not a defect. Only a missing /-joined
segment is a finding, so a directory that happens to exist never
excuses a genuinely missing file.

Every reported finding carries a "did you mean" line naming the
tracked file(s) with the same basename or tail -- the hyperhawk-style
fix suggestion for the moved-file case.

Run:  python tools/check-path-references.py
Exit 0 = no moved-file references, 1 = at least one found.
"""

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gitutil import git_lines  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Top-level directories a repo-relative path can start with.
ROOT_NAMES = (
    "unity-project-mcp", "unity-visualizer", "suno-templates",
    "packages", "scripts", "shared", "config", "tools", "docs",
)

# A path token: a root name, a separator, then path characters.
# Spaces are allowed for filenames like "Knowledge Graph.canvas";
# the prose trimmer deals with the words that this absorbs.
TOKEN_RE = re.compile(
    r"(?<![\w./\\-])(" + "|".join(ROOT_NAMES) + r")[\\/]"
    r"[\w.\\/ -]{1,160}")

# A character that means the regex truncated the token mid-word: a
# glob, a URL path segment or an identifier follows, not a reference.
TRUNCATED_NEXT = re.compile(r"[\w${*?]")

# Root-joined paths in code. The capture group sits inside a repeated
# group, so only the last segment would be kept; the whole match is
# re-scanned for quoted strings instead (see _join_segments).
ROOT_VAR = r"(?:PROJECT_ROOT|REPO_ROOT|BASE_DIR|BASEPATH)"
JOIN_RE = re.compile(
    r"\b" + ROOT_VAR + r"\s*(?:/\s*[\"'][^\"'\n]+[\"']){2,}")
OSJOIN_RE = re.compile(
    r"os\.path\.join\(\s*" + ROOT_VAR +
    r"(?:\s*,\s*[\"'][^\"'\n]+[\"']){2,}\s*\)")
QUOTED = re.compile(r"[\"']([^\"'\n]+)[\"']")

# Trailing punctuation and separators that prose or code syntax adds
# to the end of a path token.
TRAILING = " ,.;:!?)]}'\"`-/"

# Not concrete paths: templates and globs (single characters)
# and ellipsis shorthand (the two-character sequence).
TEMPLATE_CHARS = "<>{*$?~%"
ELLIPSIS = ".."

# Extension-less import specifiers resolve by suffixing one of these
# (TS/Vite/Node resolution), so `shared/types` means `shared/types.ts`.
IMPORT_EXTENSIONS = (".ts", ".tsx", ".js", ".mjs", ".jsx", ".json",
                     ".md", ".py", ".css", ".ps1")

# Exact strings that look like repo paths but are not: the MCP
# JSON-RPC method names the bridges call and log.
EXACT_ALLOWED = {"tools/call", "tools/list"}

# Files and trees never scanned, with the reason for each (see the
# module docstring): ignore patterns, the historical record, and the
# non-authoritative scratch sets.
SKIP_SCAN_FILES = {".gitignore", "CHANGELOG.md"}
SKIP_SCAN_PREFIXES = ("docs/notes/", "docs/scratch/")

# Files never read: binary/media payloads, lock files (huge, full of
# URL paths) and minified bundles.
SKIP_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".psd",
    ".svgz", ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".mp3", ".mp4", ".m4a", ".wav", ".flac", ".ogg", ".opus",
    ".webm", ".mov", ".avi", ".mpg", ".mpeg",
    ".pdf", ".zip", ".gz", ".tgz", ".tar", ".7z", ".rar",
    ".whl", ".safetensors", ".pt", ".pth", ".onnx", ".bin", ".gguf",
    ".npy", ".npz", ".msgpack", ".glb", ".fbx", ".blend", ".unity",
    ".exr", ".hdr",
}
SKIP_NAME = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock",
             "composer.lock", "Gemfile.lock", "poetry.lock"}
MAX_BYTES = 4 * 1024 * 1024


def disk_path(rel):
    return os.path.join(ROOT, rel.replace("/", os.sep))


def exists(rel):
    return os.path.exists(disk_path(rel))


def satisfied(candidate):
    """True when the reference resolves to something real."""
    if exists(candidate):
        return True
    if "." not in os.path.basename(candidate):
        # Extension-less import specifier: try each suffix the
        # module resolvers would try.
        for ext in IMPORT_EXTENSIONS:
            if exists(candidate + ext):
                return True
    return False


def _join_segments(match):
    """Quoted path segments of a root-join, or None if fewer than two."""
    segs = [s for s in QUOTED.findall(match) if s.strip()]
    return segs if len(segs) >= 2 else None


def check_reference(candidate):
    """Return the dangling path, or None when the reference is satisfied.

    None also means "not a concrete reference" (template, output/
    write-target, prose). See the module docstring for each case.
    """
    candidate = candidate.rstrip(TRAILING)
    if not candidate or ".." in candidate \
            or any(c in candidate for c in TEMPLATE_CHARS):
        return None
    if candidate.split("/", 1)[0] == "output":
        return None
    if candidate in EXACT_ALLOWED:
        return None
    if satisfied(candidate):
        return None
    original = candidate
    # Drop the words the space-tolerant regex absorbed from prose. A
    # space-joined word is prose; a /-joined segment is a real path
    # component and is never trimmed away.
    while " " in candidate:
        candidate = candidate[:candidate.rfind(" ")].rstrip(TRAILING)
        if not candidate or satisfied(candidate):
            return None
    return original if original != candidate else candidate


def suggestions_for(ref, by_basename, files):
    """Tracked files a dangling reference was probably meant to name.

    Same basename first (the moved-file case), then the same last two
    segments (a file that moved and was renamed in the same step).
    """
    hits = by_basename.get(os.path.basename(ref), [])
    if not hits and "/" in ref:
        tail = "/".join(ref.split("/")[-2:])
        hits = [f for f in files
                if f == tail or f.endswith("/" + tail)]
    return hits[:3]


def main():
    files = git_lines("ls-files", cwd=ROOT)
    by_basename = {}
    for f in files:
        by_basename.setdefault(os.path.basename(f), []).append(f)

    findings, refs_checked, scanned = [], 0, 0
    seen = set()

    for rel in files:
        if rel in SKIP_SCAN_FILES:
            continue
        if any(rel.startswith(p) for p in SKIP_SCAN_PREFIXES):
            continue
        if os.path.splitext(rel)[1].lower() in SKIP_EXT:
            continue
        base = os.path.basename(rel)
        if base in SKIP_NAME or base.endswith((".min.js", ".min.css")):
            continue
        try:
            if os.path.getsize(disk_path(rel)) > MAX_BYTES:
                continue
            with open(disk_path(rel), encoding="utf-8",
                      errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        scanned += 1

        for lineno, line in enumerate(text.splitlines(), 1):
            candidates = [m.group(0) for m in TOKEN_RE.finditer(line)
                          if not TRUNCATED_NEXT.match(
                              line[m.end():m.end() + 1] or "")]
            for m in JOIN_RE.finditer(line):
                segs = _join_segments(m.group(0))
                if segs:
                    candidates.append("/".join(segs))
            for m in OSJOIN_RE.finditer(line):
                segs = _join_segments(m.group(0))
                if segs:
                    candidates.append("/".join(segs))

            for candidate in candidates:
                refs_checked += 1
                dangling = check_reference(candidate)
                if dangling is None:
                    continue
                # The precision rule: report only the moved-file
                # signature. A name that exists nowhere in the repo
                # is undecidable from the tree, so it is not a
                # finding (see the module docstring).
                hints = suggestions_for(dangling, by_basename, files)
                if not hints:
                    continue
                key = (rel, lineno, dangling)
                if key in seen:
                    continue
                seen.add(key)
                findings.append((rel, lineno, dangling, hints))

    if findings:
        print(f"ISSUES ({len(findings):d}): references to moved files")
        for rel, lineno, dangling, hints in findings:
            print(f"  - {rel}:{lineno} references '{dangling}', "
                  "which does not exist on disk")
            for hint in hints:
                print(f"      did you mean: {hint}")
        return 1
    print(f"path references clean ({scanned:d} files scanned, "
          f"{refs_checked:d} references checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
