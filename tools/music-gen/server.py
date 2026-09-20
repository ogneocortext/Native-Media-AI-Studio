"""Music Generation Subprocess Service

FastAPI server wrapping ACE-Step as an isolated GPU workload.
Each engine runs in its own subprocess with pinned dependencies,
communicating via HTTP. The main backend controls GPU allocation
through VRAM manager coordination.

Engines:
- ace:   ACE-Step 1.5 (Apache-2.0) — commercial-safe, good quality

Pascal (sm_61) optimizations:
- TORCH_CUDA_ARCH_LIST=6.1 for JIT kernel targeting
- PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:128 to reduce fragmentation
- compile_model=False (Triton requires sm_70+)
- use_flash_attention=False (auto-falls back to SDPA math on Pascal)

Startup:
    python server.py --port 8201 --engine ace
"""

from __future__ import annotations

import os
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Pascal (sm_61) environment hardening — must run before torch import
# ---------------------------------------------------------------------------
if "TORCH_CUDA_ARCH_LIST" not in os.environ:
    os.environ["TORCH_CUDA_ARCH_LIST"] = "6.1"
if "PYTORCH_CUDA_ALLOC_CONF" not in os.environ:
    os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "max_split_size_mb:128"
# Triton (used by torch.compile inductor backend) requires sm >= 7.0.
# On Pascal this would raise GPUTooOldForTriton; disable it defensively.
os.environ.setdefault("TORCHINDUCTOR_USE_TRITON", "0")
# Pre-Ampere GPUs (Pascal sm_61) can overflow in float16 during diffusion.
# Force float32 compute to avoid NaN/Inf latents.
os.environ.setdefault("ACESTEP_DTYPE", "float32")

import asyncio
import logging
import random
import uuid
from contextlib import asynccontextmanager
from typing import Any

import soundfile as sf
from acestep.handler import AceStepHandler
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("music-gen")

# ---------------------------------------------------------------------------
# Engine abstraction
# ---------------------------------------------------------------------------

# PROJECT_ROOT here is tools/, not the repo root: server.py lives in
# tools/music-gen/, so parent = tools/music-gen, parent.parent = tools/.
# The repo root (where output/ lives) is parent.parent.parent.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = PROJECT_ROOT.parent

# Output names become on-disk directory/file names and URL path segments.
# Restrict to a safe charset to prevent path traversal (e.g. "..%2F..%2F").
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def _validate_output_name(name: str) -> str:
    """Validate a user-supplied output name against a strict safe charset."""
    if not _SAFE_NAME_RE.match(name):
        raise HTTPException(
            400,
            "Invalid output_name. Use 1-100 chars: letters, digits, "
            "'-', '_', '.', starting with a letter or digit.",
        )
    return name


class SongRequest(BaseModel):
    style: str = Field(..., min_length=1, max_length=2000,
                       description="Genre, instruments, mood, tempo, vocal type")
    lyrics: str = Field(..., min_length=1, max_length=10000,
                        description="Full lyrics with [Verse]/[Chorus]/[Bridge] tags")
    seed: int | None = Field(None, description="Deterministic seed")
    cfg_scale: float = Field(7.0, ge=0.5, le=20.0, description="Classifier-free guidance")
    inference_steps: int = Field(8, ge=1, le=200, description="Diffusion steps")
    output_name: str | None = Field(None, description="Custom output filename")

    @field_validator("output_name")
    @classmethod
    def _check_output_name(cls, v: str | None) -> str | None:
        if v is not None and not _SAFE_NAME_RE.match(v):
            raise ValueError(
                "output_name must be 1-100 chars: letters, digits, '-', '_', '.', "
                "starting with a letter or digit"
            )
        return v


