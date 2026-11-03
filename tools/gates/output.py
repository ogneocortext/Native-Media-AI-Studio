"""Output formatting utilities for the gate runner.

Handles ANSI escape sequence stripping and output tail truncation for
JSON reports. These are pure functions with no gate-state dependencies.
"""

import re

# ANSI escape sequences (SGR colours, cursor moves) as emitted by vitest and
# pytest. Stripped from the streamed copy only: the raw text is kept for the
# JSON report, where escape codes would just be noise for a JSON consumer.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")


def strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences from ``text``."""
    return _ANSI_RE.sub("", text)


def tail(text: str, limit: int = 8000) -> str:
    """Return the end of ``text``, truncated to ``limit`` characters.

    Keeps the tail (where the error usually is) and stays bounded, so a
    runaway gate that prints megabytes cannot bloat the report or CI log.
    """
    if len(text) <= limit:
        return text
    return "...(truncated)...\n" + text[-limit:]
