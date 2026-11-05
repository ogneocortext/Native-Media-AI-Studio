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

    Returns a tuple of (is_relevant, reason) for better AI agent reporting.
    """
    if not changed:
        return True, "no changed files specified - running all gates"

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
        is_relevant = text_any or docs_any or config_any
        reason = "relevant to text/docs/config changes" if is_relevant else "no text/docs/config files changed"
        return is_relevant, reason
    if name == "ruff":
        # Python lint: relevant whenever a Python file changed (backend or
        # tools; frontend has no .py).
        is_relevant = py_changed
        reason = "relevant to Python file changes" if is_relevant else "no Python files changed"
        return is_relevant, reason
    if name == "arch":
        is_relevant = backend_app
        reason = "relevant to backend app changes" if is_relevant else "no backend app changes"
        return is_relevant, reason
    if name == "routes":
        is_relevant = any(f.startswith("packages/backend/app/api/") and f.endswith(".py")
                          for f in changed)
        reason = "relevant to backend API changes" if is_relevant else "no backend API changes"
        return is_relevant, reason
    if name == "glsl":
        # GLSL compile-check: relevant when frontend shader source changes
        # (new/modified embedded GLSL) or the checker itself changes.
        is_relevant = (ts_changed and frontend_src) or \
            any(f == "tools/check-glsl-compile.py" for f in changed)
        reason = "relevant to frontend shader changes" if is_relevant else "no frontend shader changes"
        return is_relevant, reason
    if name == "pytest":
        is_relevant = backend_any
        reason = "relevant to backend changes" if is_relevant else "no backend changes"
        return is_relevant, reason
    if name == "tools-pytest":
        is_relevant = tools_tests or tools_py
        reason = "relevant to tools changes" if is_relevant else "no tools changes"
        return is_relevant, reason
    if name in ("type", "lint"):
        is_relevant = ts_changed and frontend_src
        reason = "relevant to frontend TypeScript changes" if is_relevant else "no frontend TypeScript changes"
        return is_relevant, reason
    if name == "unit":
        is_relevant = ts_changed and (frontend_src or frontend_test or frontend_root)
        reason = "relevant to frontend test changes" if is_relevant else "no frontend test changes"
        return is_relevant, reason
    if name == "build":
        is_relevant = frontend_src or frontend_root
        reason = "relevant to frontend source changes" if is_relevant else "no frontend source changes"
        return is_relevant, reason
    if name == "e2e":
        is_relevant = frontend_src
        reason = "relevant to frontend source changes" if is_relevant else "no frontend source changes"
        return is_relevant, reason
    return True, "gate not specifically scoped"


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
