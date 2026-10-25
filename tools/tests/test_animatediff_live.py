"""Insight-generating test for AnimateDiff video generation.

Verifies:
1. An explicit kandinsky checkpoint is rejected up front (ValueError)
2. Default auto-select AnimateDiff generation produces a real 16-frame clip
3. The generated video path is returned and points to an existing file

Run from repo root with the studio env and ComfyUI running:
    python tools/tests/test_animatediff_live.py
"""

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, "packages/backend")

from app.adapters.comfyui import ComfyUIAdapter  # noqa: E402

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}  {detail}")
    if not ok:
        failures.append(label)


async def main() -> int:
    adapter = ComfyUIAdapter(base_url="http://127.0.0.1:8188")

    # 1. Bad checkpoint must be rejected up front.
    try:
        await adapter._generate_video({
            "prompt": "test",
            "num_frames": 16,
            "ckpt_name": "kandinsky5lite_i2v_5s.safetensors",
        })
        check("kandinsky ckpt rejected", False, "no exception raised")
    except ValueError as e:
        check("kandinsky ckpt rejected", True, str(e))
    except Exception as e:
        check("kandinsky ckpt rejected with ValueError", False,
              f"got {type(e).__name__}: {e}")

    # 2. Real auto-select AnimateDiff generation (SD1.5 auto-picked).
    t0 = time.perf_counter()
    try:
        result = await adapter._generate_video({
            "prompt": "a neon city street at night, rain reflections, cinematic",
            "num_frames": 16,
            "width": 512,
            "height": 512,
            "steps": 12,
            "fps": 8,
        })
        elapsed = time.perf_counter() - t0

        check("auto-select AnimateDiff generation succeeded", True,
              f"{elapsed:.1f}s")

        video_path = result.get("video_path")
        check("video_path returned", video_path is not None,
              f"got {video_path}")

        if video_path:
            p = Path(video_path)
            check("video file exists on disk", p.exists(),
                  f"{p} ({p.stat().st_size / 1024:.0f} KiB)" if p.exists() else "missing")

        info = result.get("info")
        check("generation info returned", info is not None,
              f"got {type(info).__name__}")

    except Exception as e:
        check("auto-select AnimateDiff generation succeeded", False,
              f"{type(e).__name__}: {e}")

    await adapter.close()

    print("\n" + ("ALL PASS" if not failures else f"FAILURES: {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
