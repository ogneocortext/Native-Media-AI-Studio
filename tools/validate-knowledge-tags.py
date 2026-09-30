"""Validate knowledge-library frontmatter, the tag taxonomy, and doc hygiene.

Library checks (errors fail the pre-commit hook):
  1. every library document has a frontmatter block;
  2. its first tag is one of the seven primary categories (the rule that four
     documents silently violated);
  3. it declares aliases, cssclasses and a date, with no duplicate YAML keys;
  4. no mojibake (C1 controls) remains, and line endings are LF;
  5. migration-progress.md lists every document exactly once, in the section
     matching that document's primary tag, with correct (N/N) counters;
  6. index.md tag counts match the tags actually present.

Warnings (reported, never fail): tag-vocabulary drift in both directions, and
duplicate markdown basenames across directories.

Report-only: --scope=all inventories markdown outside the library, which the tag
checks never see. It applies no checks and never changes the exit code.

Run from anywhere:  python tools/validate-knowledge-tags.py [--scope=all]
Exit code 0 = clean, 1 = problems found.
"""
from __future__ import print_function

import glob
import io
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "docs", "knowledge-library")
TRACKER = os.path.join(BASE, "migration-progress.md")
INDEX = os.path.join(BASE, "index.md")

CATEGORIES = ["production", "technical", "platform", "creative",
              "performance", "ai", "research"]
SECTIONS = [
    ("Production Pipeline", "production"),
    ("Technical Implementation", "technical"),
    ("MCP & Platform Integrations", "platform"),
    ("Creative & Visual", "creative"),
    ("Performance & Hardware", "performance"),
    ("AI & ML", "ai"),
    ("Research & Reference", "research"),
]
SKIP = ("index.md", "README.md")
# The core cross-cutting tags, as opposed to the extended vocabulary table.
# Both are read from tagging-guide.md by documented_tags(); this list is only
# used to decide which tags must carry a count in index.md's Tags Index.
CROSS = ["platform-youtube", "platform-unity", "platform-blender",
         "platform-comfyui", "platform-remotion", "hardware-8gb",
         "hardware-pascal", "mcp", "testing", "design", "audio",
         "visualization", "3d", "webgpu"]

errors = []
warnings = []


def documented_tags():
    """Every tag the guide documents, in either table.

    Derived from the file so the taxonomy cannot drift from the guide: a tag in
    use but absent here is reported as a warning.
    """
    guide = read(os.path.join(BASE, "tagging-guide.md"))
    found = set(re.findall(r"`#([\w-]+)`", guide))
    return found | set(CATEGORIES)


def read(path):
    """Read a text file, tolerating a UTF-16 BOM.

    A couple of tracked markdown files are UTF-16 (byte-order mark FF FE), which
    is why a plain utf-8 read raised UnicodeDecodeError and crashed the report.
    Decoding by BOM keeps the tool working and lets the report name the file;
    whether those files should be UTF-8 is a separate cleanup.
    """
    with io.open(path, "rb") as f:
        data = f.read()
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", "replace")
    return data.decode("utf-8", "replace")


def frontmatter(path):
    """Return (raw_block, tags); (None, None) when the block is absent."""
    m = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", read(path), re.S)
    if not m:
        return None, None
    block = m.group(1)
    tags = []
    in_tags = False
    for line in block.split("\n"):
        if re.match(r"^\w[\w-]*:", line):
            in_tags = line.startswith("tags:")
            continue
        if in_tags:
            t = re.match(r"^\s*-\s*(\S+)\s*$", line)
            if t:
                tags.append(t.group(1))
    return block, tags


def check_documents(docs):
    for name, path in sorted(docs.items()):
        block, tags = frontmatter(path)
        if block is None:
            errors.append("%s: no frontmatter block" % name)
            continue
        if not tags:
            errors.append("%s: no tags" % name)
            continue
        if tags[0] not in CATEGORIES:
            errors.append("%s: first tag '%s' is not a primary category"
                          % (name, tags[0]))
        for required in ("aliases:", "cssclasses:", "date:"):
            if required not in block:
                errors.append("%s: missing '%s'" % (name, required))
        check_unique_keys(name, block)
        for ch in read(path):
            if 0x80 <= ord(ch) <= 0x9F:
                errors.append("%s: C1 control U+%04X (mojibake)" % (name, ord(ch)))
                break


def check_unique_keys(name, block):
    """Reject duplicate top-level YAML keys.

    YAML silently keeps the last value for a repeated key, so a stale second
    `date:` looks fine in most tools while the first is discarded. Worse, a
    stray list item after a scalar key reparses the whole block. Eight documents
    had this and nothing caught it, because most readers do not error.
    """
    keys = re.findall(r"^([A-Za-z_][\w-]*):", block, re.M)
    dupes = sorted(set(k for k in keys if keys.count(k) > 1))
    if dupes:
        errors.append("%s: duplicate frontmatter key(s): %s"
                      % (name, ", ".join(dupes)))


