# ruff: noqa: N999
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

Warnings (reported, never fail): tag-vocabulary drift in both directions,
duplicate markdown basenames across directories, a missing `type:` frontmatter
field, orphan pages (no inbound wiki-links), and dangling wiki-links (links to
non-existent files).

Report-only: --scope=all inventories markdown outside the library, which the tag
checks never see. It applies no checks and never changes the exit code.

Run from anywhere:  python tools/validate-knowledge-tags.py [--scope=all]
Exit code 0 = clean, 1 = problems found.
"""

import glob
import os
import re
import sys
from collections import Counter

try:
    from _kb_links import (
        PAGE_TYPES,
        SPECIAL_FILES,
        extract_slugs,
    )
except ImportError:  # pragma: no cover
    import sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _kb_links import (  # noqa: E402
        PAGE_TYPES,
        SPECIAL_FILES,
        extract_slugs,
    )

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
SKIP = SPECIAL_FILES
# The core cross-cutting tags, as opposed to the extended vocabulary table.
# Both are read from tagging-guide.md by documented_tags(); this list is only
# used to decide which tags must carry a count in index.md's Tags Index.
CROSS = ["platform-youtube", "platform-unity", "platform-blender",
         "platform-comfyui", "platform-remotion", "hardware-8gb",
         "hardware-pascal", "mcp", "testing", "design", "audio",
         "visualization", "3d", "webgpu"]

# Valid page `type` values (OKF / LLM Wiki convention).
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
    with open(path, "rb") as f:
        data = f.read()
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", "replace")
    return data.decode("utf-8", "replace")


def frontmatter(path):
    """Return (raw_block, tags, data); (None, None, None) when block absent.

    `data` is the full decoded file text, so callers can reuse it instead of
    re-reading from disk.
    """
    data = read(path)
    m = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", data, re.S)
    if not m:
        return None, None, data
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
    return block, tags, data


def check_documents(docs):
    for name, path in sorted(docs.items()):
        block, tags, data = frontmatter(path)
        if block is None:
            errors.append(f"{name}: no frontmatter block")
            continue
        if not tags:
            errors.append(f"{name}: no tags")
            continue
        if tags[0] not in CATEGORIES:
            errors.append(f"{name}: first tag '{tags[0]}' is not a primary category")
        for required in ("aliases:", "cssclasses:", "date:"):
            if required not in block:
                errors.append(f"{name}: missing '{required}'")
        check_unique_keys(name, block)
        # C1 controls (0x80-0x9F) are mojibake from cp1252 misdecoding.
        # Regex search in C is far faster than a Python char-by-char loop.
        if re.search(r"[\x80-\x9f]", data):
            m = re.search(r"[\x80-\x9f]", data)
            errors.append(f"{name}: C1 control U+{ord(m.group()):04X} (mojibake)")


def check_unique_keys(name, block):
    """Reject duplicate top-level YAML keys.

    YAML silently keeps the last value for a repeated key, so a stale second
    `date:` looks fine in most tools while the first is discarded. Worse, a
    stray list item after a scalar key reparses the whole block. Eight documents
    had this and nothing caught it, because most readers do not error.
    """
    keys = re.findall(r"^([A-Za-z_][\w-]*):", block, re.M)
    dupes = sorted({k for k in keys if keys.count(k) > 1})
    if dupes:
        errors.append("{}: duplicate frontmatter key(s): {}".format(name, ", ".join(dupes)))


def check_tracker(docs):
    lines = read(TRACKER).split("\n")
    bounds = []
    for i, line in enumerate(lines):
        if line.startswith("### "):
            for idx, (sname, _stag) in enumerate(SECTIONS):
                if sname in line:
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
        for line in lines[start + 1:end]:
            if not line.startswith("- "):
                continue
            count += 1
            f = re.search(r"`([^`]+\.md)`", line)
            if not f:
                continue
            fn = f.group(1).split("/")[-1]
            if fn in seen:
                errors.append(f"{fn} listed twice in tracker")
            seen[fn] = stag
            if fn in docs:
                tags = frontmatter(docs[fn])[1]
                if tags and tags[0] in CATEGORIES and tags[0] != stag:
                    errors.append(f"{fn}: listed under {sname} but tagged '{tags[0]}'")
        if m and int(m.group(1)) != count:
            errors.append(f"{sname}: heading says {m.group(1)} but lists {count:d}")
        if m and int(m.group(2)) != count:
            errors.append(f"{sname}: heading denominator {m.group(2)} but lists {count:d}")

    for name in docs:
        if name not in seen and name != "migration-progress.md":
            errors.append(f"{name} exists but is not listed in the tracker")


def check_index(docs):
    idx = read(INDEX)
    primaries = Counter()
    cross = Counter()
    for _name, path in docs.items():
        tags = frontmatter(path)[1] or []
        if tags:
            primaries[tags[0]] += 1
            for t in tags[1:]:
                cross[t] += 1
    for c in CATEGORIES + CROSS:
        want = primaries.get(c, 0) if c in CATEGORIES else cross.get(c, 0)
        m = re.search(rf"\| `#{re.escape(c)}/?\*?` \|[^|]*\| (\d+) documents? \|", idx)
        if m and int(m.group(1)) != want:
            errors.append(f"index.md: #{c} says {m.group(1)}, actual {want:d}")


def check_index_gaps(docs):
    """Check that index.md's entries all resolve to a real document.

    The count check above catches a wrong *number*; this catches a wrong
    *name* — an index entry pointing at a document that does not exist,
    which is a dead end for anyone navigating by the index.

    The shared parser is used so that wiki-links written as syntax examples
    inside inline code (as index.md does with `[[wiki-links]]`) are not
    mistaken for real entries.
    """
    idx = read(INDEX)
    known = {os.path.splitext(name)[0] for name in docs}
    known.update(os.path.splitext(s)[0] for s in SKIP)

    seen = set()
    for slug in sorted(extract_slugs(idx)):
        if "/" in slug or ".." in slug:
            continue
        if slug in known or slug in seen:
            continue
        seen.add(slug)
        errors.append(f"index.md: entry [[{slug}]] points to a document "
                      f"that does not exist")


def check_vocabulary(docs):
    """Warn about tags in use that the guide does not document.

    These are not errors: a new tag is a normal way to extend the vocabulary.
    But an undocumented tag is invisible in index.md's Tags Index, so it is
    worth surfacing until someone adds it to the guide.
    """
    known = documented_tags()
    unknown = Counter()
    for _name, path in sorted(docs.items()):
        tags = frontmatter(path)[1] or []
        for t in tags[1:]:
            if t not in known:
                unknown[t] += 1
    for t, n in sorted(unknown.items(), key=lambda x: (-x[1], x[0])):
        warnings.append(f"tag '#{t}' used by {n:d} document(s) but not in tagging-guide.md")


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
            warnings.append(f"tag '#{tag}' is documented in tagging-guide.md but "
                            "no document uses it")


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
        warnings.append(f"duplicate basename '{name}' in {len(paths):d} locations ({kind}): {', '.join(paths)}")


def check_line_endings(docs):
    """Guard against CRLF creep.

    Rewriting a file with io.open(..., "w") on Windows converts every LF to
    CRLF, which turns a small edit into a whole-file diff. This repo stores
    markdown with LF, so flag any library file that has picked up CRLF.
    """
    for _name, path in sorted(docs.items()):
        with open(path, "rb") as f:
            data = f.read()
        if b"\r\n" in data:
            errors.append(f"{_name}: CRLF line endings (repo uses LF); "
                          "a rewrite likely converted them")


def check_type_field(docs):
    """Warn when a document lacks a `type:` frontmatter field or uses an
    unknown page type (OKF / LLM Wiki convention).

    Not yet an error: existing documents are migrated on touch. New documents
    created from _schema.md should include `type:`.
    """
    for name, path in sorted(docs.items()):
        block, _tags, data = frontmatter(path)
        if block is None:
            continue
        m = re.search(r"^type:\s*(\S+)", block, re.M)
        if not m:
            warnings.append(f"{name}: missing `type:` frontmatter field "
                            f"({', '.join(PAGE_TYPES)})")
            continue
        if m.group(1) not in PAGE_TYPES:
            warnings.append(f"{name}: unknown `type:` '{m.group(1)}' "
                            f"(expected one of {', '.join(PAGE_TYPES)})")


def extract_links(path):
    """Return the set of wiki-link slugs referenced in a document.

    Thin wrapper over the shared parser in tools/_kb_links.py, so this
    validator, tools/kb-graph.py and tools/kb-context.py all read the
    vault's links the same way. The parser strips display text
    (`[[slug|label]]`), anchors (`[[slug#section]]`) and `.md` extensions,
    skips cross-directory references, and treats wiki-links inside inline
    code as syntax examples rather than real links.
    """
    return extract_slugs(read(path))


def check_links(docs):
    """Warn about orphan pages (no inbound wiki-links) and dangling links
    (links to slugs with no matching document).

    index.md, README.md, _schema.md and log.md are scanned as link *sources*
    (their [[links]] count as inbound to targets) but are not themselves
    flagged as orphans — index.md is the vault entry point.
    """
    # Map basename-without-extension -> doc name for link resolution.
    basename_to_doc = {}
    for name in docs:
        basename_to_doc[os.path.splitext(name)[0]] = name
    # The special meta-files are also valid link targets even though they are
    # excluded from the per-document checks.
    for name in ("index.md", "README.md", "_schema.md", "log.md"):
        basename_to_doc[os.path.splitext(name)[0]] = name

    # All library markdown files count as link sources, including the special
    # meta-files that are excluded from the per-document checks.
    source_paths = {}
    for name in ("index.md", "README.md", "_schema.md", "log.md"):
        p = os.path.join(BASE, name)
        if os.path.exists(p):
            source_paths[name] = p
    source_paths.update(docs)

    inbound = Counter()
    for name, path in source_paths.items():
        for slug in extract_links(path):
            target = basename_to_doc.get(slug)
            if target is None:
                warnings.append(f"{name}: dangling wiki-link [[{slug}]] "
                                f"(no matching document)")
            else:
                inbound[target] += 1

    for name in sorted(docs):
        if name == "index.md":
            continue
        if inbound.get(name, 0) == 0:
            warnings.append(f"{name}: orphan page (no inbound wiki-links; "
                            f"add at least one [[link]] from a related doc)")


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
        block, tags, _ = frontmatter(full)
        if tags and tags[0] not in CATEGORIES:
            mismatched.append((rel, tags[0]))

    print("")
    print("=" * 72)
    print("REPORT: markdown outside docs/knowledge-library/ (no checks applied)")
    print("=" * 72)
    print(f"  tracked .md outside the library : {len(outside):d}")
    print(f"  with no frontmatter at all      : {len(no_fm):d}")
    print(f"  frontmatter but no library tag  : {len(mismatched):d}")
    by_dir = Counter()
    for rel in no_fm:
        by_dir[os.path.dirname(rel)] += 1
    print("\n  untagged files by directory:")
    for d, n in sorted(by_dir.items(), key=lambda x: (-x[1], x[0])):
        print(f"      {n:3d}  {d or '.'}")
    if mismatched:
        print("\n  frontmatter present but not library-tagged:")
        for rel, tag in mismatched[:10]:
            print(f"      {rel} (first tag: {tag})")
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
    check_index_gaps(docs)
    check_vocabulary(docs)
    check_dead_vocabulary(docs)
    check_duplicate_basenames()
    check_line_endings(docs)
    check_type_field(docs)
    check_links(docs)
    print(f"documents checked : {len(docs):d}")
    if warnings:
        print(f"warnings ({len(warnings):d}):")
        for w in warnings:
            print(f"  ! {w}")
    if errors:
        print(f"PROBLEMS ({len(errors):d}):")
        for e in errors:
            print(f"  - {e}")
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

