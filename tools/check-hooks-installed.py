"""Report whether Orion's managed git hooks are installed and current.

The hooks in ``scripts/git-hooks/`` are the only automated guard in a repo
without CI (D10), but ``.git/hooks/`` is not tracked, so a fresh clone - or a
``.git`` directory rebuilt by any tooling - silently runs with no commit-msg,
pre-commit or pre-push checks at all. That failure made real trouble on
2026-10-22: this machine's clone had no ``commit-msg``, so a trailerless
commit entered the batch and only surfaced at a manual ``--check``.

This checker is report-only: it exits 0 by design (hooks are environment
state, not repo content, and scratch clones used for hook E2E tests must be
able to fail this check without failing a gate). Wire it into check-all as a
report-only check; run it directly to see the live state, or after pulling
changes to ``scripts/git-hooks/``.

Run:  python tools/check-hooks-installed.py
Exit 0 always; findings are printed as [OK] / [MISSING] / [DIFFERS] lines and
also returned by ``--json``.
"""

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HOOKS = ("commit-msg", "pre-commit", "pre-push")


def _compare(src: str, dest: str) -> str:
    if not os.path.exists(dest):
        return "MISSING"
    try:
        with open(src, "rb") as f:
            canonical = f.read()
        with open(dest, "rb") as f:
            installed = f.read()
    except OSError:
        return "DIFFERS"
    if canonical != installed:
        return "DIFFERS"
    return "OK"


def _state():
    src_dir = os.path.join(ROOT, "scripts", "git-hooks")
    hooks_dir = os.path.join(ROOT, ".git", "hooks")
    rows = []
    for name in HOOKS:
        src = os.path.join(src_dir, name)
        if not os.path.exists(src):
            rows.append({"hook": name, "state": "NO-CANONICAL",
                         "detail": f"scripts/git-hooks/{name} missing from the repo"})
            continue
        dest = os.path.join(hooks_dir, name)
        state = _compare(src, dest)
        rows.append({"hook": name, "state": state,
                     "detail": "install with "
                               "`\"C:\\Program Files\\Git\\bin\\bash.exe\" "
                               "scripts/install-git-hooks.sh` (bare `bash` is "
                               "the WSL launcher on this machine)"})
    return rows


def _json():
    rows = _state()
    unmanaged = []
    hooks_dir = os.path.join(ROOT, ".git", "hooks")
    if os.path.isdir(hooks_dir):
        for name in os.listdir(hooks_dir):
            path = os.path.join(hooks_dir, name)
            if not os.path.isfile(path) or name.endswith((".sample", ".backup")):
                continue
            if name not in HOOKS:
                unmanaged.append(name)
    return {"hooks": rows, "unmanaged": unmanaged,
            "trouble": any(r["state"] in ("MISSING", "DIFFERS") for r in rows)}


def main():
    parser = argparse.ArgumentParser(
        prog="check-hooks-installed.py",
        description="Report whether the managed git hooks in scripts/git-hooks/ "
                    "are installed in .git/hooks and byte-identical (report-only).",
    )
    parser.add_argument("--json", action="store_true",
                        help="machine-readable JSON report")
    args = parser.parse_args()

    report = _json()
    for row in report["hooks"]:
        mark = {"OK": "[OK]", "MISSING": "[MISSING]", "DIFFERS": "[DIFFERS]",
                "NO-CANONICAL": "[NO-CANONICAL]"}[row["state"]]
        if row["state"] == "OK":
            print(f"{mark:<12} {row['hook']}")
        else:
            print(f"{mark:<12} {row['hook']:<12} {row['detail']}")
    if report["unmanaged"]:
        print("[INFO] unmanaged hooks present (left alone, listed for "
              f"visibility): {' '.join(report['unmanaged'])}")

    if args.json:
        print(json.dumps(report, indent=2))

    # Report-only by design: a MISSING/DIFFERS row must not fail the docs gate
    # (scratch clones legitimately have no hooks - see the module docstring).
    return 0


if __name__ == "__main__":
    sys.exit(main())