class ACEngine:
    """ACE-Step 1.5 engine wrapper."""

    def __init__(self, model_id: str = "acestep-v15-sft",
                 output_dir: str | None = None):
        self.model_id = model_id
        self.output_dir = Path(output_dir or REPO_ROOT / "output" / "music")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.handler = AceStepHandler()
        self._loaded = False

    async def load(self):
        """Load ACE-Step pipeline."""
        if self._loaded:
            return
        logger.info("ACE-Step: Loading pipeline (model=%s)...", self.model_id)

        def _init():
            msg, ok = self.handler.initialize_service(
                project_root=str(PROJECT_ROOT),
                config_path=self.model_id,
                device="auto",
                use_flash_attention=False,
                compile_model=False,
                offload_to_cpu=True,
                offload_dit_to_cpu=True,
                quantization="int8_weight_only",
            )
            # Pre-Ampere GPUs (Pascal sm_61) default to float16 inside ACE-Step,
            # which can overflow during diffusion and produce NaN/Inf latents.
            # Force float32 compute after init to keep generation numerically stable.
            try:
                import torch
                if ok and hasattr(self.handler, "dtype"):
                    self.handler.dtype = torch.float32
                    logger.info("ACE-Step: Override dtype -> float32 for Pascal stability")
                # Workaround: some model configs may expose tensor flags where bool is expected.
                if ok and hasattr(self.handler, "config"):
                    cfg = self.handler.config
                    if hasattr(cfg, "is_turbo"):
                        turbo_val = cfg.is_turbo
                        if hasattr(turbo_val, "item"):
                            cfg.is_turbo = bool(turbo_val.item())
                        elif not isinstance(turbo_val, bool):
                            cfg.is_turbo = bool(turbo_val)
                    # Patch is_turbo_model to always return a plain bool.
                    orig = getattr(self.handler, "is_turbo_model", None)
                    if callable(orig):
                        def _safe_turbo(*args, **kwargs):
                            try:
                                val = orig(*args, **kwargs)
                                if hasattr(val, "item"):
                                    return bool(val.item())
                                return bool(val)
                            except Exception:
                                return False
                        self.handler.is_turbo_model = _safe_turbo
            except Exception as exc:
                logger.warning("ACE-Step: post-init override failed: %s", exc)
            return msg, ok

        msg, ok = await asyncio.to_thread(_init)
        if not ok:
            raise RuntimeError(f"ACE-Step initialization failed: {msg}")
        self._loaded = True
        logger.info("ACE-Step: Pipeline loaded successfully")

    async def unload(self):
        """Unload pipeline to free VRAM."""
        if not self._loaded:
            return
        try:
            self.handler.model = None
            self.handler.vae = None
            self.handler.text_encoder = None
            self.handler.text_tokenizer = None
        except Exception:
            pass
        self._loaded = False
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
        except ImportError:
            pass
        logger.info("ACE-Step: Pipeline unloaded, VRAM freed")

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    async def generate(self, req: SongRequest) -> dict:
        """Generate a complete song."""
        await self.load()
        seed = req.seed if req.seed is not None else random.randint(0, 2**31 - 1)
        if req.output_name is not None:
            output_name = _validate_output_name(req.output_name)
        else:
            output_name = f"ace_{uuid.uuid4().hex[:8]}"
        out_path = (self.output_dir / output_name).resolve()
        # Defense-in-depth: even with the charset check above, never let an
        # output directory escape the configured output root.
        if self.output_dir.resolve() not in out_path.parents:
            raise HTTPException(400, "output_name escapes the output directory")
        out_path.mkdir(parents=True, exist_ok=True)

        def _gen():
            result = self.handler.generate_music(
                captions=req.style,
                lyrics=req.lyrics,
                inference_steps=req.inference_steps,
                guidance_scale=req.cfg_scale,
                seed=seed,
                task_type="text2music",
                use_tiled_decode=True,
            )
            # Extract audio tensor
            audio = result.get("audio") or result.get("pred_wavs") or result.get("audios")
            sample_rate = result.get("sample_rate", 48000)

            if audio is None:
                raise RuntimeError(f"No audio in generation result: {list(result.keys())}")

            import torch
            if isinstance(audio, dict):
                audio = audio.get("tensor") or audio.get("wav") or audio.get("audio") or next(iter(audio.values()))
                if isinstance(audio, dict):
                    audio = audio.get("tensor") or audio.get("wav") or audio.get("audio") or next(iter(audio.values()))
            if isinstance(audio, list):
                if not audio:
                    raise RuntimeError(f"Empty audios list in result: {result}")
                first = audio[0]
                if isinstance(first, dict):
                    audio = first.get("tensor")
                    if audio is None:
                        audio = first.get("wav")
                    if audio is None:
                        audio = first.get("audio")
                    if audio is None:
                        audio = next(iter(first.values()))
                else:
                    audio = first
            if isinstance(audio, dict):
                raise RuntimeError(f"Unexpected dict audio after unwrap: {audio}")

            import numpy as np

            # Convert to a NumPy array (handles torch.Tensor transparently)
            if isinstance(audio, torch.Tensor):
                audio = audio.detach().cpu().numpy()
            elif not isinstance(audio, np.ndarray):
                audio = np.asarray(audio)

            # Normalize dtype to float32 for soundfile
            if audio.dtype != np.float32:
                audio = audio.astype(np.float32)

            # Normalize to a single (channels, samples) array:
            #   (samples,)          -> (1, samples)
            #   (batch, ch, samples)-> (ch, samples)
            #   (samples, ch)      -> (ch, samples)   [soundfile native layout]
            #   (ch, samples)      -> (ch, samples)   [already correct]
            if audio.ndim == 1:
                audio = audio.reshape(1, -1)
            elif audio.ndim == 3:
                audio = audio[0]
            if audio.ndim == 2 and audio.shape[0] > 2 and audio.shape[1] <= 2:
                # (samples, channels) -> (channels, samples)
                audio = audio.T
            if audio.ndim != 2:
                audio = audio.reshape(1, -1)

            if not np.isfinite(audio).all():
                raise RuntimeError("Audio contains NaN or Inf values")
            if not audio.flags["C_CONTIGUOUS"]:
                audio = np.ascontiguousarray(audio)

            # soundfile wants (samples, channels); mono stays 1-D.
            if audio.shape[0] <= 2 and audio.shape[1] > 2:
                write_audio = audio.T
            else:
                write_audio = audio[0] if audio.shape[0] == 1 else audio

            audio_path = out_path / "audio.wav"
            sf.write(str(audio_path), write_audio, sample_rate)
            return {
                "audio_path": str(audio_path),
                "seed": seed,
                "sample_rate": sample_rate,
            }

        result = await asyncio.to_thread(_gen)
        result["output_name"] = output_name
        result["engine"] = "ace"
        return result


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

