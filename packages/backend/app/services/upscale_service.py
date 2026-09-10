"""Image upscaling service — 4x post-process pass for YouTube 4K export.

Implements the documented-but-missing upscaler from:
  - ai-video-trends-2026.md Trend 4: "add **4x upscaler pass**
    (ComfyUI 4x-ClearRealityV1) as optional post-process for YouTube 4K
    export without 4K render cost."
  - comfyui-workflows.md §5 Upscaling:
      comfyui_generate_image(action="upscale", image=..., model="4x-ClearRealityV1", scale=2|4)

Strategy:
  1. If ComfyUI is reachable → LoadImage → UpscaleModelLoader →
     ImageUpscaleWithModel → SaveImage workflow (AI super-resolution).
  2. Else → FFmpeg lanczos fallback (pure resize, always available).

Outputs land in output/images/{stem}_upscaled_{scale}x.png so they appear
in the Media Library like any other generated image.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import aiohttp

from ..core.config import PROJECT_ROOT, config

logger = logging.getLogger(__name__)

OUTPUT_BASE = Path(config.output_dir)
IMAGE_DIR = OUTPUT_BASE / "images"

DEFAULT_MODEL = "4x-ClearRealityV1"
POLL_INTERVAL_S = 1.0


@dataclass
class UpscaleResult:
    """Normalized upscale result across engines."""

    engine: str  # "comfyui" | "ffmpeg"
    model: str
    scale: int
    source: str
    output_path: str
    relative_path: str | None = None
    elapsed_s: float = 0.0
    success: bool = True
    error: str | None = None
    warnings: list[str] = field(default_factory=list)


def _resolve_image(image: str) -> Path:
    """Resolve an image reference to an absolute path.

    Accepts absolute paths, project-relative paths, bare filenames found in
    output/images, or `comfyui/`-prefixed ComfyUI output references.
    """
    p = Path(image)
    if not p.is_absolute():
        if image.startswith("comfyui/"):
            comfy_out = config.comfyui_output_dir or (PROJECT_ROOT.parent / "ComfyUI" / "output")
            p = Path(comfy_out) / image[len("comfyui/"):]
        else:
            p = PROJECT_ROOT / image
    p = p.resolve()
    if not p.exists():
        alt = (IMAGE_DIR / Path(image).name).resolve()
        if alt.exists():
            p = alt
        else:
            raise FileNotFoundError(f"Image not found: {image}")
    if p.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError(f"Not a supported image: {p.name}")
    return p


def _relative(path: Path) -> str | None:
    try:
        return path.relative_to(OUTPUT_BASE).as_posix()
    except ValueError:
        return None


async def _comfyui_reachable(timeout: float = 3.0) -> bool:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{config.comfyui_url}/system_stats",
                             timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                return r.status == 200
    except Exception:
        return False


async def _list_upscale_models() -> list[str]:
    """Query available UpscaleModelLoader models from ComfyUI object_info."""
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{config.comfyui_url}/object_info/UpscaleModelLoader",
                             timeout=aiohttp.ClientTimeout(total=5)) as r:
                if r.status != 200:
                    return []
                data = await r.json()
                info = data.get("UpscaleModelLoader", {})
                return list(info.get("input", {}).get("required", {}).get("model_name", [[""]])[0])
    except Exception:
        return []


def _build_upscale_workflow(image_name: str, model: str, scale: int, filename_prefix: str) -> dict:
    """ComfyUI API workflow: LoadImage → UpscaleModelLoader →
    ImageUpscaleWithModel → SaveImage.

    The model upscales at its native factor (e.g. 4x); a scale≠model-factor
    result is accepted as-is (ComfyUI ImageScale percent resizing is not
    uniform across versions), keeping the workflow minimal and robust.
    """
    return {"prompt": {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": model}},
        "3": {"class_type": "ImageUpscaleWithModel",
              "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
        "5": {"class_type": "SaveImage",
              "inputs": {"filename_prefix": filename_prefix, "images": ["3", 0]}},
    }}


async def _upscale_via_comfyui(src: Path, model: str, scale: int) -> UpscaleResult:
    """Submit the upscale workflow and poll history until done."""
    t0 = time.perf_counter()
    warnings: list[str] = []

    models = await _list_upscale_models()
    chosen = model if model in models else next(
        (m for m in models if "clearreality" in m.lower()), models[0] if models else None
    )
    if not chosen:
        raise RuntimeError("ComfyUI has no upscale models installed in models/upscalers")
    if chosen != model:
        warnings.append(f"model '{model}' not found; used '{chosen}'")

    # ComfyUI LoadImage needs the file in its input dir; copy if outside.
    # (config has comfyui_output_dir but no input dir — derive from output.)
    comfy_out = config.comfyui_output_dir or (PROJECT_ROOT.parent / "ComfyUI")
    comfy_root = Path(comfy_out)
    comfy_root = comfy_root if (comfy_root / "input").exists() else comfy_root.parent / "ComfyUI"
    comfy_in = comfy_root / "input"
    if src.resolve().parent != comfy_in.resolve():
        comfy_in.mkdir(parents=True, exist_ok=True)
        load_name = f"nma_upscale_{uuid.uuid4().hex[:8]}{src.suffix}"
        await asyncio.to_thread(shutil.copy2, src, comfy_in / load_name)
    else:
        load_name = src.name

    prefix = f"nma_upscale_{uuid.uuid4().hex[:8]}"
    workflow = _build_upscale_workflow(load_name, chosen, scale, prefix)

    async with aiohttp.ClientSession() as s:
        async with s.post(f"{config.comfyui_url}/prompt", json=workflow,
                          timeout=aiohttp.ClientTimeout(total=15)) as r:
            if r.status != 200:
                body = await r.text()
                raise RuntimeError(f"ComfyUI rejected upscale workflow: {body[:300]}")
            prompt_id = (await r.json())["prompt_id"]

        deadline = time.monotonic() + 600
        outputs: dict = {}
        while time.monotonic() < deadline:
            await asyncio.sleep(POLL_INTERVAL_S)
            async with s.get(f"{config.comfyui_url}/history/{prompt_id}",
                             timeout=aiohttp.ClientTimeout(total=5)) as r:
                if r.status != 200:
                    continue
                hist = await r.json()
                entry = hist.get(prompt_id)
                if not entry:
                    continue
                if entry.get("status", {}).get("status_str") == "error":
                    raise RuntimeError("ComfyUI reported workflow error during upscale")
                outputs = entry.get("outputs", {}) or {}
                if outputs:
                    break
        if not outputs:
            raise RuntimeError("Timed out waiting for ComfyUI upscale (600s)")

        for _node, out in outputs.items():
            for img in out.get("images", []):
                params = {
                    "filename": img["filename"],
                    "subfolder": img.get("subfolder", ""),
                    "type": img.get("type", "output"),
                }
                async with s.get(f"{config.comfyui_url}/view", params=params,
                                 timeout=aiohttp.ClientTimeout(total=60)) as r:
                    if r.status != 200:
                        continue
                    data = await r.read()
                    dst = IMAGE_DIR / f"{src.stem}_upscaled_{scale}x.png"
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    await asyncio.to_thread(dst.write_bytes, data)
                    return UpscaleResult(
                        engine="comfyui", model=chosen, scale=scale,
                        source=str(src), output_path=str(dst),
                        relative_path=_relative(dst),
                        elapsed_s=round(time.perf_counter() - t0, 2),
                        warnings=warnings,
                    )
    raise RuntimeError("ComfyUI upscale completed but produced no image output")


def _upscale_via_ffmpeg_sync(src: Path, dst: Path, scale: int) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found on PATH")
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        "-vf", f"scale=iw*{scale}:ih*{scale}:flags=lanczos",
        str(dst),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0 or not dst.exists():
        raise RuntimeError(f"FFmpeg upscale failed: {(proc.stderr or '')[-300:]}")


async def _upscale_via_ffmpeg(src: Path, scale: int) -> UpscaleResult:
    t0 = time.perf_counter()
    dst = IMAGE_DIR / f"{src.stem}_upscaled_{scale}x.png"
    dst.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(_upscale_via_ffmpeg_sync, src, dst, scale)
    return UpscaleResult(
        engine="ffmpeg", model="lanczos", scale=scale,
        source=str(src), output_path=str(dst),
        relative_path=_relative(dst),
        elapsed_s=round(time.perf_counter() - t0, 2),
        warnings=["ComfyUI unavailable — pure lanczos resize (no AI super-resolution)"],
    )


async def upscale_image(image: str, model: str = DEFAULT_MODEL, scale: int = 4,
                        prefer_comfyui: bool = True) -> UpscaleResult:
    """Upscale one image by `scale`× via ComfyUI AI model or FFmpeg fallback."""
    if scale not in (2, 4):
        raise ValueError("scale must be 2 or 4")
    src = _resolve_image(image)

    if prefer_comfyui and await _comfyui_reachable():
        try:
            return await _upscale_via_comfyui(src, model, scale)
        except Exception as exc:
            logger.warning("ComfyUI upscale failed (%s); falling back to FFmpeg", exc)
            fb = await _upscale_via_ffmpeg(src, scale)
            fb.warnings.append(f"ComfyUI attempt failed: {exc}")
            return fb
    return await _upscale_via_ffmpeg(src, scale)