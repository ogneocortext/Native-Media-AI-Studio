#!/usr/bin/env python3
"""Fallback vision analysis: resize + ask a local Ollama vision model.

Stands in when the primary analyzer (tools/vision/analyze.mjs) fails or is
unreachable. Also used directly by vision-mcp.mjs as its fallback backend.

Usage:
    python tools/tests/vision_analyze.py <image_path> "Your question here" [model]
    python tools/tests/vision_analyze.py screenshot.png "Describe the UI"
    VISION_MODEL=qwen3-vl:2b python tools/tests/vision_analyze.py shot.png "OCR this"
"""

import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow required. Install with: pip install Pillow", file=sys.stderr)
    sys.exit(1)

OLLAMA_HOST = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
DEFAULT_MODEL = os.environ.get("VISION_MODEL", "qwen3-vl:4b")
MAX_DIMENSION = 1200  # Max width/height for vision models (balances detail vs reliability)
JPEG_QUALITY = 70
# Small files skip re-encoding: JPEG recompression smears glyphs on
# text-dense screenshots, so send the original bytes when they fit.
PASSTHROUGH_BYTES = 200_000
# Keep the model resident like the primary analyzer does; without this every
# call risks a cold load + VRAM churn against other resident models.
KEEP_ALIVE = os.environ.get("VISION_KEEP_ALIVE", "10m")


def encode_image(image_path: str) -> str:
    """Return base64 image bytes, resizing only when necessary.

    Already-small files are sent byte-identical (PNG text stays sharp);
    anything with alpha is composited on black; any non-RGB mode is converted
    (P/LA/CMYK all crash the JPEG encoder otherwise).
    """
    raw = Path(image_path).read_bytes()
    img = Image.open(image_path)
    if max(img.size) <= MAX_DIMENSION and len(raw) <= PASSTHROUGH_BYTES:
        return base64.b64encode(raw).decode()
    return resize_image(image_path)


def resize_image(image_path: str) -> str:
    """Resize image and return base64-encoded JPEG."""
    img = Image.open(image_path)
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)

    # Composite alpha on black, then normalize every other mode to RGB.
    if "A" in img.getbands():
        background = Image.new("RGB", img.size, (0, 0, 0))
        background.paste(img.convert("RGB"), mask=img.getchannel("A"))
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    import io
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return base64.b64encode(buf.getvalue()).decode()


def analyze(image_path: str, prompt: str, model: str = DEFAULT_MODEL) -> str:
    """Send image to Ollama vision model and return response."""
    b64 = encode_image(image_path)

    body = json.dumps({
        "model": model,
        "messages": [{
            "role": "user",
            "content": prompt,
            "images": [b64]
        }],
        "stream": False,
        "keep_alive": KEEP_ALIVE,
    })

    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=body.encode(),
        headers={"Content-Type": "application/json"}
    )

    # Retry logic for intermittent failures
    for attempt in range(3):
        try:
            resp = urllib.request.urlopen(req, timeout=180)
            result = json.loads(resp.read())
            return result.get("message", {}).get("content", "NO CONTENT")
        except Exception:
            if attempt < 2:
                import time
                time.sleep(2)
                continue
            raise


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <image_path> <prompt> [model]")
        print(f"Example: {sys.argv[0]} screenshot.png 'Describe this UI'")
        print(f"Model default: $VISION_MODEL or {DEFAULT_MODEL}")
        sys.exit(1)

    image_path = sys.argv[1]
    prompt = sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_MODEL

    if not Path(image_path).exists():
        print(f"ERROR: Image not found: {image_path}", file=sys.stderr)
        sys.exit(1)

    try:
        result = analyze(image_path, prompt, model)
        print(result)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
