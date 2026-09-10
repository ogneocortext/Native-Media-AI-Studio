"""
Shared filesystem utilities for the backend.

Provides small helpers for common file operations so callers do not
repeat ``Path.mkdir(parents=True, exist_ok=True)`` + ``open()``
patterns across the codebase.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def ensure_dir(path: Path | str) -> Path:
    """Create *path* if it does not exist, returning the resolved Path."""
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def read_json(path: Path | str, default: Any = None) -> Any:
    """Read a JSON file, returning *default* when the file is missing or invalid."""
    p = Path(path)
    if not p.exists():
        return default
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path: Path | str, data: Any, indent: int = 2) -> Path:
    """Write *data* as JSON to *path*, creating parent dirs automatically."""
    p = ensure_dir(Path(path).parent) / Path(path).name
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=indent)
        f.write("\n")
    return p
