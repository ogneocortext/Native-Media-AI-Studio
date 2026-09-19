"""Music Generation Subprocess Service

FastAPI server wrapping YuE2 and ACE-Step as isolated GPU workloads.
Each engine runs in its own subprocess with pinned dependencies,
communicating via HTTP. The main backend controls GPU allocation
through VRAM manager coordination.

Engines:
- yue2:  YuE2-3B (CC-BY-NC-4.0) — best quality, non-commercial
- ace:   ACE-Step 1.5 (Apache-2.0) — commercial-safe, good quality

Startup:
    python server.py --port 8200 --engine yue2
    python server.py --port 8201 --engine ace
    # Or both on separate ports:
    python server.py --port 8200 --engine yue2 --vram-budget 6
    python server.py --port 8201 --engine ace --vram-budget 4
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("music-gen")

# ---------------------------------------------------------------------------
# Engine abstraction
# ---------------------------------------------------------------------------

class EngineType(str, Enum):
    YUE2 = "yue2"
    ACE = "ace"


class GenerationStatus(str, Enum):
    PENDING = "pending"
    PLANNING = "planning"
    GENERATING = "generating"
    DECODING = "decoding"
    COMPLETE = "complete"
    ERROR = "error"


class SongRequest(BaseModel):
    style: str = Field(..., min_length=1, max_length=2000,
                       description="Genre, instruments, mood, tempo, vocal type")
    lyrics: str = Field(..., min_length=1, max_length=10000,
                        description="Full lyrics with [Verse]/[Chorus]/[Bridge] tags")
    cot: str = Field("full", description="Chain-of-thought: full, melody, off")
    seed: Optional[int] = Field(None, description="Deterministic seed")
    abc: Optional[str] = Field(None, description="Pre-made ABC score for covers/edits")
    cfg_scale: float = Field(1.0, ge=0.5, le=3.0, description="Classifier-free guidance")
    max_new_tokens: int = Field(3000, ge=100, le=8000)
    output_name: Optional[str] = Field(None, description="Custom output filename")


class PlanRequest(BaseModel):
    style: str
    lyrics: str
    cot: str = "full"
    seed: Optional[int] = None


class CoverRequest(BaseModel):
    reference_audio: str = Field(..., description="Path to reference audio file")
    style: str
    lyrics: str
    start_time: float = 0.0
    end_time: float = 30.0
    dual_track: bool = False
    vocal_path: Optional[str] = None
    instrumental_path: Optional[str] = None


class EditScoreRequest(BaseModel):
    abc: str = Field(..., description="ABC notation score to render")
    style: str
    lyrics: str
    seed: Optional[int] = None


# ---------------------------------------------------------------------------
# Engine implementations
# ---------------------------------------------------------------------------

class Yue2Engine:
    """YuE2-3B engine wrapper."""

    def __init__(self, model_id: str = "m-a-p/YuE2-3B",
                 vae_id: str = "m-a-p/YuE2-Vae",
                 vram_budget: int = 6,
                 output_dir: str = "output/music"):
        self.model_id = model_id
        self.vae_id = vae_id
        self.vram_budget = vram_budget
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.pipe = None
        self._loaded = False

    async def load(self):
        """Load the YuE2 pipeline (blocking, run in thread)."""
        if self._loaded:
            return
        logger.info("YuE2: Loading pipeline (model=%s, vram_budget=%dGB)...",
                     self.model_id, self.vram_budget)
        def _load():
            from yue2 import YuE2Pipeline
            self.pipe = YuE2Pipeline.from_pretrained(
                self.model_id,
                vae=self.vae_id,
                device="cuda",
                memory_budget_gib=self.vram_budget,
                backend="torch-eager",
            )
        await asyncio.to_thread(_load)
        self._loaded = True
        logger.info("YuE2: Pipeline loaded successfully")

    async def unload(self):
        """Unload pipeline to free VRAM."""
        if self.pipe is not None:
            try:
                self.pipe.close()
            except Exception:
                pass
            self.pipe = None
        self._loaded = False
        # Force CUDA cache cleanup
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
        except ImportError:
            pass
        logger.info("YuE2: Pipeline unloaded, VRAM freed")

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    async def generate(self, req: SongRequest) -> dict[str, Any]:
        """Generate a complete song."""
        await self.load()
        seed = req.seed or int(time.time()) % (2**31)
        output_name = req.output_name or f"yue2_{uuid.uuid4().hex[:8]}"
        out_path = self.output_dir / output_name

        def _gen():
            kwargs: dict[str, Any] = {
                "style": req.style,
                "lyrics": req.lyrics,
                "cot": req.cot,
                "seed": seed,
                "max_new_tokens": req.max_new_tokens,
            }
            if req.cfg_scale != 1.0:
                kwargs["cfg_scale"] = req.cfg_scale
            if req.abc:
                kwargs["abc"] = req.abc
            song = self.pipe(**kwargs)
            out_path.mkdir(parents=True, exist_ok=True)
            song.save(str(out_path / "audio.flac"))
            song.save_artifacts(str(out_path))
            return {
                "audio_path": str(out_path / "audio.flac"),
                "abc_path": str(out_path / "score.abc"),
                "truncated": song.truncated,
                "seed": seed,
            }

        result = await asyncio.to_thread(_gen)
        result["output_name"] = output_name
        result["engine"] = "yue2"
        return result

    async def plan(self, req: PlanRequest) -> dict[str, Any]:
        """Generate score only (no audio)."""
        await self.load()
        seed = req.seed or int(time.time()) % (2**31)
        output_name = f"plan_{uuid.uuid4().hex[:8]}"
        out_path = self.output_dir / output_name

        def _plan():
            plan_result = self.plan_internal(
                style=req.style, lyrics=req.lyrics,
                cot=req.cot, seed=seed,
            )
            out_path.mkdir(parents=True, exist_ok=True)
            plan_result.save(str(out_path))
            return {
                "abc_path": str(out_path / "score.abc"),
                "seed": seed,
            }

        result = await asyncio.to_thread(_plan)
        result["output_name"] = output_name
        result["engine"] = "yue2"
        return result

    def plan_internal(self, style: str, lyrics: str, cot: str = "full",
                      seed: int = 0):
        """Internal plan call (sync)."""
        return self.pipe.plan(style=style, lyrics=lyrics, cot=cot, seed=seed)

    async def render_from_score(self, req: EditScoreRequest) -> dict[str, Any]:
        """Render audio from an edited ABC score."""
        await self.load()
        seed = req.seed or int(time.time()) % (2**31)
        output_name = f"edit_{uuid.uuid4().hex[:8]}"
        out_path = self.output_dir / output_name

        def _render():
            song = self.pipe(
                style=req.style, lyrics=req.lyrics,
                cot="full", seed=seed, abc=req.abc,
            )
            out_path.mkdir(parents=True, exist_ok=True)
            song.save(str(out_path / "audio.flac"))
            song.save_artifacts(str(out_path))
            return {
                "audio_path": str(out_path / "audio.flac"),
                "seed": seed,
            }

        result = await asyncio.to_thread(_render)
        result["output_name"] = output_name
        result["engine"] = "yue2"
        return result


class ACEngine:
    """ACE-Step 1.5 engine wrapper."""

    def __init__(self, model_id: str = "ACE-Step/ACE-Step-1.5-alpha",
                 vram_budget: int = 4,
                 output_dir: str = "output/music"):
        self.model_id = model_id
        self.vram_budget = vram_budget
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.pipe = None
        self._loaded = False

    async def load(self):
        """Load ACE-Step pipeline."""
        if self._loaded:
            return
        logger.info("ACE-Step: Loading pipeline (model=%s)...", self.model_id)
        def _load():
            from acestep import ACEStepPipeline
            self.pipe = ACEStepPipeline.from_pretrained(
                self.model_id,
                device="cuda",
            )
        await asyncio.to_thread(_load)
        self._loaded = True
        logger.info("ACE-Step: Pipeline loaded successfully")

    async def unload(self):
        """Unload pipeline to free VRAM."""
        if self.pipe is not None:
            try:
                del self.pipe
            except Exception:
                pass
            self.pipe = None
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

    async def generate(self, req: SongRequest) -> dict[str, Any]:
        """Generate a complete song."""
        await self.load()
        seed = req.seed or int(time.time()) % (2**31)
        output_name = req.output_name or f"ace_{uuid.uuid4().hex[:8]}"
        out_path = self.output_dir / output_name

        def _gen():
            result = self.pipe.generate(
                prompt=req.style,
                lyrics=req.lyrics,
                seed=seed,
                num_inference_steps=100,
                guidance_scale=req.cfg_scale,
            )
            out_path.mkdir(parents=True, exist_ok=True)
            audio_path = out_path / "audio.wav"
            # Save audio
            import soundfile as sf
            sf.write(str(audio_path), result.audio, result.sample_rate)
            return {
                "audio_path": str(audio_path),
                "seed": seed,
                "sample_rate": result.sample_rate,
            }

        result = await asyncio.to_thread(_gen)
        result["output_name"] = output_name
        result["engine"] = "ace"
        return result


# ---------------------------------------------------------------------------
# Job tracking
# ---------------------------------------------------------------------------

class JobState(BaseModel):
    id: str
    engine: str
    status: GenerationStatus
    request: dict
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: float
    completed_at: Optional[float] = None


_jobs: dict[str, JobState] = {}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

# Global engine references (set at startup)
_engines: dict[str, Any] = {}
_active_engine: str = ""


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load engine on startup, unload on shutdown."""
    global _active_engine
    engine_type = app.state.engine_type
    vram_budget = app.state.vram_budget
    output_dir = app.state.output_dir

    if engine_type == "yue2":
        engine = Yue2Engine(vram_budget=vram_budget, output_dir=output_dir)
    elif engine_type == "ace":
        engine = ACEngine(vram_budget=vram_budget, output_dir=output_dir)
    else:
        raise ValueError(f"Unknown engine: {engine_type}")

    _engines[engine_type] = engine
    _active_engine = engine_type
    logger.info("Starting music-gen service: engine=%s, vram=%dGB, output=%s",
                engine_type, vram_budget, output_dir)

    # Pre-load the engine
    try:
        await engine.load()
    except Exception as e:
        logger.warning("Pre-load failed (will retry on first request): %s", e)

    yield

    # Shutdown: unload engine
    for eng in _engines.values():
        try:
            await eng.unload()
        except Exception:
            pass
    logger.info("Music-gen service stopped")