def check_tracker(docs):
    lines = read(TRACKER).split("\n")
    bounds = []
    for i, l in enumerate(lines):
        if l.startswith("### "):
            for idx, (sname, stag) in enumerate(SECTIONS):
                if sname in l:
                    bounds.append((i, idx))
                    break
    if not bounds:
        errors.append("migration-progress.md: no category sections found")
        return

    block_end = len(lines)
    for i in range(bounds[-1][0], len(lines)):
        if lines[i].startswith("## "):
            block_end = i
            break

    seen = {}
    for k, (start, sidx) in enumerate(bounds):
        end = bounds[k + 1][0] if k + 1 < len(bounds) else block_end
        sname, stag = SECTIONS[sidx]
        count = 0
        m = re.search(r"\((\d+)/(\d+)", lines[start])
        for l in lines[start + 1:end]:
            if not l.startswith("- "):
                continue
            count += 1
            f = re.search(r"`([^`]+\.md)`", l)
            if not f:
                continue
            fn = f.group(1).split("/")[-1]
            if fn in seen:
                errors.append("%s listed twice in tracker" % fn)
            seen[fn] = stag
            if fn in docs:
                tags = frontmatter(docs[fn])[1]
                if tags and tags[0] in CATEGORIES and tags[0] != stag:
                    errors.append("%s: listed under %s but tagged '%s'"
                                  % (fn, sname, tags[0]))
        if m and int(m.group(1)) != count:
            errors.append("%s: heading says %s but lists %d"
                          % (sname, m.group(1), count))
        if m and int(m.group(2)) != count:
            errors.append("%s: heading denominator %s but lists %d"
                          % (sname, m.group(2), count))

    for name in docs:
        if name not in seen and name != "migration-progress.md":
            errors.append("%s exists but is not listed in the tracker" % name)


def check_index(docs):
    idx = read(INDEX)
    primaries = Counter()
    cross = Counter()
    for name, path in docs.items():
        tags = frontmatter(path)[1] or []
        if tags:
            primaries[tags[0]] += 1
            for t in tags[1:]:
                cross[t] += 1
    for c in CATEGORIES + CROSS:
        want = primaries.get(c, 0) if c in CATEGORIES else cross.get(c, 0)
        m = re.search(r"\| `#%s/?\*?` \|[^|]*\| (\d+) documents? \|"
                      % re.escape(c), idx)
        if m and int(m.group(1)) != want:
            errors.append("index.md: #%s says %s, actual %d"
                          % (c, m.group(1), want))


def check_vocabulary(docs):
    """Warn about tags in use that the guide does not document.

    These are not errors: a new tag is a normal way to extend the vocabulary.
    But an undocumented tag is invisible in index.md's Tags Index, so it is
    worth surfacing until someone adds it to the guide.
    """
    known = documented_tags()
    unknown = Counter()
    for name, path in sorted(docs.items()):
        tags = frontmatter(path)[1] or []
        for t in tags[1:]:
            if t not in known:
                unknown[t] += 1
    for t, n in sorted(unknown.items(), key=lambda x: (-x[1], x[0])):
        warnings.append("tag '#%s' used by %d document(s) but not in "
                        "tagging-guide.md" % (t, n))


def check_dead_vocabulary(docs):
    """Warn about tags the guide documents that no document uses.

    The companion to check_vocabulary: retiring a tag from a document can leave
    a row in the guide that nothing references. These are warnings, not errors -
    a tag may be documented in anticipation of use.
    """
    in_use = set()
    for path in docs.values():
        in_use.update(frontmatter(path)[1] or [])
    # index.md and README.md are excluded from `docs` but may still carry tags.
    for extra in (os.path.join(BASE, "index.md"), os.path.join(BASE, "README.md")):
        if os.path.exists(extra):
            in_use.update(frontmatter(extra)[1] or [])
    guide = read(os.path.join(BASE, "tagging-guide.md"))
    for tag in re.findall(r"\|\s*`#([\w-]+)`\s*\|", guide):
        if tag not in in_use:
            warnings.append("tag '#%s' is documented in tagging-guide.md but "
                            "no document uses it" % tag)


