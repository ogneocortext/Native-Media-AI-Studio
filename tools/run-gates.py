# ruff: noqa: N999
"""Run every quality gate for the repository in one command.

Thin CLI entry point: all logic lives in the ``tools.gates`` package
(interpreter, gates, executor, selection, timing, output, cli). This file
exists only so the pre-push hook and callers can keep invoking
``python tools/run-gates.py`` unchanged.

When run as a script (``python tools/run-gates.py``) rather than as a module
(``python -m tools.run-gates``), relative imports are unavailable, so the
tools directory is added to sys.path and the gates package is imported
absolutely.

Each gate is a separate tool with a separate working directory, and on Windows
none of them can be trusted through the PowerShell `.ps1` wrappers: `pnpm`
reports exit 1 while passing, and a non-zero exit from one gate tells you
nothing about whether a later one ran. This runner owns that problem once,
here, so neither a person nor an agent has to hand-assemble a pipeline of
temp scripts (the `subprocess` calls must also decode explicitly as UTF-8 —
Python decodes pipes with the ANSI code page otherwise and dies on em dashes).

Gates, cheapest-first so a fast failure surfaces early:

  docs      check-all.py (8 required checkers; report-only ones behind -v)
  ruff      repo lint                          repo
  arch      import cycles / layer inversions   repo
  routes    duplicate route handlers           repo
  type      tsc -b + test config               packages/frontend
  lint      eslint                            packages/frontend
  unit      vitest (pure logic)                packages/frontend
  pytest    backend suite                      packages/backend
  tools-pytest  tools' own unit tests          tools
  build     vite build                         packages/frontend
  e2e       Playwright (opt-in, --e2e)        packages/frontend

Execution is two concurrent *lanes*, not one serial chain: the Python-only
gates (docs, ruff, arch, routes, pytest, tools-pytest) and the Node-only
gates (type, lint, unit, build, e2e) share no resources, and the streaming
output is already prefixed per gate (`[name]`), so interleaving is readable.
Within a lane gates stay serial: vitest, the Playwright server and pytest
each assume they own their working tree, and cross-lane port/file-lock
collisions are the failure mode this avoids. Wall time is bounded by the
slower lane instead of the sum of every gate. `--serial` reverts to the
old one-lane-at-a-time behavior.

Exit 0 = all selected gates passed, 1 = at least one failed.
The e2e gate is opt-in because it starts a Vite dev server and needs a browser.
"""

import os
import sys

from gates.cli import main

# Allow running as a script: add the tools directory to sys.path so the
# gates package can be imported absolutely regardless of invocation style.
_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)

if __name__ == "__main__":
    sys.exit(main())
