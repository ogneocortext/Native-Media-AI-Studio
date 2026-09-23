"""
Shared ComfyUI HTTP + path helpers.

Consolidation point for logic previously copy-pasted across:
- ``app/adapters/comfyui.py`` (adapter session, sanitize, history/queue/view)
- ``app/api/integrations_generation.py`` (per-request sessions, inline _safe_name,
  history/queue/view blocks in get_result/get_progress/get_preview/view_preview)
- ``app/services/comfyui_manager.py`` (legacy generate_video session + sanitize)
- ``app/services/upscale_service.py`` (reachable/object_info/prompt/history/view)

Using this module gives every ComfyUI caller:
- one shared ``aiohttp`` session for stateless routes (no per-request
  ``ClientSession()`` churn — see knowledge-library/backend-debugging-guide.md
  § Adapter Connection Reuse),
- one filename/subfolder sanitizer (path-traversal safe),
- one history/queue/view implementation handling both ComfyUI queue shapes,
- one model-dir resolver (no more duplicated search_paths lists).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import aiohttp

from . import http as _http
from .paths import sanitize_filename, sanitize_subfolder

__all__ = [
    "get_shared_session",
    "close_shared_session",
    "sanitize_filename",
    "sanitize_subfolder",
    "safe_join",
    "view_params",
    "extract_combo_options",
    "fetch_history",
    "fetch_queue",
    "find_queue_entry",
    "fetch_view_bytes",
    "submit_prompt",
    "is_reachable",
    "fetch_object_info",
    "resolve_comfyui_dir",
    "resolve_models_dir",
]

logger = logging.getLogger(__name__)

_SESSION_KEY = "comfyui"


async def get_shared_session() -> aiohttp.ClientSession:
    """Module-level shared session for stateless ComfyUI API routes.

    Backed by the ``core.http`` registry (per-service tuning lives there).
    Adapters with their own lifecycle (``ComfyUIAdapter._get_session``) keep
    their instance session; this is for free functions / API routes that
    previously did ``async with aiohttp.ClientSession()`` per request.
    """
    return await _http.get_shared_session(_SESSION_KEY, **_http.session_defaults(_SESSION_KEY))


async def close_shared_session() -> None:
    """Close the shared session (app shutdown)."""
    await _http.close_shared_session(_SESSION_KEY)


def safe_join(base_dir: Path, filename: str) -> Path:
    """Join a sanitized filename onto ``base_dir`` with containment check."""
    from .paths import resolve_within

    return resolve_within(base_dir, sanitize_filename(filename))


def view_params(filename: str, subfolder: str | None = "", file_type: str = "output") -> dict[str, Any]:
    """Build ``/view`` query params with sanitized values."""
    params: dict[str, Any] = {"filename": sanitize_filename(filename), "type": file_type}
    safe_sub = sanitize_subfolder(subfolder)
    if safe_sub:
        params["subfolder"] = safe_sub
    return params


def extract_combo_options(node_info: dict[str, Any], input_name: str) -> list[str]:
    """Extract the option list for a COMBO widget from ``/object_info`` data.

    ComfyUI uses two shapes depending on node/version:
    - ``{input_name: [[opt, ...], {...}]}`` (e.g. CheckpointLoaderSimple)
    - ``{input_name: ["COMBO", {"options": [opt, ...], ...}]}``
      (e.g. AnimateDiff loaders — naive ``[0]`` indexing returns the
      string ``"COMBO"`` here, which once produced ``['C','O','M','B','O']``)

    Searches ``input.required`` then ``input.optional``. Returns ``[]`` when
    absent or malformed.
    """
    if not isinstance(node_info, dict):
        return []
    section = node_info.get("input", {}) if isinstance(node_info.get("input"), dict) else node_info
    for part in ("required", "optional"):
        group = section.get(part, {})
        if not isinstance(group, dict) or input_name not in group:
            continue
        spec = group[input_name]
        if not isinstance(spec, (list, tuple)) or not spec:
            continue
        first = spec[0]
        if isinstance(first, (list, tuple)):
            return [o for o in first if isinstance(o, str)]
        if isinstance(first, str) and len(spec) > 1 and isinstance(spec[1], dict):
            opts = spec[1].get("options", [])
            if isinstance(opts, list):
                return [o for o in opts if isinstance(o, str)]
    return []


async def fetch_history(
    base_url: str,
    prompt_id: str,
    session: aiohttp.ClientSession | None = None,
    timeout: float = 10,
) -> dict[str, Any]:
    """GET ``/history/{prompt_id}``; returns ``{}`` on non-200."""
    sess = session or await get_shared_session()
    async with sess.get(
        f"{base_url.rstrip('/')}/history/{prompt_id}",
        timeout=aiohttp.ClientTimeout(total=timeout),
    ) as resp:
        if resp.status == 200:
            return await resp.json()
        return {}


async def fetch_queue(
    base_url: str,
    session: aiohttp.ClientSession | None = None,
    timeout: float = 5,
) -> dict[str, Any]:
    """GET ``/queue``; returns ``{}`` on non-200."""
    sess = session or await get_shared_session()
    async with sess.get(
        f"{base_url.rstrip('/')}/queue",
        timeout=aiohttp.ClientTimeout(total=timeout),
    ) as resp:
        if resp.status == 200:
            return await resp.json()
        return {}


def find_queue_entry(queue_data: dict[str, Any], prompt_id: str) -> dict[str, Any] | None:
    """Find a prompt in ComfyUI queue data, handling both shapes.

    - Current: ``{"queue_running": [[num, id, ...]], "queue_pending": [...]}``
    - Legacy:  ``{"running": [{task_id|id|prompt_id}], "queued": [...]}``
    """
    running = queue_data.get("queue_running", queue_data.get("running", []))
    pending = queue_data.get("queue_pending", queue_data.get("queued", []))
    for item in list(running) + list(pending):
        if isinstance(item, (list, tuple)) and len(item) > 1:
            if item[1] == prompt_id:
                return {"prompt_id": prompt_id, "queue_item": item}
        elif isinstance(item, dict):
            if (
                item.get("task_id") == prompt_id
                or item.get("id") == prompt_id
                or item.get("prompt_id") == prompt_id
            ):
                return item
    return None


async def fetch_view_bytes(
    base_url: str,
    filename: str,
    subfolder: str | None = "",
    file_type: str = "output",
    session: aiohttp.ClientSession | None = None,
    timeout: float = 60,
) -> bytes:
    """Download raw bytes from ComfyUI ``/view`` with sanitized params."""
    sess = session or await get_shared_session()
    async with sess.get(
        f"{base_url.rstrip('/')}/view",
        params=view_params(filename, subfolder, file_type),
        timeout=aiohttp.ClientTimeout(total=timeout),
    ) as resp:
        if resp.status != 200:
            raise RuntimeError(f"ComfyUI /view returned {resp.status}")
        return await resp.read()


async def submit_prompt(
    base_url: str,
    workflow: dict[str, Any],
    session: aiohttp.ClientSession | None = None,
    timeout: float = 15,
) -> str:
    """POST a workflow to ``/prompt``; returns ``prompt_id`` or raises."""
    sess = session or await get_shared_session()
    payload = workflow if "prompt" in workflow else {"prompt": workflow}
    async with sess.post(
        f"{base_url.rstrip('/')}/prompt",
        json=payload,
        timeout=aiohttp.ClientTimeout(total=timeout),
    ) as resp:
        if resp.status != 200:
            body = await resp.text()
            raise RuntimeError(f"ComfyUI rejected workflow ({resp.status}): {body[:300]}")
        data = await resp.json()
        prompt_id = data.get("prompt_id")
        if not prompt_id:
            raise RuntimeError("ComfyUI returned no prompt_id")
        return prompt_id


async def is_reachable(base_url: str, timeout: float = 3.0) -> bool:
    """Lightweight ``/system_stats`` probe."""
    try:
        sess = await get_shared_session()
        async with sess.get(
            f"{base_url.rstrip('/')}/system_stats",
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            return resp.status == 200
    except Exception:
        return False


async def fetch_object_info(
    base_url: str,
    node_class: str,
    session: aiohttp.ClientSession | None = None,
    timeout: float = 5,
) -> dict[str, Any]:
    """GET ``/object_info/{node_class}``; returns ``{}`` on failure."""
    try:
        sess = session or await get_shared_session()
        async with sess.get(
            f"{base_url.rstrip('/')}/object_info/{node_class}",
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                return {}
            return await resp.json()
    except Exception as e:
        logger.debug("object_info/%s failed: %s", node_class, e)
        return {}


def resolve_comfyui_dir() -> Path | None:
    """Locate the ComfyUI install dir (sibling of repo root or configured)."""
    from .paths import comfyui_dir

    cand = comfyui_dir()
    if cand.exists() and (cand / "main.py").exists():
        return cand
    # Fall back to any existing candidate dir even without main.py
    if cand.exists():
        return cand
    return None


def resolve_models_dir() -> Path | None:
    """Locate ``ComfyUI/models`` using the install dir or known paths."""
    from .paths import comfyui_models_dir

    models = comfyui_models_dir()
    return models if models.exists() else None
