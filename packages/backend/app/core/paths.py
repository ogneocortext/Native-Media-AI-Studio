"""
Path-safety helpers.

Consolidates the ``is_relative_to`` containment checks previously
copy-pasted across ``api/outputs.py`` (9 sites), ``core/comfyui_client.py``
(``safe_join``), ``services/comfyui_manager.py`` and
``api/integrations_generation.py``.

Also the single source of truth for ComfyUI directory layout
(install root, ``input`` / ``output`` / ``models``), replacing the
``PROJECT_ROOT.parent / "ComfyUI"`` literals (and machine-specific absolute
paths) previously scattered across ``api/outputs.py``,
``services/upscale_service.py``, ``services/gen3d/gen3d_service.py``,
``core/comfyui_client.py``, ``core/logging_config.py`` and
``services/comfyui_manager.py``.
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


# ---------------------------------------------------------------------------
# ComfyUI directory layout
# ---------------------------------------------------------------------------

def comfyui_dir() -> Path:
    """Return the ComfyUI install root.

    Resolution order:
    1. Derived from ``config.comfyui_output_dir`` when it points inside a
       recognizable install (``<root>/output`` → ``<root>``), validated by
       the presence of ``main.py``.
    2. ``<repo root>/../ComfyUI`` (the standard sibling checkout).
    """
    from .config import PROJECT_ROOT, config

    out = getattr(config, "comfyui_output_dir", None)
    if out:
        candidate = Path(out)
        if candidate.name.lower() == "output":
            candidate = candidate.parent
        if candidate.exists() and (candidate / "main.py").exists():
            return candidate
    return PROJECT_ROOT.parent / "ComfyUI"


def comfyui_output_dir() -> Path:
    """Return ComfyUI's output dir (explicit config wins, else ``<root>/output``)."""
    from .config import config

    out = getattr(config, "comfyui_output_dir", None)
    if out:
        return Path(out)
    return comfyui_dir() / "output"


def comfyui_input_dir() -> Path:
    """Return ComfyUI's input dir (``<root>/input``)."""
    return comfyui_dir() / "input"


def comfyui_models_dir(*parts: str) -> Path:
    """Return ``ComfyUI/models[/...]`` with optional subpath parts."""
    base = comfyui_dir() / "models"
    return base.joinpath(*parts) if parts else base
