# ruff: noqa: N999
"""Mirror .claude/skills/ (canonical) into every agent host's skill dir.

`.claude/skills/` is the tracked canonical set. Each host reads its own
directory, so a skill added to canonical is invisible to every other host until
it is copied across:

  .claude/skills  ->  .kilo/skills   (Kilo)
                    .devin/skills  (Devin)
                    .agents/skills (Cline and others)

`.cline/skills` is a junction onto `.kilo/skills`, so it follows automatically
and is deliberately not a copy target.

`packages/frontend/{.claude,.agents,agent}/skills` carry a deliberate SUBSET
(the Remotion skills) so an agent launched inside the frontend package sees the
same instructions as one at the repo root. By default those get the canonical
bytes only for skills they already carry; pass --with-frontend to add new ones.

Run:
  python tools/sync-skill-mirrors.py            # sync all mirrors
  python tools/sync-skill-mirrors.py --check    # report drift, change nothing
  python tools/sync-skill-mirrors.py --with-frontend

`tools/check-skill-mirrors.py` (docs gate) fails if the result is not
byte-identical, so this is safe to run before every commit.
"""

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / ".claude" / "skills"
MIRRORS = [ROOT / ".kilo" / "skills", ROOT / ".devin" / "skills", ROOT / ".agents" / "skills"]
FRONTEND = [
    ROOT / "packages" / "frontend" / ".claude" / "skills",
    ROOT / "packages" / "frontend" / ".agents" / "skills",
    ROOT / "packages" / "frontend" / "agent" / "skills",
]


def differs(a: Path, b: Path) -> bool:
    """True when two skill directories are not byte-identical."""
    fa = {p.relative_to(a).as_posix(): p for p in a.rglob("*") if p.is_file()}
    fb = {p.relative_to(b).as_posix(): p for p in b.rglob("*") if p.is_file()}
    if set(fa) != set(fb):
        return True
    return any(fa[r].read_bytes() != fb[r].read_bytes() for r in fa)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report only; never write")
    ap.add_argument("--with-frontend", action="store_true",
                    help="also add skills the frontend subset does not carry yet")
    args = ap.parse_args()

    skills = sorted(p.name for p in CANON.iterdir() if p.is_dir())
    if not skills:
        print("FAIL: .claude/skills/ has no skill directories")
        return 1

    drift, copied = [], 0
    targets = [(m, skills) for m in MIRRORS]
    if args.with_frontend:
        targets += [(f, skills) for f in FRONTEND]
    else:
        for f in FRONTEND:
            if f.is_dir():
                targets.append((f, sorted(p.name for p in f.iterdir() if p.is_dir())))

    for target, names in targets:
        if not target.is_dir():
            drift.append(f"{target.relative_to(ROOT).as_posix()}: mirror root absent")
            continue
        for name in names:
            src = CANON / name
            dst = target / name
            if not src.is_dir():
                continue
            if dst.is_symlink():
                continue  # junctions follow their target; nothing to copy
            if not dst.is_dir() or differs(src, dst):
                drift.append(f"{target.relative_to(ROOT).as_posix()}/{name}")
                if not args.check:
                    if dst.exists():
                        shutil.rmtree(dst)
                    shutil.copytree(src, dst)
                    copied += 1

    if args.check:
        for d in drift:
            print(f"DRIFT {d}")
        print(f"{len(drift)} drifted skill copies" if drift else "all mirrors in sync")
        return 1 if drift else 0

    for d in drift:
        print(f"synced {d}")
    print(f"{copied} copies written across {len(targets)} targets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
