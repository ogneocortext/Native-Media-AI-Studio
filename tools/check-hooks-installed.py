"""Report whether the repo's guard hooks are installed and current.

Two guard families protect this repo, and both are environment state that
``.git`` or a config edit can silently drop:

1. The managed git hooks in ``scripts/git-hooks/`` (commit-msg, pre-commit,
   pre-push). ``.git/hooks/`` is not tracked, so a fresh clone - or a ``.git``
   directory rebuilt by any tooling - runs with no commit-msg, pre-commit or
   pre-push checks at all. That failure made real trouble on 2026-10-22: this
   machine's clone had no ``commit-msg``, so a trailerless commit entered the
   batch and only surfaced at a manual ``--check``.
2. The PreToolUse exec guard (``tools/hooks/check-exec-command.py``), which
   enforces the pwsh escaping rules in docs/powershell-command-sheet.md
   section 0. It only runs if a client config invokes it; a bad edit to
   ``.claude/settings.json`` or ``.devin/hooks.v1.json`` disables it with no
   error, so the registration is reported here too.

This checker is report-only: it exits 0 by design (guard state is environment
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
import pathlib
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HOOKS = ("commit-msg", "pre-commit", "pre-push")

# The exec guard is invoked by path from a client config. The Devin config is
# gitignored (.devin/*), so it is legitimately absent on a fresh clone and is
# reported as ABSENT rather than MISSING; the Claude config is tracked.
EXEC_GUARD_REL = "tools/hooks/check-exec-command.py"
EXEC_GUARD_CONFIGS = (".claude/settings.json", ".devin/hooks.v1.json")


def _compare(src: str, dest: str) -> str:
    if not os.path.exists(dest):
        return "MISSING"
    try:
        canonical = pathlib.Path(src).read_bytes()
        installed = pathlib.Path(dest).read_bytes()
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


def _exec_guard_rows():
    """Registration state for the PreToolUse exec guard, per client config."""
    rows = []
    for cfg in EXEC_GUARD_CONFIGS:
        path = os.path.join(ROOT, *cfg.split("/"))
        if not os.path.exists(path):
            # The Devin config is gitignored; absence there is environment
            # state, not a broken registration.
            state = "ABSENT" if cfg.startswith(".devin/") else "MISSING"
            rows.append({"config": cfg, "state": state,
                         "detail": "registration file not present"})
            continue
        try:
            text = pathlib.Path(path).read_text(encoding="utf-8")
        except OSError:
            rows.append({"config": cfg, "state": "DIFFERS",
                         "detail": "could not read registration file"})
            continue
        if EXEC_GUARD_REL in text.replace("\\", "/"):
            rows.append({"config": cfg, "state": "OK",
                         "detail": f"invokes {EXEC_GUARD_REL}"})
        else:
            rows.append({"config": cfg, "state": "STALE",
                         "detail": f"does not invoke {EXEC_GUARD_REL}"})
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
    exec_guard = _exec_guard_rows()
    return {"hooks": rows, "unmanaged": unmanaged, "exec_guard": exec_guard,
            "trouble": any(r["state"] in ("MISSING", "DIFFERS", "STALE")
                           for r in rows + exec_guard)}


def main():
    parser = argparse.ArgumentParser(
        prog="check-hooks-installed.py",
        description="Report whether the managed git hooks in scripts/git-hooks/ "
                    "are installed in .git/hooks and byte-identical, and whether "
                    "the PreToolUse exec guard is registered (report-only).",
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

    exec_marks = {"OK": "[OK]", "MISSING": "[MISSING]", "DIFFERS": "[DIFFERS]",
                  "STALE": "[STALE]", "ABSENT": "[ABSENT]"}
    for row in report["exec_guard"]:
        mark = exec_marks[row["state"]]
        if row["state"] == "OK":
            print(f"{mark:<12} exec-guard: {row['config']}")
        else:
            print(f"{mark:<12} exec-guard: {row['config']:<24} {row['detail']}")

    if args.json:
        print(json.dumps(report, indent=2))

    # Report-only by design: a MISSING/DIFFERS row must not fail the docs gate
    # (scratch clones legitimately have no hooks - see the module docstring).
    return 0


if __name__ == "__main__":
    sys.exit(main())
