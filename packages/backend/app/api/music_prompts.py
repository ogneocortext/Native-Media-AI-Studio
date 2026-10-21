"""Music Prompt Generator API — per-engine style prompts + lyrics via local Ollama."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import shutil
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..core.config import PROJECT_ROOT
from ..services.music_prompt_generator import (
    DEFAULT_MODEL,
    LYRIC_TECHNIQUES,
    MUSIC_PROMPT_PRESETS,
    PLATFORM_OUTPUTS,
    PLATFORM_SPECS,
    SUPPORTED_PLATFORMS,
    generate_music_prompt,
)

logger = logging.getLogger(__name__)

CREDIT_ECONOMICS_PATH = PROJECT_ROOT / "docs" / "knowledge-library" / "credit-economics-2026.json"

MAX_ANALYZE_FILE_SIZE = 100 * 1024 * 1024  # 100 MB upload cap
ANALYZE_SCRIPT = PROJECT_ROOT / "tools" / "audio-analysis" / "analyze.py"

router = APIRouter(prefix="/api/music-prompts", tags=["MusicPrompts"])


class MusicPromptBrief(BaseModel):
    theme: str = Field(..., min_length=1, max_length=2000, description="Song idea / story / scene")
    genre: str = Field("", max_length=200)
    mood: str = Field("", max_length=200)
    tempo: str = Field("", max_length=100)
    key: str = Field("", max_length=50, description="Musical key, e.g. G major / D minor (Lyria, MiniMax)")
    vocal: str = Field("", max_length=200)
    instruments: str = Field("", max_length=300)
    language: str = Field("English", max_length=50)
    dialect: str = Field("General American", max_length=100, description="Sung dialect, e.g. General American, Southern American, AAVE")
    tricky_words: str = Field("", max_length=500, description="Comma-separated words that stumbled before — model respells or replaces them")
    duration: str = Field("", max_length=100)
    extra: str = Field("", max_length=1000)
    exclude: str = Field("", max_length=300, description="Suno Exclude Styles / things to avoid")
    use_case: str = Field("", max_length=300, description="Where the track will be used (loop, film, game, …)")
    instrumental: bool = Field(False, description="No vocals: lyrics empty, prompt carries the arrangement")
    timeline: bool = Field(False, description="Lyria 3.5: timestamp [mm:ss] timeline for video scoring")
    lyric_style: str = Field("", max_length=200, description="Lyric writing style: poetic, conversational, storytelling, minimal, fragmented, narrative, or a genre like melodic rap / alt R&B / phonk / pop / drill / afrobeat / country / latin / indie folk / edm")


class MusicPromptRequest(BaseModel):
    platform: str = Field(..., description="suno_v6 | minimax_30 | happyshrimp_10 | lyria_35")
    brief: MusicPromptBrief
    model: str = DEFAULT_MODEL


class AnalyzeReferenceResponse(BaseModel):
    """Reference-track analysis for pre-filling the music-prompt form.

    Fields map from tools/audio-analysis/analyze.py output:
    tempo_bpm -> bpm, estimated_key -> key, key_confidence_r -> key_confidence,
    rms_dbfs -> lufs, band_energy_pct.sub_20_120 -> sub_share,
    stereo_width_side_mid_ratio -> stereo_width, duration_s -> duration_s.
    """

    bpm: float | None = None
    key: str | None = None
    key_confidence: float | None = None
    lufs: float | None = None
    sub_share: float | None = None
    stereo_width: float | None = None
    duration_s: float | None = None
    raw: dict[str, Any] | None = None
    error: str | None = None


@router.get("/templates")
async def get_templates() -> dict[str, Any]:
    """Return per-platform prompt specs + output sections + lyric technique reference for the frontend form.

    Includes credit notes per platform (from credit-economics-2026.json) so the
    frontend can surface scarcity/budget guidance when an engine is selected.
    """
    credit_notes: dict[str, Any] = {}
    try:
        with open(CREDIT_ECONOMICS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        providers = data.get("providers", {})
        credit_notes = {
            pid: {
                "label": prov.get("label", pid),
                "daily_credits": prov.get("daily_credits"),
                "balance_visible": prov.get("balance_visible"),
                "rollover": prov.get("rollover"),
                "strategy": prov.get("strategy"),
                "observed_cost": prov.get("observed_cost"),
            }
            for pid, prov in providers.items()
        }
    except (OSError, json.JSONDecodeError):
        credit_notes = {}

    return {
        "platforms": PLATFORM_SPECS,
        "outputs": PLATFORM_OUTPUTS,
        "default_model": DEFAULT_MODEL,
        "lyric_techniques": LYRIC_TECHNIQUES,
        "credit_notes": credit_notes,
    }


@router.get("/presets")
async def get_presets() -> dict[str, Any]:
    """Return community-proven banger presets grouped by platform.

    Each preset contains a display name, description, tags, and a
    ``form_values`` object that can be used to pre-fill the generator form.
    """
    return {
        "presets": MUSIC_PROMPT_PRESETS,
        "meta": {
            "count": sum(len(v) for v in MUSIC_PROMPT_PRESETS.values()),
            "platforms": list(MUSIC_PROMPT_PRESETS.keys()),
        },
    }


@router.post("/generate")
async def generate(req: MusicPromptRequest) -> dict[str, Any]:
    """Generate title + style + exclude + lyrics + settings for one engine.

    Response keys: title, style (main paste-box; `prompt` is a legacy alias
    with the same value), exclude (Suno Exclude Styles / MiniMax avoid;
    empty for Lyria 3.5 which has no negative prompting), lyrics (empty for
    instrumental mode), settings (sliders for Suno, audio flags for MiniMax,
    mode for HappyShrimp, model/format for Lyria), notes, warnings,
    char counts, platform, model_used, spec.
    """
    if req.platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(400, f"Unknown platform '{req.platform}'. Use one of {list(SUPPORTED_PLATFORMS)}")
    model = (req.model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    if len(model) > 100 or any(c in model for c in (";", "&", "|", "`", "$", "\n")):
        raise HTTPException(400, "Invalid model name")
    try:
        return await generate_music_prompt(
            req.platform, req.brief.model_dump(), model=model
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime Ollama failure
        logger.exception("music prompt generation failed")
        raise HTTPException(502, f"Generation failed: {exc}") from exc


@router.post("/analyze-reference")
async def analyze_reference(file: UploadFile = File(...)) -> AnalyzeReferenceResponse:
    """Analyze an uploaded reference track for BPM, key, dynamics, stereo width.

    Runs ``tools/audio-analysis/analyze.py`` in a subprocess. Keeps the analyzer
    out of the request thread: the upload streams to a temp file, the
    subprocess runs with a 120s timeout, and the response is built from its
    stdout JSON.

    Per D8 (keep heavy processing out of the request thread) and the
    music-track-stack-integration plan: on any failure (bad file, analyzer
    crash, parse error, timeout) returns a degraded response with null fields
    — never a 500. The frontend can still pre-fill the form from manual fields.
    """
    if not ANALYZE_SCRIPT.exists():
        return AnalyzeReferenceResponse(
            error="analyze script not available on this server"
        )

    # Stream upload to a temp file with a size cap.
    digest = hashlib.sha256()
    size = 0
    tmp_path = Path(tempfile.gettempdir()) / (uuid.uuid4().hex + ".upload")
    try:
        with open(tmp_path, "wb") as buffer:
            while chunk := await file.read(8192):
                size += len(chunk)
                if size > MAX_ANALYZE_FILE_SIZE:
                    return AnalyzeReferenceResponse(
                        error=(
                            f"File too large. Maximum size: "
                            f"{MAX_ANALYZE_FILE_SIZE // (1024 * 1024)} MB"
                        )
                    )
                digest.update(chunk)
                buffer.write(chunk)
    except Exception as exc:  # noqa: BLE001 - degraded path, never 500
        tmp_path.unlink(missing_ok=True)
        return AnalyzeReferenceResponse(error=f"Failed to save upload: {exc}")

    # Run the analyzer subprocess off the event loop thread.
    out_dir = Path(tempfile.mkdtemp(prefix="analyze_"))
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            str(ANALYZE_SCRIPT),
            str(tmp_path),
            str(out_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, _stderr = await asyncio.wait_for(
                proc.communicate(), timeout=120
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return AnalyzeReferenceResponse(error="Analysis timed out")

        if proc.returncode != 0:
            return AnalyzeReferenceResponse(
                error=f"Analyzer failed (exit {proc.returncode})"
            )

        try:
            res = json.loads(stdout.decode("utf-8").strip())
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            return AnalyzeReferenceResponse(
                error=f"Failed to parse analysis output: {exc}"
            )

        band_energy = res.get("band_energy_pct") or {}
        return AnalyzeReferenceResponse(
            bpm=res.get("tempo_bpm"),
            key=res.get("estimated_key"),
            key_confidence=res.get("key_confidence_r"),
            lufs=res.get("rms_dbfs"),
            sub_share=band_energy.get("sub_20_120"),
            stereo_width=res.get("stereo_width_side_mid_ratio"),
            duration_s=res.get("duration_s"),
            raw=res,
        )
    except Exception as exc:  # noqa: BLE001 - degraded path, never 500
        return AnalyzeReferenceResponse(error=f"Analysis error: {exc}")
    finally:
        tmp_path.unlink(missing_ok=True)
        shutil.rmtree(out_dir, ignore_errors=True)
