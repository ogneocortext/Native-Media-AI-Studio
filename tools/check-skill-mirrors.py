#!/usr/bin/env python3
"""Skill-mirror integrity checker.

`.claude/skills/` is the tracked canonical set; `.kilo/skills/`,
`.devin/skills/`, and `.agents/skills/` are machine-local mirrors that must
equal it exactly (AGENTS.md, "Project skills"). A mirror that drifts — a
missing skill, a byte-different file, a skill canonical never had — means
agents on different tools load different instructions.

For every mirror root this fails on:
  - a canonical skill directory missing from the mirror
  - a mirrored file whose bytes differ from canonical (path reported)
  - a mirror entry (skill dir or stray file) canonical does not have
  - a file inside a mirrored skill that canonical does not have

`__pycache__/` directories and `*.pyc` files are ignored: they are Python
runtime artifacts regenerated whenever a skill's scripts execute, not skill
content.

Exit 0 prints a one-line summary; exit 1 lists every violation.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / ".claude" / "skills"
MIRRORS = [
    ROOT / ".kilo" / "skills",
    ROOT / ".devin" / "skills",
    ROOT / ".agents" / "skills",
]

IGNORED_NAMES = {"__pycache__"}


def skill_files(skill_dir: Path) -> dict[str, Path]:
    """rel-posix-path -> file for every non-artifact file under skill_dir."""
    out = {}
    for p in skill_dir.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(skill_dir).as_posix()
        parts = rel.split("/")
        if any(part in IGNORED_NAMES for part in parts):
            continue
        if rel.endswith(".pyc"):
            continue
        out[rel] = p
    return out


def main() -> int:
    violations = []

    canon_skills = sorted(p.name for p in CANON.iterdir() if p.is_dir())
    if not canon_skills:
        print("FAIL: .claude/skills/ has no skill directories")
        return 1

    canon_files = {s: skill_files(CANON / s) for s in canon_skills}
    canon_rels = {s: set(files) for s, files in canon_files.items()}

    for mirror in MIRRORS:
        rel_root = mirror.relative_to(ROOT).as_posix()
        if not mirror.is_dir():
            for s in canon_skills:
                violations.append(f"{rel_root}: missing skill '{s}' (mirror root absent)")
            continue

        mirror_entries = {p.name for p in mirror.iterdir()}
        for s in canon_skills:
            if s not in mirror_entries:
                violations.append(f"{rel_root}: missing canonical skill '{s}'")
        for name in sorted(mirror_entries - set(canon_skills)):
            violations.append(f"{rel_root}: '{name}' is not a canonical skill")

        for s in canon_skills:
            dst_dir = mirror / s
            if not dst_dir.is_dir():
                continue
            dst_files = skill_files(dst_dir)
            dst_rels = set(dst_files)
            for rel in sorted(canon_rels[s] - dst_rels):
                violations.append(f"{rel_root}/{s}/{rel}: missing in mirror")
            for rel in sorted(dst_rels - canon_rels[s]):
                violations.append(f"{rel_root}/{s}/{rel}: not in canonical")
            for rel in sorted(canon_rels[s] & dst_rels):
                if canon_files[s][rel].read_bytes() != dst_files[rel].read_bytes():
                    violations.append(f"{rel_root}/{s}/{rel}: content differs")

    if violations:
        for v in violations:
            print(f"FAIL {v}")
        print(f"check-skill-mirrors: {len(violations)} violation(s)")
        return 1

    total = sum(len(files) for files in canon_files.values())
    print(
        f"check-skill-mirrors: {len(canon_skills)} canonical skills x "
        f"{len(MIRRORS)} mirrors, {total} files each — all byte-identical"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
