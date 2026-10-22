#!/usr/bin/env python3
"""Report dangling path references in operational docs (report-only).

The gated checker (tools/check-path-references.py, decision D39) catches
the *moved-file signature*: a reference whose target is gone but whose
basename survives elsewhere in the tree. It deliberately does not report
references whose names appear nowhere in the repo -- from the tree alone
those are undecidable (generated outputs, external assets, planned
files, prose), and a repo-wide existence gate drowned in exactly those
false positives when it was tried (176 raw misses, only the
signature-backed ones real).

That leaves one decidable residue: references in *operational* docs --
the files agents and humans follow as instructions (AGENTS.md, README
files, setup/ux/guides/plans, and the knowledge library's navigation
surfaces). A path named there is meant to be followed, so when its
basename exists nowhere in the tree it is either a deletion orphan or a
never-existed name, and either way it misleads the next reader. Two
lived in the library's navigation and test-plan docs until 2026-10-22
(a WebGPU doc that never existed; a `node tools/mcp/comfyui-mcp.mjs`
startup command for a file that was never written).

This tool lists that residue. Report-only by design: it never affects
an exit code. Each finding is a short human decision -- repoint it,
remove it, or allowlist it below with the reason it is intentional.

Scope: markdown only, in AGENTS.md, every README.md, docs/setup/,
docs/ux/, docs/guides/, docs/plans/, docs/architecture/ (except the
decision log, a historical record), and the library's index and
navigation docs. References whose basename survives elsewhere are
skipped -- those are the D39 gate's findings, not this report's.
Targets under generated or external-shaped paths (dot-directories such
as .venv, out/ and output/ segments, media/binary/log extensions,
versioned directory names like ACE-Step-1.5, templates and globs) are
not references an operational doc can mean literally, so they are
excluded.

Run:  python tools/report-path-orphans.py
Exit: always 0.
"""

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gitutil import git_lines  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

TOP_DIRS = ("docs/", "tools/", "packages/", "scripts/", "config/",
            "shared/", "unity-visualizer/", "suno-templates/")
TOKEN = re.compile(
    r"(?<![\w/.-])((?:docs|tools|packages|scripts|config|shared|"
    r"unity-visualizer|suno-templates)/[\w./-]+\.[a-z0-9]{1,5})")
LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")
SKIP_EXTS = {".mp4", ".mov", ".png", ".jpg", ".jpeg", ".gif", ".webp",
             ".wav", ".mp3", ".onnx", ".bin", ".gguf", ".zip", ".log"}
LIBRARY_NAV = {"docs/knowledge-library/index.md",
               "docs/knowledge-library/ai-agent-navigation.md"}

# (source path, target) pairs that are intentional, with the reason.
# Keep this list short and honest: every entry is a reference a reader
# would otherwise follow to a file that does not exist.
ALLOWLIST = {
    # CONDA_SETUP.md documents the retired conda flow. The repo's
    # measured state (docs/setup/python-environments.md) is that no
    # conda installation exists on the machine; the doc and its script
    # reference are legacy, kept for history.
    ("docs/setup/CONDA_SETUP.md", "scripts/setup-conda-env.ps1"),
    # SETUP_SUMMARY.md is a point-in-time summary; the health-check
    # script it names was never committed, and the implementation
    # summary it links was removed from the tree long ago.
    ("docs/setup/SETUP_SUMMARY.md", "scripts/check-env-health.ps1"),
    ("docs/setup/SETUP_SUMMARY.md", "docs/implementation-summary.md"),
    # Written at runtime by the tunnel scripts on first run; existence
    # before then proves nothing.
    ("docs/setup/tunnel-access.md", "scripts/utility/tunnel-urls.json"),
}


def in_scope(rel):
    if rel == "AGENTS.md" or rel in LIBRARY_NAV:
        return True
    if os.path.basename(rel) == "README.md":
        return True
    if rel == "docs/architecture/decision-log.md":
        return False
    return rel.startswith(("docs/setup/", "docs/ux/", "docs/guides/",
                             "docs/plans/", "docs/architecture/"))


def tracked_sets():
    files = git_lines("ls-files")
    basenames = set()
    tails = set()
    for f in files:
        basenames.add(os.path.basename(f))
        parts = f.split("/")
        if len(parts) >= 2:
            tails.add("/".join(parts[-2:]))
    return basenames, tails


def excluded(target):
    if any(ch in target for ch in "<>{}*") or ".." in target:
        return True
    segments = target.split("/")
    if any(s.startswith(".") for s in segments):
        return True
    if os.path.splitext(target)[1][1:].isdigit():
        return True  # versioned directory (ACE-Step-1.5), not a file
    if "out" in segments or "output" in segments:
        return True
    return os.path.splitext(target)[1].lower() in SKIP_EXTS


def references(path, rel):
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return
    for lineno, line in enumerate(text.splitlines(), 1):
        found = {m.group(1).strip(".,;:)`'\"") for m in TOKEN.finditer(line)}
        for m in LINK.finditer(line):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:", "#", "/")):
                continue
            parts = []
            for seg in (os.path.dirname(rel) + "/" + target).split("/"):
                if seg == "..":
                    if parts:
                        parts.pop()
                elif seg not in (".", ""):
                    parts.append(seg)
            resolved = "/".join(parts)
            if resolved.startswith(TOP_DIRS):
                found.add(resolved)
        for target in sorted(found):
            yield lineno, target


def main():
    basenames, tails = tracked_sets()
    sources = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if d not in {".git", "node_modules", "__pycache__"}]
        for name in filenames:
            if not name.endswith(".md"):
                continue
            path = Path(dirpath) / name
            rel = path.relative_to(ROOT).as_posix()
            if in_scope(rel):
                sources.append((path, rel))
    orphans = []
    checked = 0
    for path, rel in sorted(sources, key=lambda s: s[1]):
        for lineno, target in references(path, rel):
            checked += 1
            if excluded(target) or (ROOT / target).exists():
                continue
            base = os.path.basename(target)
            tail = "/".join(target.split("/")[-2:])
            if base in basenames or tail in tails:
                continue  # moved-file signature: the D39 gate's finding
            if (rel, target) in ALLOWLIST:
                continue
            orphans.append((rel, lineno, target))
    print(f"path orphans (report-only): {len(sources)} operational docs, "
          f"{checked} references checked, {len(orphans)} dangling")
    for rel, lineno, target in orphans:
        print(f"  {rel}:{lineno} -> {target}")
    if orphans:
        print("Each names a file that exists nowhere in the tree. Repoint, "
              "remove, or allowlist it in report-path-orphans.py with a "
              "reason. Moved-file references are gated separately by "
              "check-path-references.py (D39).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
