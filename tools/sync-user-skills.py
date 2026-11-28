#!/usr/bin/env python3
"""Mirror the tracked canonical skills into every home-level agent host dir.

`tools/sync-skill-mirrors.py` covers the REPO mirrors (`.kilo/`, `.devin/`,
`.agents/`, `packages/frontend/...`) — hosts launched inside this repository.
This script covers the OTHER half: hosts launched from the user's home
directory (`~/.claude`, `~/.codex`, `~/.gemini`, ...). Those hosts read their
own `skills/` dir and never see the repo, so without this they only get the
handful of skills someone copied there by hand.

Canonical = the union of:
  * the tracked repo set   `.claude/skills/`  (authoritative when present)
  * a baked-in fallback    `_HOME_ONLY_SKILLS` below, for the skills that live
    only at user level (hyperframes, media-use, ...) and are not tracked.

Copy rule: newest wins. A host copy whose newest mtime is newer than canonical
is adopted INTO canonical first (never silently overwritten), then every host
is made byte-identical to canonical. Host-local skills that are not in the
canonical set are left untouched — they are not ours to move (`.codex`'s
`.system` / `codex-primary-runtime`, `.copilot`'s `browseros-neo`).

`--check` reports drift and exits 1 without writing; that is the form the CI
gate uses.

Run:
  python tools/sync-user-skills.py             # sync every home host
  python tools/sync-user-skills.py --check     # report drift, change nothing
  python tools/sync-user-skills.py --list      # show hosts and skill counts
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / ".claude" / "skills"
HOME = Path.home()

# Cache for skill_files() keyed by resolved directory path. The function is
# called repeatedly for the same directories (newest_mtime per host/skill in
# collect_canonical, plus twice per skill/host in dirs_differ), so memoizing
# avoids redundant rglob walks on every call.
_skill_files_cache: dict[Path, dict[str, Path]] = {}

# Skills that live only at user level today. If the canonical repo set already
# carries one of these, canonical wins and this list entry is ignored — the
# list is only a fallback so a fresh machine still gets them.
_HOME_ONLY_SKILLS = [
    "hyperframes",
    "hyperframes-animation",
    "hyperframes-audio",
    "hyperframes-cli",
    "hyperframes-core",
    "hyperframes-creative",
    "hyperframes-keyframes",
    "hyperframes-registry",
    "hyperframes-studio",
    "media-use",
    "game-development",
    "frontend-design",
    "playwright",
    "browser-automation",
]

# Every home-level host that reads a `skills/` directory. A missing root is
# skipped (the host is not installed); the dir is created on first sync.
HOST_DIRS = [
    ".claude",
    ".agents",
    ".codex",
    ".gemini",
    ".copilot",
    ".continue",
    ".factory",
    ".openclaw",
    ".kilocode",
    ".kilo",
    ".codeium/windsurf",
    ".gemini/antigravity",
]


def skill_files(skill_dir: Path) -> dict[str, Path]:
    """rel-posix-path -> file for every non-artifact file under skill_dir."""
    key = skill_dir.resolve()
    if key in _skill_files_cache:
        return _skill_files_cache[key]
    out: dict[str, Path] = {}
    for p in skill_dir.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(skill_dir).as_posix()
        if "__pycache__" in rel.split("/") or rel.endswith(".pyc"):
            continue
        out[rel] = p
    _skill_files_cache[key] = out
    return out


def dirs_differ(a: Path, b: Path) -> bool:
    """True when two skill dirs are not byte-identical (names or content)."""
    fa, fb = skill_files(a), skill_files(b)
    if set(fa) != set(fb):
        return True
    # Cheap size pre-check before expensive byte reads
    for r in fa:
        try:
            if fa[r].stat().st_size != fb[r].stat().st_size:
                return True
        except OSError:
            return True
    return any(fa[r].read_bytes() != fb[r].read_bytes() for r in fa)


def newest_mtime(skill_dir: Path) -> float:
    """mtime of the most recently written file under skill_dir (0 if empty)."""
    files = skill_files(skill_dir)
    if not files:
        return 0.0
    return max(p.stat().st_mtime for p in files.values())


def collect_canonical() -> tuple[dict[str, Path], list[str]]:
    """canonical skill name -> source dir, plus notes about adoption.

    Starts from the tracked repo set (authoritative). For each user-level-only
    skill not carried canonically, searches the home hosts and adopts the NEWEST
    copy found, so a host that someone updated by hand wins over the fallback.
    """
    canonical: dict[str, Path] = {}
    for d in sorted(CANON.iterdir()) if CANON.is_dir() else []:
        if d.is_dir():
            canonical[d.name] = d

    notes: list[str] = []
    for name in _HOME_ONLY_SKILLS:
        if name in canonical:
            continue
        best: Path | None = None
        best_mtime = -1.0
        for host in HOST_DIRS:
            cand = HOME / host / "skills" / name
            if not cand.is_dir():
                continue
            m = newest_mtime(cand)
            if m > best_mtime:
                best, best_mtime = cand, m
        if best is not None:
            canonical[name] = best
            notes.append(f"adopt {name} <- {best.relative_to(HOME).as_posix()}")
        else:
            notes.append(f"MISSING {name} (not in repo and no host copy)")
    return canonical, notes


def sync(*, check: bool) -> int:
    canonical, notes = collect_canonical()
    for n in notes:
        print(n)

    missing = [n for n in notes if n.startswith("MISSING")]
    names = sorted(canonical)
    if not names:
        print("FAIL: canonical skill set is empty")
        return 1

    drift: list[str] = []
    copied = 0
    present_hosts = 0
    for host in HOST_DIRS:
        root = HOME / host / "skills"
        if not root.parent.exists():
            continue  # host not installed
        present_hosts += 1
        root.mkdir(parents=True, exist_ok=True)
        for name in names:
            src = canonical[name]
            dst = root / name
            if dst.is_symlink():
                continue
            if not dst.is_dir() or dirs_differ(src, dst):
                drift.append(f"{host}/skills/{name}")
                if not check:
                    if dst.exists():
                        shutil.rmtree(dst)
                    shutil.copytree(src, dst)
                    copied += 1

    if check:
        for d in drift:
            print(f"DRIFT {d}")
        status = "drift" if drift else "in sync"
        print(
            f"check-user-skills: {len(canonical)} skills x {present_hosts} hosts, "
            f"{len(drift)} drifted ({status})"
        )
        return 1 if drift or missing else 0

    for d in drift:
        print(f"synced {d}")
    print(
        f"user-skills: {copied} copies written across {present_hosts} home hosts "
        f"({len(canonical)} skills)"
    )
    return 1 if missing else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report only; never write")
    ap.add_argument("--list", action="store_true", help="list hosts and exit")
    args = ap.parse_args()

    if args.list:
        canon, _ = collect_canonical()
        print(f"canonical: {len(canon)} skills ({', '.join(sorted(canon))})")
        print()
        for host in HOST_DIRS:
            root = HOME / host / "skills"
            n = len([d for d in root.iterdir() if d.is_dir()]) if root.is_dir() else 0
            inst = "yes" if root.parent.exists() else "no "
            print(f"  {host:<22} installed={inst} skills={n}")
        return 0

    return sync(check=args.check)


if __name__ == "__main__":
    sys.exit(main())
