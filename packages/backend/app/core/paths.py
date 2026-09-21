"""
Path-safety helpers.

Consolidates the ``is_relative_to`` containment checks previously
copy-pasted across ``api/outputs.py`` (9 sites), ``core/comfyui_client.py``
(``safe_join``), ``services/comfyui_manager.py`` and
``api/integrations_generation.py``.
"""

from __future__ import annotations

from pathlib import Path


def is_within(base_dir: Path, path: Path) -> bool:
    """True when ``path`` resolves inside ``base_dir`` (no ``../`` escape)."""
    try:
        return path.resolve().is_relative_to(base_dir.resolve())
    except (OSError, ValueError):
        return False


def resolve_within(base_dir: Path, *parts: str) -> Path:
    """Join ``parts`` onto ``base_dir``; raise ``ValueError`` on escape.

    Use for user- or model-supplied relative paths (output serving,
    bulk delete, ComfyUI filenames).
    """
    full = (base_dir / Path(*parts)).resolve() if parts else base_dir.resolve()
    if not full.is_relative_to(base_dir.resolve()):
        raise ValueError(f"Path escapes base dir {base_dir}: {parts!r}")
    return full


def sanitize_filename(filename: str) -> str:
    """Strip path components; raise ``ValueError`` on empty/dot-only names."""
    safe = Path(str(filename).replace("\\", "/")).name
    if not safe or safe in {".", ".."}:
        raise ValueError(f"Invalid filename: {filename!r}")
    return safe


def sanitize_subfolder(subfolder: str | None) -> str:
    """Normalize a subfolder, dropping ``.``/``..``/empty segments."""
    return "/".join(
        p
        for p in str(subfolder or "").replace("\\", "/").split("/")
        if p not in ("", ".", "..")
    )
