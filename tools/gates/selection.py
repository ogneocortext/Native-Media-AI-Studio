"""Gate selection and changed-file filtering.

Decides which gates are relevant to a set of changed file names, and
selects gates from the table according to --only / --e2e / --group flags.
"""


from .gates import ROOT, Gate


def changed_from_git() -> set[str] | None:
    """Return the set of changed file names in the unpushed commit batch
    (``git diff --name-only @{upstream}..HEAD``), or ``None`` if it cannot
    be determined (no upstream, git error).

    Uses ``@{upstream}`` instead of a hardcoded ``origin/main..HEAD`` so
    it works regardless of the default branch name (main, master, ...) and
    does not require the ``origin`` remote to exist.
    """
    import subprocess

    try:
        out = subprocess.run(
            ["git", "diff", "--name-only", "@{upstream}..HEAD"],
            cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    files = [f for f in out.stdout.splitlines() if f.strip()]
    return set(files)


def gate_relevant(gate: Gate, changed: set[str]) -> bool:
    """Return True if ``gate`` could be affected by changed file names.

    With no changed files known, every gate runs (conservative default).
    A gate is skipped only when ``changed`` is non-empty and no changed
    file matches anything the gate touches. All checks are read-only scans,
    so a gate cannot surface a new violation in a file it does not touch.
    """
    if not changed:
        return True

    py_changed = any(f.endswith(".py") for f in changed)
    ts_changed = any(f.lower().endswith((".ts", ".tsx")) for f in changed)
    frontend_src = any(f.startswith("packages/frontend/src/") for f in changed)
    frontend_test = any(f.startswith("packages/frontend/tests/") for f in changed)
    frontend_root = any(
        f.startswith("packages/frontend/")
        and not f.startswith("packages/frontend/src/")
        and not f.startswith("packages/frontend/tests/")
        for f in changed
    )
    backend_app = any(f.startswith("packages/backend/app/") and f.endswith(".py")
                      for f in changed)
    backend_any = any(f.startswith("packages/backend/") for f in changed)
    tools_py = any(f.startswith("tools/") and f.endswith(".py") for f in changed)
    tools_tests = any(f.startswith("tools/tests/") for f in changed)
    docs_any = any(f.startswith("docs/") or f == "AGENTS.md" for f in changed)
    text_any = any(
        f.lower().endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py",
                            ".md", ".json", ".yaml", ".yml", ".toml", ".ps1",
                            ".sh", ".css", ".html", ".txt", ".cfg", ".ini"))
        for f in changed
    )
    config_any = any(f.startswith("config/") for f in changed)

    name = gate.name
    if name == "docs":
        # check-all.py scopes its own checks internally via --changed; the
        # docs gate itself is relevant when any text/code/config/docs file
        # changed.
        return text_any or docs_any or config_any
    if name == "ruff":
        # Python lint: relevant whenever a Python file changed (backend or
        # tools; frontend has no .py).
        return py_changed
    if name == "arch":
        return backend_app
    if name == "routes":
        return any(f.startswith("packages/backend/app/api/") and f.endswith(".py")
                   for f in changed)
    if name == "glsl":
        # GLSL compile-check: relevant when frontend shader source changes
        # (new/modified embedded GLSL) or the checker itself changes.
        return (ts_changed and frontend_src) or \
            any(f == "tools/check-glsl-compile.py" for f in changed)
    if name == "pytest":
        return backend_any
    if name == "tools-pytest":
        return tools_tests or tools_py
    if name in ("type", "lint"):
        return ts_changed and frontend_src
    if name == "unit":
        return ts_changed and (frontend_src or frontend_test or frontend_root)
    if name == "build":
        return frontend_src or frontend_root
    if name == "e2e":
        return frontend_src
    return True


def select_gates(all_gates: list[Gate], only: list[str] | None,
                 *, include_e2e: bool = False) -> list[Gate]:
    """The gates to run, applying --only and the opt-in rule.

    A name matches by exact equality or as a substring, so ``--only py`` runs
    pytest — *and* tools-pytest, because the substring sits inside that name
    too: ``--only py`` is the cheap way to run every backend suite. Naming a
    gate exactly (``--only pytest``) is the precise form. An optional gate is
    skipped unless --e2e is given OR it is named explicitly in --only —
    naming it is itself the opt-in, so ``--only e2e`` runs the browser suite
    instead of silently selecting nothing.
    """
    def matches(gate: Gate, names: list[str]) -> bool:
        return any(
            n.lower() == gate.name.lower() or n.lower() in gate.name.lower()
            for n in names
        )

    selected = []
    for g in all_gates:
        if only and not matches(g, only):
            continue
        if g.optional and not include_e2e and not (only and matches(g, only)):
            continue
        selected.append(g)
    return selected
