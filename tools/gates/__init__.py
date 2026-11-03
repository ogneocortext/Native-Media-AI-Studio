"""Tools quality-gate runner, decomposed into focused modules.

Public surface:
    interpreter   - Python/pnpm interpreter resolution and probing
    gates         - Gate class and gate table definition
    executor      - gate execution engine (run_gate, lanes, timeouts)
    selection     - gate selection, changed-file filtering
    timing        - timing history and regression detection
    output        - ANSI stripping, output tail formatting
    cli           - argument parser and main entry point

run-gates.py remains as a thin CLI entry point that imports from here.
"""

from . import cli, executor, gates, interpreter, output, selection, timing

__all__ = ["cli", "executor", "gates", "interpreter", "output", "selection", "timing"]
