"""Shared path utilities for Native Media AI Studio tools.

Eliminates hard-coded absolute paths by deriving all paths from this module's
location. Import this in any tool script instead of computing paths manually.
"""

import sys
from pathlib import Path

# tools/lib/paths.py -> tools/ -> repo root
TOOLS_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = TOOLS_DIR.parent

# Standard output/data directories (all under repo root)
OUTPUT_DIR = PROJECT_ROOT / "output"
CONFIG_DIR = PROJECT_ROOT / "config"
STORAGE_DIR = PROJECT_ROOT / "storage"
BACKEND_DIR = PROJECT_ROOT / "packages" / "backend"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"


def project_root() -> Path:
    """Return the monorepo root directory."""
    return PROJECT_ROOT


def backend_dir() -> Path:
    """Return the backend package directory."""
    return BACKEND_DIR


def output_dir(sub: str = "") -> Path:
    """Return an output sub-directory, creating it if needed.

    Args:
        sub: Sub-directory name (e.g. 'midi', 'beat_data', 'batch').

    Returns:
        Path to the requested output directory.
    """
    p = OUTPUT_DIR / sub if sub else OUTPUT_DIR
    p.mkdir(parents=True, exist_ok=True)
    return p


def storage_dir() -> Path:
    """Return the storage directory (for databases, caches, etc.)."""
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    return STORAGE_DIR


def tools_lib_dir() -> Path:
    """Return this tools/lib directory (for sibling helper modules)."""
    return Path(__file__).resolve().parent


def add_backend_to_path() -> None:
    """Ensure the backend package and tools root are importable from a tools script.

    Tools are run as standalone scripts (``python tools/foo.py``), so the
    backend package is not automatically on ``sys.path``. Call this once at
    module top level to import ``app.*`` modules without a package install.
    """
    backend = str(backend_dir())
    if backend not in sys.path:
        sys.path.insert(0, backend)
    tools_root = str(project_root())
    if tools_root not in sys.path:
        sys.path.insert(0, tools_root)
