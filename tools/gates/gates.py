"""Gate class and gate table definition.

Defines the :class:`Gate` dataclass-like container and the :func:`gates`
table (cheapest-first within each of two concurrent lanes: python | node).
"""

from dataclasses import dataclass, field
from pathlib import Path

# Repository root paths.
ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND = ROOT / "packages" / "backend"
FRONTEND = ROOT / "packages" / "frontend"
TOOLS = ROOT / "tools"

# Sentinels standing in for the lazily-resolved tools in gate argvs.
# Gates are declared before (and whether or not) the tools are resolved:
# `--only unit` must not cost a Python resolution, so argvs that would need
# an interpreter are only materialised when their lane actually runs.
# PY -> resolved backend interpreter, PNPM -> resolved pnpm shim.
PY = "__PY__LACEHOLDER__"
PNPM = "__PNPM__PLACEHOLDER__"


@dataclass
class Gate:
    """A single quality gate with its command, working directory, and policy.

    Two concurrently-executed lanes:
      - py:   docs, ruff, arch, routes, pytest, tools-pytest
      - node: type, lint, unit, build, e2e

    `unit` intentionally runs before `build` in its lane: a vitest
    failure should not be discovered after a full 600 s vite build.
    `tsc -b` runs in both the type and build gates (package.json) but
    TS incremental state makes the second one cheap.
    With --fix, ruff and eslint self-correct in place before reporting.
    """

    name: str
    argv: list
    cwd: Path
    optional: bool = False
    timeout: int = 300
    lane: str = "py"
    desc: str = field(default="")


def gates(*, fix: bool = False, verbose: bool = False) -> list[Gate]:
    """The gate table, cheapest-first within each lane."""
    docs_extra = ["-v"] if verbose else []
    ruff_argv = ([PY, "-m", "ruff", "check", ".", "--output-format=concise"]
                 + (["--fix"] if fix else []))
    lint_argv = ([PNPM, "exec", "eslint", "--format=stylish", "--fix", "src"] if fix
                 else [PNPM, "exec", "eslint", "--format=stylish", "src"])
    return [
        Gate("docs", [PY, "tools/check-all.py"] + docs_extra, ROOT,
             desc="documentation and repo hygiene (7 checks via check-all.py)"),
        Gate("ruff", ruff_argv, ROOT,
             desc="Python lint with ruff (imports, style, bugs)"),
        Gate("arch", [PY, "tools/check-import-cycles.py"], ROOT,
             desc="backend import cycles and layer inversions (api->services->adapters)"),
        Gate("routes", [PY, "tools/check-duplicate-routes.py"], ROOT,
             desc="duplicate FastAPI route handlers (shadowing detection)"),
        Gate("glsl", [PY, "tools/check-glsl-compile.py"], ROOT,
             desc="GLSL compile-check for embedded frontend shaders "
                  "(glslangValidator, GLSL ES 1.00)"),
        Gate("type", [PNPM, "type-check"], FRONTEND, lane="node",
             desc="TypeScript type check (tsc --noEmit + test config)"),
        Gate("lint", lint_argv, FRONTEND, lane="node",
             desc="ESLint on frontend src (--format=stylish; ~60s typical)"),
        # `-v --durations=10` rather than `-q`: the runner streams each line as
        # it is produced, so a verbose reporter is what makes "which test is
        # running right now" visible. `--durations=10` then names the ten
        # slowest tests, which is where optimization effort is most valuable.
        Gate("pytest", [PY, "-m", "pytest", "-v", "--durations=10",
                        "-p", "no:cacheprovider"], BACKEND,
             desc="backend pytest suite"),
        # The tools' own unit tests. The knowledge-library link parser is
        # shared by three tools, and a silent divergence in it is invisible
        # until something reports the wrong number — so it is guarded here.
        # Only `tools/tests/unit` is collected: the rest of tools/tests holds
        # live scripts (MCP stdio, demucs, GPU) that block and are not
        # gate-safe.
        Gate("tools-pytest", [PY, "-m", "pytest", "-v",
                              "-p", "no:cacheprovider", "tests/unit"], TOOLS,
             desc="tools' own unit tests (tests/unit only)"),
        # `--reporter=verbose` names every test file as it runs. The vitest
        # config's default reporter is "dot" under CI, which prints one
        # character per file and no names at all.
        Gate("unit", [PNPM, "exec", "vitest", "run", "--reporter=verbose"],
             FRONTEND, lane="node",
             desc="frontend vitest unit tests (891 tests, 42 files)"),
        Gate("build", [PNPM, "build"], FRONTEND, timeout=600, lane="node",
             desc="Vite production build (Rolldown bundler)"),
        Gate("e2e", [PNPM, "exec", "playwright", "test",
                     "app-shell.spec.ts", "canvas2d.spec.ts",
                     "lrc-visualizer.spec.ts", "--reporter=list"],
             FRONTEND, optional=True, timeout=900, lane="node",
             desc="Playwright E2E (opt-in, --e2e; starts a Vite dev server)"),
    ]
