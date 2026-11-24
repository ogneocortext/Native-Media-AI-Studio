"""
Office API -- serves Maya's Office page config from a server-side JSON file.

The config lives in ``config/office.json`` (same directory as ``logging.json``)
and is read fresh on every GET -- no in-memory caching -- so external edits
appear immediately without a backend restart. PUT persists atomically (temp
file + os.replace) with full validation.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from ..core.config import CONFIG_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/office", tags=["Office"])

OFFICE_CONFIG_PATH = CONFIG_DIR / "office.json"

_SEED: dict[str, str] = {
    "greeting": "Welcome to my office.",
    "currently": "My voice came home tonight. Pocket speaks for me now, and Nate's ear approved.",
    "featured_plate": "/maya-avatar.webp",
    "accent": "#6A4C98",
}

_HEX_COLOR_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

_MAX_GREETING_LEN = 500
_MAX_CURRENTLY_LEN = 500
_MAX_FEATURED_PLATE_LEN = 300


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _read_config_file() -> dict[str, Any] | None:
    """Read office.json fresh from disk. Returns None if missing, dict if valid."""
    try:
        with open(OFFICE_CONFIG_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"office config is invalid JSON: {exc}",
        ) from exc
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=500,
            detail="office config must be a JSON object",
        )
    return data


def _validate_config(data: Any, *, require_all: bool = True) -> dict[str, str]:
    """Validate config fields. Returns the validated dict.

    ``require_all=True``: all four fields must be present (PUT).
    ``require_all=False``: only validate fields that are present (defensive GET).
    """
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="config must be a JSON object")

    out: dict[str, str] = {}
    for field in ("greeting", "currently", "featured_plate", "accent"):
        if require_all and field not in data:
            raise HTTPException(
                status_code=422,
                detail=f"missing required field: {field}",
            )
        if field not in data:
            continue
        value = data[field]
        if not isinstance(value, str):
            raise HTTPException(
                status_code=422,
                detail=f"field '{field}' must be a string",
            )

    if "greeting" in data:
        g = data["greeting"]
        if not g.strip():
            raise HTTPException(status_code=422, detail="greeting must not be empty")
        if len(g) > _MAX_GREETING_LEN:
            raise HTTPException(
                status_code=422,
                detail=f"greeting must be at most {_MAX_GREETING_LEN} characters",
            )
        out["greeting"] = g

    if "currently" in data:
        c = data["currently"]
        if not c.strip():
            raise HTTPException(status_code=422, detail="currently must not be empty")
        if len(c) > _MAX_CURRENTLY_LEN:
            raise HTTPException(
                status_code=422,
                detail=f"currently must be at most {_MAX_CURRENTLY_LEN} characters",
            )
        out["currently"] = c

    if "featured_plate" in data:
        fp = data["featured_plate"]
        if len(fp) > _MAX_FEATURED_PLATE_LEN:
            raise HTTPException(
                status_code=422,
                detail=f"featured_plate must be at most {_MAX_FEATURED_PLATE_LEN} characters",
            )
        out["featured_plate"] = fp

    if "accent" in data:
        a = data["accent"]
        if not _HEX_COLOR_RE.match(a):
            raise HTTPException(
                status_code=422,
                detail="accent must be a hex color (#RGB or #RRGGBB)",
            )
        out["accent"] = a

    return out


def _write_config_atomic(data: dict[str, str]) -> None:
    """Write config atomically: temp file in same dir, then os.replace."""
    OFFICE_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(OFFICE_CONFIG_PATH.parent),
        prefix=".office-",
        suffix=".json",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
            fh.write("\n")
        os.replace(tmp_path, OFFICE_CONFIG_PATH)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


@router.get("/config", response_model=dict)
async def get_office_config() -> dict[str, Any]:
    """Return the office config with server-managed updated_at.

    If the file is missing, create it from the seed and return the seed
    (updated_at: null). If the file exists but is invalid JSON, return 500.
    """
    data = _read_config_file()
    if data is None:
        # File missing: seed it and return seed with updated_at: null.
        _write_config_atomic(dict(_SEED))
        return {**_SEED, "updated_at": None}

    out: dict[str, Any] = {}
    for field in ("greeting", "currently", "featured_plate", "accent"):
        value = data.get(field)
        if isinstance(value, str):
            out[field] = value
        else:
            # Missing or non-string field: fall back to seed value.
            out[field] = _SEED[field]

    out["updated_at"] = data.get("updated_at")
    if not isinstance(out["updated_at"], str):
        out["updated_at"] = None
    return out


@router.put("/config", response_model=dict)
async def put_office_config(payload: dict[str, Any]) -> dict[str, Any]:
    """Replace the office config with validated input.

    Returns the stored config with an added server-set ``updated_at``
    (ISO 8601 UTC). On invalid input: 422, file untouched.
    """
    # Strip any client-supplied updated_at -- it is server-managed only.
    payload = {k: v for k, v in payload.items() if k != "updated_at"}
    validated = _validate_config(payload, require_all=True)

    validated["updated_at"] = _now_iso()
    _write_config_atomic(validated)
    return dict(validated)
