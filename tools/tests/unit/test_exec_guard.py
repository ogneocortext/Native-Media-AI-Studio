"""Regression tests for the PreToolUse exec guard.

The guard (``tools/hooks/check-exec-command.py``) is the enforcement point for
the pwsh escaping rules in ``docs/powershell-command-sheet.md`` section 0: it
blocks heredocs, foreign shells, unix utilities, multi-line commit/inline
payloads, expandable here-strings, and destructive git. It carries a thorough
adversarial matrix in ``tools/hooks/test-check-exec-command.py``, but that script
was never run by a gate, so a regression in the guard could land unnoticed --
the guard protects every shell command, yet nothing protected the guard.

These tests call the guard's pure ``decide()`` directly (no subprocess, so the
whole matrix runs in milliseconds) and are collected by the ``tools-pytest``
gate. The canonical case list stays in the standalone script so manual runs and
the gate cannot drift apart.

Run:  python -m pytest tools/tests/unit/test_exec_guard.py -v
"""

import importlib.util
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[2]


def _load(path: Path, name: str):
    """Import a (possibly hyphenated) script file by path."""
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard = _load(TOOLS / "hooks" / "check-exec-command.py", "check_exec_command")
cases = _load(TOOLS / "hooks" / "test-check-exec-command.py", "check_exec_command_cases")


@pytest.mark.parametrize("command,expected", cases.CASES)
def test_windows_matrix(command, expected):
    """Every Windows case returns its reason key, or None for a pass."""
    assert guard.decide(command, is_windows=True, destructive_allowed=False) == expected


@pytest.mark.parametrize("command,expected", cases.POSIX_CASES)
def test_posix_matrix(command, expected):
    """On POSIX clones only destructive git is blocked."""
    assert guard.decide(command, is_windows=False, destructive_allowed=False) == expected


def test_empty_command_passes():
    assert guard.decide("", is_windows=True) is None


def test_destructive_override_allows_reset():
    """With .devin/.allow-destructive present, destructive git may run."""
    assert (
        guard.decide("git reset --hard HEAD~1", is_windows=True, destructive_allowed=True) is None
    )