def check_duplicate_basenames():
    """Warn when two tracked markdown files share a basename.

    Wiki-links resolve by basename, so two files called ``three-js-studio.md``
    make every ``[[three-js-studio]]`` ambiguous, and the two copies drift
    silently. The repo already has this: docs/knowledge/three-js-studio.md and
    docs/knowledge-library/three-js-studio.md are different documents.

    A warning, not an error: README.md legitimately appears in many folders, so
    this is reported rather than enforced.

    Only git-tracked files are considered. Walking the filesystem picks up
    vendored trees (.venv, dist, site-packages) that are gitignored and would
    bury the real signal in dozens of LICENSE.md hits.
    """
    try:
        import subprocess
        out = subprocess.check_output(
            ["git", "ls-files", "*.md"], cwd=ROOT,
            stderr=subprocess.DEVNULL)
        tracked = out.decode("utf-8", "replace").split("\n")
    except Exception:
        return  # not a git checkout, or git unavailable: skip quietly

    seen = {}
    for rel in tracked:
        rel = rel.strip()
        if not rel:
            continue
        full = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.isfile(full):
            continue
        seen.setdefault(os.path.basename(rel), []).append(rel.replace("\\", "/"))

    for name, paths in sorted(seen.items()):
        if len(paths) < 2:
            continue
        identical = None
        if len(paths) == 2:
            identical = (read(os.path.join(ROOT, paths[0].replace("/", os.sep))) ==
                         read(os.path.join(ROOT, paths[1].replace("/", os.sep))))
        kind = "identical copies" if identical else "DIVERGENT copies"
        warnings.append("duplicate basename '%s' in %d locations (%s): %s"
                        % (name, len(paths), kind, ", ".join(paths)))


def check_line_endings(docs):
    """Guard against CRLF creep.

    Rewriting a file with io.open(..., "w") on Windows converts every LF to
    CRLF, which turns a small edit into a whole-file diff. This repo stores
    markdown with LF, so flag any library file that has picked up CRLF.
    """
    for name, path in sorted(docs.items()):
        with io.open(path, "rb") as f:
            data = f.read()
        if b"\r\n" in data:
            errors.append("%s: CRLF line endings (repo uses LF); "
                          "a rewrite likely converted them" % name)


def report_all_docs():
    """Report-only inventory of markdown outside the knowledge library.

    The tag checks only see docs/knowledge-library/. This walks the rest of the
    repository so documents the taxonomy has never covered are visible instead
    of invisible. Reports only - it changes no exit code and no check state,
    because failing 40+ pre-existing files would block every commit until they
    were all fixed, which is a separate decision about the docs taxonomy.

    Run:  python tools/validate-knowledge-tags.py --scope=all
    """
    try:
        import subprocess
        out = subprocess.check_output(
            ["git", "ls-files", "*.md"], cwd=ROOT,
            stderr=subprocess.DEVNULL)
        tracked = [r.strip() for r in out.decode("utf-8", "replace").split("\n") if r.strip()]
    except Exception:
        return []

    lib_prefix = "docs" + os.sep + "knowledge-library" + os.sep
    outside, no_fm, mismatched = [], [], []
    for rel in tracked:
        full = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.isfile(full):
            continue
        if rel.startswith("docs/knowledge-library/"):
            continue
        outside.append(rel)
        text = read(full)
        if not re.match(r"\A---\r?\n", text):
            no_fm.append(rel)
            continue
        # Has frontmatter: is the first tag a library category?
        block, tags = frontmatter(full)
        if tags and tags[0] not in CATEGORIES:
            mismatched.append((rel, tags[0]))

    print("")
    print("=" * 72)
    print("REPORT: markdown outside docs/knowledge-library/ (no checks applied)")
    print("=" * 72)
    print("  tracked .md outside the library : %d" % len(outside))
    print("  with no frontmatter at all      : %d" % len(no_fm))
    print("  frontmatter but no library tag  : %d" % len(mismatched))
    by_dir = Counter()
    for rel in no_fm:
        by_dir[os.path.dirname(rel)] += 1
    print("\n  untagged files by directory:")
    for d, n in sorted(by_dir.items(), key=lambda x: (-x[1], x[0])):
        print("      %3d  %s" % (n, d or "."))
    if mismatched:
        print("\n  frontmatter present but not library-tagged:")
        for rel, tag in mismatched[:10]:
            print("      %s (first tag: %s)" % (rel, tag))
    print("\n  These are not failures. Decide deliberately whether each is")
    print("  (a) library material that needs migrating, (b) a separate doc set")
    print("  with its own conventions, or (c) a historical artifact to archive.")
    return no_fm


def main():
    args = sys.argv[1:]
    docs = collect()
    check_documents(docs)
    check_tracker(docs)
    check_index(docs)
    check_vocabulary(docs)
    check_dead_vocabulary(docs)
    check_duplicate_basenames()
    check_line_endings(docs)
    print("documents checked : %d" % len(docs))
    if warnings:
        print("warnings (%d):" % len(warnings))
        for w in warnings:
            print("  ! %s" % w)
    if errors:
        print("PROBLEMS (%d):" % len(errors))
        for e in errors:
            print("  - %s" % e)
        return 1
    if "--scope=all" in args or "-a" in args:
        report_all_docs()
    print("")
    print("all checks passed")
    return 0


def collect():
    docs = {}
    for path in sorted(glob.glob(os.path.join(BASE, "*.md"))):
        name = os.path.basename(path)
        if name not in SKIP:
            docs[name] = path
    return docs


if __name__ == "__main__":
    sys.exit(main())