_engines: dict[str, Any] = {}
_active_engine: str = ""


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _active_engine
    engine_type = app.state.engine_type
    output_dir = app.state.output_dir

    if engine_type == "ace":
        model_id = os.environ.get("ACESTEP_MODEL_ID", "acestep-v15-sft")
        engine = ACEngine(model_id=model_id, output_dir=output_dir)
    else:
        raise ValueError(f"Unknown engine: {engine_type}")

    _engines[engine_type] = engine
    _active_engine = engine_type
    logger.info("Starting music-gen service: engine=%s, model=%s, output=%s",
                engine_type, model_id, output_dir)

    yield

    for eng in _engines.values():
        try:
            await eng.unload()
        except Exception:
            pass
    logger.info("Music-gen service stopped")


def create_app(engine_type: str = "ace",
               output_dir: str | None = None) -> FastAPI:
    app = FastAPI(
        title="Music Generation Service",
        description="Isolated GPU workload for ACE-Step music generation",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.engine_type = engine_type
    app.state.output_dir = output_dir or str(REPO_ROOT / "output" / "music")

    @app.get("/health")
    async def health():
        engine = _engines.get(_active_engine)
        return {
            "status": "ok",
            "engine": _active_engine,
            "loaded": engine.is_loaded if engine else False,
            "model": getattr(engine, "model_id", ""),
        }

    @app.get("/vram")
    async def vram_status():
        try:
            import torch
            if torch.cuda.is_available():
                free, total = torch.cuda.mem_get_info(0)
                return {
                    "total_mb": int(total // (1024 * 1024)),
                    "free_mb": int(free // (1024 * 1024)),
                    "used_mb": int((total - free) // (1024 * 1024)),
                    "percent": round(((total - free) / total) * 100, 1),
                }
        except Exception:
            pass
        return {"available": False}

    @app.post("/generate")
    async def generate(req: SongRequest):
        engine = _engines.get(_active_engine)
        if not engine:
            raise HTTPException(503, "Engine not loaded")
        try:
            result = await engine.generate(req)
            return result
        except Exception as e:
            logger.error("Generation failed: %s", e, exc_info=True)
            raise HTTPException(500, str(e)) from e

    @app.post("/unload")
    async def unload():
        engine = _engines.get(_active_engine)
        if engine:
            await engine.unload()
            return {"status": "unloaded", "engine": _active_engine}
        return {"status": "already_unloaded"}

    @app.post("/reload")
    async def reload():
        engine = _engines.get(_active_engine)
        if engine:
            await engine.load()
            return {"status": "loaded", "engine": _active_engine}
        return {"status": "no_engine"}

    @app.get("/audio/{output_name}")
    async def get_audio(output_name: str):
        output_name = _validate_output_name(output_name)
        base = Path(app.state.output_dir) / output_name
        # Try formats in preference order; use the correct media type for each.
        candidates = [
            (base / "audio.flac", "audio/flac"),
            (base / "audio.wav", "audio/wav"),
            (base / "audio.mp3", "audio/mpeg"),
        ]
        for audio_path, media_type in candidates:
            if audio_path.exists():
                return FileResponse(
                    str(audio_path),
                    media_type=media_type,
                    filename=f"{output_name}.{audio_path.suffix.lstrip('.')}",
                )
        raise HTTPException(404, "Audio file not found")

    return app


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="Music Generation Service")
    parser.add_argument("--port", type=int, default=8201, help="Server port")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind host")
    parser.add_argument("--engine", choices=["ace"], default="ace",
                        help="Music generation engine")
    parser.add_argument("--output-dir", type=str, default=None,
                        help="Output directory for generated files")
    args = parser.parse_args()

    output_dir = args.output_dir
    if output_dir is None:
        output_dir = str(REPO_ROOT / "output" / "music")

    app = create_app(engine_type=args.engine, output_dir=output_dir)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
