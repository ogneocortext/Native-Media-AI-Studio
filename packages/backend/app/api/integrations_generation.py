"""
Integrations API - ComfyUI result collection (kept here for test compatibility).

`get_result`, `_collect_comfyui_outputs` and `_save_comfyui_asset` remain in
this module because `packages/backend/tests/test_comfyui_result_collection.py`
imports `app.api.integrations_generation` and monkeypatches `m.PROJECT_ROOT` and
`m._cu.fetch_history`. All other ComfyUI/Ollama/VRAM/visualizer/audio/upscale
routes moved to dedicated domain modules (integrations_comfyui.py, etc.) and are
registered separately in main.py.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..core import comfyui_client as _cu
from ..core.config import PROJECT_ROOT, config

router = APIRouter(tags=["Integrations-Generation"])


async def _save_comfyui_asset(
    item: dict,
    output_subdir: str,
    base_url: str,
    prompt_id: str,
    kind: str,
    timeout: int,
) -> dict | None:
    """Download one ComfyUI output asset and save it under `output/<subdir>`.
    Returns a completed-result dict, an error dict, or None when `item` carries
    no usable filename (so the caller can keep looking).
    Extracted from `get_result`, which had two near-identical 30-line blocks for
    images and video, each nested five levels deep. The two differed only in
    subdirectory, result `kind`, and fetch timeout.
    """
    try:
        filename = _cu.sanitize_filename(item.get("filename", ""))
    except ValueError as e:
        return {"status": "error", "error": str(e), "prompt_id": prompt_id}
    if not filename:
        return None
    subfolder = _cu.sanitize_subfolder(item.get("subfolder", ""))
    try:
        data = await _cu.fetch_view_bytes(base_url, filename, subfolder, timeout=timeout)
    except RuntimeError as e:
        return {"status": "error", "error": str(e), "prompt_id": prompt_id}
    output_dir = PROJECT_ROOT / "output" / output_subdir
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        filepath = _cu.safe_join(output_dir, filename)
    except ValueError:
        return {"status": "error", "error": "Invalid output path", "prompt_id": prompt_id}
    Path(filepath).write_bytes(data)
    return {
        "status": "completed",
        "success": True,
        "output_path": str(filepath),
        "prompt_id": prompt_id,
        "kind": kind,
    }


async def _collect_comfyui_outputs(
    outputs: dict,
    output_key: str,
    subdir: str,
    kind: str,
    base_url: str,
    prompt_id: str,
    timeout: int,
) -> dict | None:
    """Scan every node's `output_key` list and save the first usable asset.
    Returns the first completed/error result, or None if this output type has
    nothing usable - which is what lets the caller fall through from images to
    video. This is the loop that was three levels deep inside `get_result` and
    duplicated for each output type.
    """
    for output in outputs.values():
        if not isinstance(output, dict) or output_key not in output:
            continue
        for item in output[output_key]:
            if not isinstance(item, dict):
                continue
            result = await _save_comfyui_asset(item, subdir, base_url, prompt_id, kind, timeout)
            if result is not None:
                return result
    return None


@router.get("/{service_name}/result/{prompt_id}")
async def get_result(service_name: str, prompt_id: str) -> dict:
    """Get the final result of a generation."""
    if service_name != "comfyui":
        raise HTTPException(status_code=400, detail="Only ComfyUI is supported")
    base_url = config.comfyui_url
    try:
        history = await _cu.fetch_history(base_url, prompt_id)
        if not history or prompt_id not in history:
            return {"status": "pending", "prompt_id": prompt_id}
        outputs = history[prompt_id].get("outputs", {})
        # Images first, then video/gif (AnimateDiff/Wan workflows). "video" is a
        # separate key from "gifs" but is handled identically.
        for output_key, subdir, kind, timeout in (
            ("images", "images", "image", 30),
            ("gifs", "video", "video", 60),
            ("video", "video", "video", 60),
        ):
            result = await _collect_comfyui_outputs(
                outputs, output_key, subdir, kind, base_url, prompt_id, timeout
            )
            if result is not None:
                return result
        return {"status": "error", "error": "No outputs found in result", "prompt_id": prompt_id}
    except Exception as e:
        return {"status": "error", "error": str(e), "prompt_id": prompt_id}
