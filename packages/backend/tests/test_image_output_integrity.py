"""A generation job must not report success without a real image.

`save_output` used to log a warning and return an output path even when the
adapter produced no image, so the job was recorded `completed` with
`output_path: None` alongside a plausible-looking seed and step count. The UI
renders "completed" jobs as finished work, so that is a false claim about work
that never happened. The same path accepted the adapters' 1x1 mock PNG (70 bytes)
and stored it as if it were a render.

These tests pin both refusals, plus the genuine-render case that must keep
working.
"""

import asyncio
import base64
import json
import struct
import zlib

import pytest
from app.models.job import Job
from app.services.image_generator import ImageGenerationHandler


def _png(width: int, height: int) -> bytes:
    """A minimal but *real* PNG of the requested size."""
    raw = b"".join(b"\x00" + b"\x7f" * width for _ in range(height))
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _job(tmp_path, monkeypatch):
    from app.services import image_generator as mod
    monkeypatch.setattr(mod, "OUTPUT_DIR", tmp_path)
    return Job(id="abcdef123456", job_type="image_generation",
               params={"prompt": "a cat"})


class _StubAdapter:
    def __init__(self, result):
        self._result = result

    async def generate_with_fallback(self, params):
        return self._result


async def _run(tmp_path, monkeypatch, result):
    handler = ImageGenerationHandler(adapter=_StubAdapter(result))
    monkeypatch.setattr(
        "app.services.image_generator.go_write_sidecar",
        lambda *a, **k: asyncio.sleep(0, result={"written": False}),
    )
    return await handler.save_output(_job(tmp_path, monkeypatch), result)


def test_refuses_a_one_pixel_placeholder(tmp_path, monkeypatch):
    """The adapters' mock output must not be stored as a render."""
    mock_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
        "2mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
    )
    assert len(mock_png) == 70
    with pytest.raises(ValueError, match="placeholder"):
        asyncio.run(_run(tmp_path, monkeypatch, {"image": base64.b64encode(mock_png).decode()}))


def test_refuses_a_result_with_no_image(tmp_path, monkeypatch):
    """No image must be an error, not a silently 'completed' job."""
    with pytest.raises(ValueError, match="no image data"):
        asyncio.run(_run(tmp_path, monkeypatch, {"seed": 4192737525, "info": "MOCK"}))


def test_stores_a_real_render(tmp_path, monkeypatch):
    """The normal path must keep working and produce both files.

    Uses a 64x64 image that compresses to well under 1 KB. A byte-size threshold
    would wrongly reject this as a placeholder, which is why the check reads PNG
    dimensions instead.
    """
    data = _png(64, 64)
    assert len(data) < 1024, "this fixture must stay small to be a meaningful test"
    out = asyncio.run(_run(tmp_path, monkeypatch, {
        "image": base64.b64encode(data).decode(), "seed": 7, "info": "real",
    }))
    # Locate by extension rather than reconstructing the timestamped filename.
    pngs = list(tmp_path.glob("*.png"))
    jsons = list(tmp_path.glob("*.json"))
    assert len(pngs) == 1 and len(jsons) == 1
    assert pngs[0].read_bytes() == data
    sidecar = json.loads(jsons[0].read_text())
    assert sidecar["job_id"] == "abcdef123456"
    assert sidecar["prompt"] == "a cat"
    assert out["image"].endswith(pngs[0].name)