def create_app(engine_type: str = "yue2", vram_budget: int = 6,
               output_dir: str = "output/music") -> FastAPI:
    app = FastAPI(
        title="Music Generation Service",
        description="Isolated GPU workload for YuE2 and ACE-Step music generation",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.engine_type = engine_type
    app.state.vram_budget = vram_budget
    app.state.output_dir = output_dir

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        engine = _engines.get(_active_engine)
        return {
            "status": "ok",
            "engine": _active_engine,
            "loaded": engine.is_loaded if engine else False,
            "vram_budget_gb": vram_budget,
        }

    @app.get("/vram")
    async def vram_status():
        """Report current VRAM usage."""
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
        """Generate a complete song."""
        engine = _engines.get(_active_engine)
        if not engine:
            raise HTTPException(503, "Engine not loaded")
        try:
            result = await engine.generate(req)
            return result
        except Exception as e:
            logger.error("Generation failed: %s", e, exc_info=True)
            raise HTTPException(500, str(e))

    @app.post("/plan")
    async def plan(req: PlanRequest):
        """Generate score only (no audio)."""
        engine = _engines.get(_active_engine)
        if not engine or _active_engine != "yue2":
            raise HTTPException(503, "Plan only available for YuE2 engine")
        try:
            result = await engine.plan(req)
            return result
        except Exception as e:
            logger.error("Plan failed: %s", e, exc_info=True)
            raise HTTPException(500, str(e))

    @app.post("/render")
    async def render(req: EditScoreRequest):
        """Render audio from edited ABC score."""
        engine = _engines.get(_active_engine)
        if not engine or _active_engine != "yue2":
            raise HTTPException(503, "Score rendering only available for YuE2 engine")
        try:
            result = await engine.render_from_score(req)
            return result
        except Exception as e:
            logger.error("Render failed: %s", e, exc_info=True)
            raise HTTPException(500, str(e))

    @app.post("/unload")
    async def unload():
        """Unload engine to free VRAM (for VRAM manager coordination)."""
        engine = _engines.get(_active_engine)
        if engine:
            await engine.unload()
            return {"status": "unloaded", "engine": _active_engine}
        return {"status": "already_unloaded"}

    @app.post("/reload")
    async def reload():
        """Reload engine after VRAM freed."""
        engine = _engines.get(_active_engine)
        if engine:
            await engine.load()
            return {"status": "loaded", "engine": _active_engine}
        return {"status": "no_engine"}

    @app.get("/audio/{output_name}")
    async def get_audio(output_name: str):
        """Download generated audio file."""
        audio_path = Path(app.state.output_dir) / output_name / "audio.flac"
        if not audio_path.exists():
            audio_path = Path(app.state.output_dir) / output_name / "audio.wav"
        if not audio_path.exists():
            raise HTTPException(404, "Audio file not found")
        return FileResponse(
            str(audio_path),
            media_type="audio/flac",
            filename=f"{output_name}.flac",
        )

    @app.get("/score/{output_name}")
    async def get_score(output_name: str):
        """Download ABC score file."""
        score_path = Path(app.state.output_dir) / output_name / "score.abc"
        if not score_path.exists():
            raise HTTPException(404, "Score file not found")
        return FileResponse(
            str(score_path),
            media_type="text/plain",
            filename=f"{output_name}.abc",
        )

    return app


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Music Generation Service")
    parser.add_argument("--port", type=int, default=8200, help="Server port")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind host")
    parser.add_argument("--engine", choices=["yue2", "ace"], default="yue2",
                        help="Music generation engine")
    parser.add_argument("--vram-budget", type=int, default=6,
                        help="VRAM budget in GB for this engine")
    parser.add_argument("--output-dir", type=str, default="output/music",
                        help="Output directory for generated files")
    args = parser.parse_args()

    import uvicorn
    app = create_app(
        engine_type=args.engine,
        vram_budget=args.vram_budget,
        output_dir=args.output_dir,
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
