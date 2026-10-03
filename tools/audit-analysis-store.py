#!/usr/bin/env python3
"""Audit the audio-analysis store: naming conventions, stale files, index drift.

Run it read-only to see the damage:

    python tools/audit-analysis-store.py

What it reports
---------------
* **conventions** — how the analysis filenames break down (bare hash, hash+slug,
  slug-only, ``test-``/``orphan-`` prefixed). One convention is correct; the
  rest are historical.
* **stale**      — files with no ``schema_version`` (or an older one). They can
  never be served; the resolver refuses them and the frontend re-analyzes.
* **duplicates** — analyses of identical audio, found by fingerprinting the
  signal arrays rather than comparing names. ``--dedupe`` additionally prints
  which copy would be kept.
* **duplicate audio** — byte-identical audio files. Reported only.
* **dangling**   — ``index.json`` keys whose analysis file does not exist.

Flags
-----
``--dedupe``        include the duplicate-analysis report, naming each file as
                    KEEP / move / HOLD.
``--dedupe --apply`` quarantine redundant analysis copies under
                    ``audio_analysis/.quarantine/<timestamp>/``, keeping one per
                    group. Only files that match their keeper on **every**
                    non-provenance field are moved.
``--apply``         prune dangling ``index.json`` keys (not needed with
                    ``--dedupe``, which does not touch the index).

Nothing is modified without ``--apply``. ``--apply`` only removes index keys
that dangle or duplicate an entry which resolves. ``--dedupe --apply`` is the one
path that relocates analysis files, and only after two checks agree: the signal
arrays fingerprint identically *and* every non-provenance field matches the
keeper exactly. A file that differs in any field — ``sections``,
``suggested_visualization``, ``confidence``, ``estimated_key`` — is reported as
HOLD and left alone. Files are moved, never unlinked, so a wrong call is
recoverable by moving them back.

Note: no code path writes ``index.json`` any more (it held 62 keys for 17 files,
49 of them dangling). It is vestigial, and every lookup resolves against the
directory. This tool exists to describe that state, and ``--apply`` exists to
clean it up before the file is removed.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "packages" / "backend"))

from app.core.config import PROJECT_ROOT  # noqa: E402
from app.services.analysis_resolver import (  # noqa: E402
    choose_keeper,
    content_diff,
    content_fingerprint,
    hash_prefix,
    resolve_analysis,
    scan_analysis_dir,
)

ANALYSIS_DIR = PROJECT_ROOT / "output" / "audio_analysis"
AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
INDEX_PATH = ANALYSIS_DIR / "index.json"
SCHEMA_VERSION = 2


def convention_of(stem: str) -> str:
    """Classify a filename into the convention that produced it."""
    if stem.startswith("orphan-") or stem.startswith("test-"):
        return "test/orphan prefix"
    if hash_prefix(stem):
        return "hash + slug"
    if len(stem) == 8 and all(c in "0123456789abcdef" for c in stem):
        return "bare hash"
    return "slug only"


def read_schema(path: Path) -> int | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data.get("schema_version") if isinstance(data, dict) else None


def report_duplicates(candidates, apply: bool) -> int:
    """Find analyses of identical audio and optionally quarantine redundant ones.

    Two independent checks must pass before a file is moved:

    1. **Fingerprint** — the signal arrays match, so it really is the same audio.
    2. **Content diff** — every non-provenance field matches exactly, so the
       document carries nothing the keeper lacks. This is the check that stops a
       copy with LLM-refined `sections` or a different `suggested_visualization`
       from being discarded.

    A file failing (2) is reported and left alone, however confident (1) is.

    Files are *moved* to `audio_analysis/.quarantine/<timestamp>/`, not unlinked,
    so the whole operation is reversible by moving them back.
    """
    by_fp: dict[str, list] = defaultdict(list)
    unfingerprinted = []
    for c in candidates:
        try:
            doc = json.loads(c.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            unfingerprinted.append(c.path.name)
            continue
        fp = content_fingerprint(doc)
        if fp is None:
            unfingerprinted.append(c.path.name)
            continue
        by_fp[fp].append(c)

    groups = {fp: g for fp, g in by_fp.items() if len(g) > 1}
    if unfingerprinted:
        print(f"  skipped (too sparse/corrupt to fingerprint): {len(unfingerprinted)}")
    if not groups:
        print("  no duplicate analyses found")
        return 0

    removable: list = []
    held: list[tuple] = []
    for fp, group in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        keeper = choose_keeper(group)
        print(f"\n  [{fp}] x{len(group)} — identical audio")
        print(f"      KEEP   {keeper.path.name}  (v{keeper.schema_version})")
        try:
            keeper_doc = json.loads(keeper.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            keeper_doc = {}
        for c in group:
            if c.path == keeper.path:
                continue
            try:
                doc = json.loads(c.path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                held.append((c, "unreadable"))
                print(f"      HOLD   {c.path.name}  (unreadable — not touched)")
                continue
            differing = content_diff(doc, keeper_doc)
            if differing:
                held.append((c, ",".join(differing)))
                print(f"      HOLD   {c.path.name}  (differs from keeper: {', '.join(differing)})")
            else:
                removable.append(c)
                print(f"      move   {c.path.name}  (v{c.schema_version}; identical to keeper)")

    reclaimed = sum(c.path.stat().st_size for c in removable)
    print(f"\n  verified redundant: {len(removable)} file(s), {reclaimed / 1e6:.2f} MB")
    if held:
        print(f"  held back (NOT identical): {len(held)} file(s)")
    if not apply:
        print("  Read-only. Re-run with --dedupe --apply to quarantine the above.")
        return 0
    if not removable:
        print("  Nothing to quarantine.")
        return 0

    quarantine = ANALYSIS_DIR / ".quarantine" / datetime.now().strftime("%Y%m%d-%H%M%S")
    quarantine.mkdir(parents=True, exist_ok=True)
    for c in removable:
        shutil.move(str(c.path), str(quarantine / c.path.name))
    print(f"  Moved {len(removable)} file(s) to {quarantine.relative_to(REPO)}")
    print("  Reversible: move them back into output/audio_analysis/ if needed.")
    return 0


def report_duplicate_audio() -> None:
    """Report byte-identical audio files. Information only — never deleted.

    Hashing is by size plus first/last MiB: full hashing means reading hundreds
    of megabytes of audio for a check that almost always agrees.
    """
    if not AUDIO_DIR.exists():
        return
    files = [
        p
        for p in AUDIO_DIR.rglob("*")
        if p.is_file() and p.suffix.lower() in {".mp3", ".wav", ".m4a", ".flac", ".ogg"}
    ]
    if not files:
        return

    def fp(p: Path) -> str:
        h = hashlib.sha256()
        size = p.stat().st_size
        h.update(str(size).encode())
        with p.open("rb") as f:
            h.update(f.read(1 << 20))
            if size > (2 << 20):
                f.seek(-(1 << 20), 2)
                h.update(f.read(1 << 20))
        return h.hexdigest()[:16]

    groups: dict[str, list] = defaultdict(list)
    for p in files:
        groups[fp(p)].append(p)

    dupes = {k: v for k, v in groups.items() if len(v) > 1}
    print(f"\nAudio: {len(files)} files, {len(groups)} unique, {len(dupes)} duplicate group(s)")
    for k, v in sorted(dupes.items(), key=lambda kv: -len(kv[1])):
        print(f"  [{k}] x{len(v)}  ({v[0].stat().st_size / 1e6:.1f} MB each)")
        for p in sorted(v):
            print(f"      {p.relative_to(AUDIO_DIR).as_posix()}")
    if dupes:
        print("  (reported only — deleting audio is not this tool's call)")


def main() -> int:
    candidates = scan_analysis_dir(ANALYSIS_DIR, read_schema)
    if not candidates:
        print(f"No analysis files under {ANALYSIS_DIR}")
        return 0

    # --- conventions -------------------------------------------------------
    by_convention: dict[str, list[str]] = defaultdict(list)
    for c in candidates:
        by_convention[convention_of(c.stem)].append(c.path.name)
    print(f"Analysis files: {len(candidates)}\nNaming conventions:")
    for name, files in sorted(by_convention.items(), key=lambda kv: -len(kv[1])):
        print(f"  {len(files):>3}  {name}")

    # --- staleness ---------------------------------------------------------
    stale = [c for c in candidates if c.schema_version is None or c.schema_version < SCHEMA_VERSION]
    print(f"\nStale (pre-v{SCHEMA_VERSION}, unservable): {len(stale)}")
    for c in stale:
        print(f"  {c.path.name}  (v{c.schema_version})")

    # --- do library tracks resolve? ---------------------------------------
    tracks = sorted(p.name for p in AUDIO_DIR.glob("*.mp3")) if AUDIO_DIR.exists() else []
    resolved, unresolved = [], []
    for t in tracks:
        r = resolve_analysis(t, candidates, SCHEMA_VERSION)
        (resolved if r.match else unresolved).append((t, r))
    print(f"\nLibrary tracks: {len(tracks)}   resolved: {len(resolved)}   unresolved: {len(unresolved)}")
    for t, r in unresolved:
        print(f"  {t}\n      {r.reason}")

    # --- index drift -------------------------------------------------------
    if not INDEX_PATH.exists():
        print("\nNo index.json")
        return 0
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    stems = {c.stem for c in candidates}
    dangling = {k: v for k, v in index.items() if v not in stems}
    targets: dict[str, list[str]] = defaultdict(list)
    for k, v in index.items():
        if v in stems:
            targets[v].append(k)

    print(f"\nindex.json: {len(index)} keys -> {len(stems)} analysis files")
    print(f"  dangling keys (target missing): {len(dangling)}")
    for k in list(dangling)[:5]:
        print(f"      {k} -> {dangling[k]}")
    if len(dangling) > 5:
        print(f"      ... and {len(dangling) - 5} more")
    dupes = {t: ks for t, ks in targets.items() if len(ks) > 1}
    print(f"  files referenced by >1 key:     {len(dupes)}")
    for t, ks in list(dupes.items())[:5]:
        print(f"      {t} <- {len(ks)} keys")

    # --- duplicate analyses -------------------------------------------------
    print("\nDuplicate analyses (identical audio, stored more than once):")
    report_duplicates(candidates, apply="--dedupe" in sys.argv and "--apply" in sys.argv)

    # --- duplicate audio ----------------------------------------------------
    report_duplicate_audio()

    # --- optional index repair ---------------------------------------------
    if "--apply" not in sys.argv:
        print("\nRead-only. Re-run with --apply to prune dangling index keys.")
        return 0

    resolved_stems = {r.match.stem for _, r in resolved if r.match}
    drop = set(dangling)
    for target, keys in dupes.items():
        if target in resolved_stems:
            drop.update(k for k in keys if k != keys[0])
    if not drop:
        print("\nNothing to prune.")
        return 0
    INDEX_PATH.write_text(
        json.dumps({k: v for k, v in index.items() if k not in drop}, indent=2),
        encoding="utf-8",
    )
    print(f"\nPruned {len(drop)} index key(s); {len(index) - len(drop)} remain.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
