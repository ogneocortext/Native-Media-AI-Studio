"""Music Prompt Generator API — per-engine style prompts + lyrics via local Ollama."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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


@router.get("/templates")
async def get_templates() -> dict[str, Any]:
    """Return per-platform prompt specs + output sections + lyric technique reference for the frontend form."""
    return {
        "platforms": PLATFORM_SPECS,
        "outputs": PLATFORM_OUTPUTS,
        "default_model": DEFAULT_MODEL,
        "lyric_techniques": LYRIC_TECHNIQUES,
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
