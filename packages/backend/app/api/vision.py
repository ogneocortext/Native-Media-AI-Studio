"""
Vision OCR & chart reading via gemma4 (primary) with MiniCPM-V fallback.
Wraps Ollama /api/chat so Media Library / GPU Monitor can extract text without
re-implementing curl on the frontend. Model-aware: minicpm-v disables tools/thinking.
"""

import base64
import json as _json
import logging

import aiohttp
from fastapi import APIRouter, File, Form, UploadFile

from ..core import ollama_client as _oc
from ..core.urls import ollama_url

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vision", tags=["Vision"])

DEFAULT_MODEL = "gemma4:e2b-it-qat"
# minicpm-v:8b deleted 2026-10-22 (too big for 8 GB VRAM). No vision fallback
# remains; vision requests fall back to gemma4:e2b-it-qat itself.
FALLBACK_MODEL = None

OLLAMA_URL = ollama_url()

PROMPTS = {
    "ocr": "Transcribe all visible text preserving original line breaks, punctuation, and reading order. If a table is present, convert it to markdown. If a region is unclear write [unclear]. Do NOT invent text.",
    "table": 'Convert the table in this image to markdown, preserving headers, rows, and alignment. If no table exists reply "No table detected."',
    "chart": 'Describe the trend shown in this chart. Name axes, units, and relative heights. Compare peaks/valleys and flag any ambiguous value as "estimated". Do NOT invent exact numbers if labels are missing.',
    "visualizer": (
        "You are critiquing a real-time 2D music visualizer frame. "
        "Be concise and actionable. Return 3-6 bullets grouped as:\n"
        "- What works\n"
        "- Issues (flicker, muddiness, low contrast, clipping, illegibility)\n"
        "- Suggested fixes (colors, motion, readability)\n"
        "Do not invent text that is not present in the image."
    ),
}


async def _ollama_chat(model: str, prompt: str, b64: str, think: bool = False) -> str:
    """Async Ollama chat call using shared aiohttp session (non-blocking)."""
    is_minicpm = "minicpm" in model.lower()
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt, "images": [b64]}],
        "stream": False,
        "keep_alive": "5m",
        "options": {"temperature": 0 if is_minicpm else 0.3, "num_ctx": 8192, "num_predict": 1024},
    }
    if think and not is_minicpm:
        payload["think"] = True

    # Use shared session for connection pooling
    session = await _oc.get_shared_session()
    async with session.post(
        f"{OLLAMA_URL}/api/chat",
        json=payload,
        timeout=aiohttp.ClientTimeout(total=300),
    ) as resp:
        if resp.status != 200:
            raise RuntimeError(f"Ollama returned HTTP {resp.status}")
        j = await resp.json()
        return (j.get("message") or {}).get("content") or ""


def _save_ocr_result(relative_path: str, file: UploadFile, text: str, model: str, prompt: str, raw: bytes) -> None:
    """Persist OCR result to DB (Media Library covers, GPU charts, any ad-hoc scan)."""
    try:
        from ..core.database import save_vision_ocr
        import asyncio as _asyncio
        rel = relative_path or file.filename or "unknown"
        _asyncio.create_task(_asyncio.to_thread(save_vision_ocr, rel, file.filename or "unknown", text, model, prompt, file.content_type, len(raw)))
    except Exception as e:
        logger.debug(f"vision ocr DB save skipped: {e}")


async def _vision_chat_with_fallback(model: str, prompt: str, b64: str) -> str:
    """Try vision chat with primary model, fall back to FALLBACK_MODEL if available."""
    try:
        return await _ollama_chat(model, prompt, b64)
    except Exception as e:
        logger.warning(f"vision analysis with {model} failed: {e}; trying fallback {FALLBACK_MODEL}")
        if FALLBACK_MODEL:
            try:
                return await _ollama_chat(FALLBACK_MODEL, prompt, b64)
            except Exception as e2:
                raise RuntimeError(str(e2)) from e2
        raise RuntimeError(str(e)) from e


@router.post("/ocr")
async def vision_ocr(
    file: UploadFile = File(...),
    prompt: str = Form("ocr"),
    model: str = Form(DEFAULT_MODEL),
    relative_path: str = Form(""),
):
    """OCR / chart / table extraction via local vision model (default minicpm-v:8b). Persists to DB for history/search."""
    if file.content_type and not file.content_type.startswith("image/"):
        if file.content_type not in ("image/png", "image/jpeg", "image/webp", "image/jpg"):
            pass
    raw_parts = []
    total = 0
    while chunk := await file.read(8192):
        total += len(chunk)
        if total > 15 * 1024 * 1024:
            return {"error": "file too large (15MB max)"}
        raw_parts.append(chunk)
    raw = b"".join(raw_parts)
    if not raw:
        return {"error": "empty file"}
    b64 = base64.b64encode(raw).decode()
    effective_prompt = PROMPTS.get(prompt, prompt)
    text = await _vision_chat_with_fallback(model, effective_prompt, b64)
    _save_ocr_result(relative_path, file, text, model, prompt, raw)
    return {"text": text, "model": model, "prompt": prompt, "filename": file.filename, "relative_path": relative_path or file.filename}


@router.post("/chart")
async def vision_chart(file: UploadFile = File(...), model: str = Form(DEFAULT_MODEL)):
    """Convenience alias for chart reading."""
    return await vision_ocr(file=file, prompt="chart", model=model)


@router.post("/analyze-visualizer")
async def analyze_visualizer(
    file: UploadFile = File(...),
    mode: str = Form("bars"),
    model: str = Form(DEFAULT_MODEL),
):
    """Analyze a 2D visualizer screenshot via Ollama vision model."""
    if file.content_type and not file.content_type.startswith("image/"):
        if file.content_type not in ("image/png", "image/jpeg", "image/webp", "image/jpg"):
            pass
    raw_parts = []
    total = 0
    while chunk := await file.read(8192):
        total += len(chunk)
        if total > 15 * 1024 * 1024:
            return {"error": "file too large (15MB max)"}
        raw_parts.append(chunk)
    raw = b"".join(raw_parts)
    if not raw:
        return {"error": "empty file"}
    b64 = base64.b64encode(raw).decode()
    prompt = (
        f"2D visualizer screenshot in mode={mode}. "
        + PROMPTS["visualizer"]
    )
    text = await _vision_chat_with_fallback(model, prompt, b64)
    return {"text": text, "model": model, "mode": mode}


@router.get("/ocr/history")
async def vision_ocr_history(limit: int = 20):
    """List recent OCR results from DB (Media Library covers, charts)."""
    try:
        from ..core.database import list_vision_ocr
        pts = await _run_in_thread(list_vision_ocr, limit)
        return {"results": pts, "count": len(pts)}
    except Exception as e:
        return {"error": str(e), "results": []}


@router.get("/ocr/by-path/{relative_path:path}")
async def vision_ocr_by_path(relative_path: str):
    """Get latest OCR for a given library file."""
    try:
        from ..core.database import get_vision_ocr
        import asyncio as _asyncio
        r = await _asyncio.to_thread(get_vision_ocr, relative_path)
        if not r:
            return {"found": False, "relative_path": relative_path}
        return {"found": True, **r}
    except Exception as e:
        return {"error": str(e)}
