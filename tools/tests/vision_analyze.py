#!/usr/bin/env python3
"""Custom vision analysis script that works around the vision-mcp bug.

The vision-mcp tool fails with "Ollama API error: 400" when images are too large.
This script resizes images before sending to Ollama's vision API.

Usage:
    python tools/tests/vision_analyze.py <image_path> "Your question here"
    python tools/tests/vision_analyze.py screenshot.png "Describe the UI"
"""

import base64
import json
import sys
import urllib.request
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow required. Install with: pip install Pillow", file=sys.stderr)
    sys.exit(1)

OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_MODEL = "qwen3-vl:4b"
MAX_DIMENSION = 1200  # Max width/height for vision models (balances detail vs reliability)
JPEG_QUALITY = 70


def resize_image(image_path: str) -> str:
    """Resize image and return base64-encoded JPEG."""
    img = Image.open(image_path)
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
    
    # Convert RGBA to RGB for JPEG
    if img.mode == "RGBA":
        background = Image.new("RGB", img.size, (0, 0, 0))
        background.paste(img, mask=img.split()[3])
        img = background
    
    import io
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return base64.b64encode(buf.getvalue()).decode()


def analyze(image_path: str, prompt: str, model: str = DEFAULT_MODEL) -> str:
    """Send image to Ollama vision model and return response."""
    b64 = resize_image(image_path)
    
    body = json.dumps({
        "model": model,
        "messages": [{
            "role": "user",
            "content": prompt,
            "images": [b64]
        }],
        "stream": False
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
        except Exception as e:
            if attempt < 2:
                import time
                time.sleep(2)
                continue
            raise


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <image_path> <prompt>")
        print(f"Example: {sys.argv[0]} screenshot.png 'Describe this UI'")
        sys.exit(1)
    
    image_path = sys.argv[1]
    prompt = sys.argv[2]
    
    if not Path(image_path).exists():
        print(f"ERROR: Image not found: {image_path}", file=sys.stderr)
        sys.exit(1)
    
    try:
        result = analyze(image_path, prompt)
        print(result)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
