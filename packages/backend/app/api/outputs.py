"""
Output files API — re-export shim.

The outputs module has been split into focused modules:
- ``outputs_models``   - Pydantic schemas (OutputFile, OutputsResponse, etc.)
- ``outputs_scanner``  - directory scanning, caching, sidecar helpers
- ``outputs_endpoints`` - FastAPI route handlers

This module re-exports the public API surface for backward compatibility.
New code should import directly from the focused modules.
"""

from .outputs_endpoints import router
from .outputs_models import (
    BulkDeleteRequest,
    OutputFile,
    OutputsResponse,
    RenameRequest,
    get_file_type,
)
from .outputs_scanner import (
    _invalidate_cache,
    _scan_with_cache,
    _sidecar_candidates,
    _sidecar_rename_pairs,
    load_sidecar_metadata,
)

__all__ = [
    "router",
    "OutputFile",
    "OutputsResponse",
    "BulkDeleteRequest",
    "RenameRequest",
    "get_file_type",
    "load_sidecar_metadata",
    "_sidecar_candidates",
    "_sidecar_rename_pairs",
    "_scan_with_cache",
    "_invalidate_cache",
]
