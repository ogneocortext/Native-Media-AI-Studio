"""
Vision OCR & chart reading via MiniCPM-V (your latest local model).
Wraps Ollama /api/chat so Media Library / GPU Monitor can extract text without
re-implementing curl on the frontend. Model-aware: minicpm-v disables tools/thinking.
"""

import base64
import json as _json
import logging

from fastapi import APIRouter, File, Form, UploadFile

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vision", tags=["Vision"])

DEFAULT_MODEL = "minicpm-v:8b"
FALLBACK_MODEL = "qwen3-vl:4b"
OLLAMA_URL = "http://127.0.0.1:11434"

PROMPTS = {
    "ocr": "Transcribe all visible text preserving original line breaks, punctuation, and reading order. If a table is present, convert it to markdown. If a region is unclear write [unclear]. Do NOT invent text.",
    "table": 'Convert the table in this image to markdown, preserving headers, rows, and alignment. If no table exists reply "No table detected."',
    "chart": 'Describe the trend shown in this chart. Name axes, units, and relative heights. Compare peaks/valleys and flag any ambiguous value as "estimated". Do NOT invent exact numbers if labels are missing.',
}


def _ollama_chat(model: str, prompt: str, b64: str, think: bool = False) -> str:
    import urllib.request
    is_minicpm = "minicpm" in model.lower()
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt, "images": [b64]}],
        "stream": False,
        "keep_alive": "5m",
        "options": {"temperature": 0 if is_minicpm else 0.3, "num_ctx": 32768 if is_minicpm else 16384, "num_predict": 1024},
    }
    if think and not is_minicpm:
        payload["think"] = True
    data = _json.dumps(payload).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        j = _json.loads(resp.read())
        return (j.get("message") or {}).get("content") or ""


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
    raw = await file.read()
    if not raw:
        return {"error": "empty file"}
    if len(raw) > 15 * 1024 * 1024:
        return {"error": "file too large (15MB max)"}
    b64 = base64.b64encode(raw).decode()
    effective_prompt = PROMPTS.get(prompt, prompt)
    try:
        text = await _run_in_thread(_ollama_chat, model, effective_prompt, b64)
    except Exception as e:
        logger.warning(f"vision ocr with {model} failed: {e}; trying fallback {FALLBACK_MODEL}")
        try:
            text = await _run_in_thread(_ollama_chat, FALLBACK_MODEL, effective_prompt, b64)
            model = FALLBACK_MODEL
        except Exception as e2:
            return {"error": str(e2), "model": model}
    # Persist to DB (applicable: Media Library covers, GPU charts, any ad-hoc scan)
    try:
        from ..core.database import save_vision_ocr
        rel = relative_path or file.filename or "unknown"
        await _run_in_thread(save_vision_ocr, rel, file.filename or "unknown", text, model, prompt, file.content_type, len(raw))
    except Exception as e:
        logger.debug(f"vision ocr DB save skipped: {e}")
    return {"text": text, "model": model, "prompt": prompt, "filename": file.filename, "relative_path": relative_path or file.filename}


@router.post("/chart")
async def vision_chart(file: UploadFile = File(...), model: str = Form(DEFAULT_MODEL)):
    """Convenience alias for chart reading."""
    return await vision_ocr(file=file, prompt="chart", model=model)


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
        r = await _run_in_thread(get_vision_ocr, relative_path)
        if not r:
            return {"found": False, "relative_path": relative_path}
        return {"found": True, **r}
    except Exception as e:
        return {"error": str(e)}


async def _run_in_thread(func, *args):
    import asyncio as _asyncio
    return await _asyncio.to_thread(func, *args)
