"""Stem remixing / mashup endpoints, split out of app/api/audio.py.

Owns: /api/audio/remix/*.

Split out for the same reason audio_stems.py and audio_edit.py were (D15): the
audio surface is several responsibilities, and a new one belongs in the module
that matches it rather than defaulted into audio.py. This one is remixing, which
is neither separation nor file editing.

Routing note that actually bites: `main.py` must register this router or every
route here vanishes silently, because OpenAPI is generated from decorators and
never runs a handler body. `tools/snapshot-audio-routes.py --check` guards the
surface but cannot catch the missing include.

The service layer (`services/stem_remixer.py`) does the DSP; this module only
translates HTTP to dataclasses and back.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import stem_remixer
from ..services.stem_remixer import RemixLayer, RemixRecipe, RemixSlot

logger = logging.getLogger(__name__)

# Same prefix and tag as the other audio routers: main.py includes all of them,
# so /api/audio paths stay uniform wherever a route lives.
router = APIRouter(prefix="/api/audio/remix", tags=["Audio"])


class RemixLayerRequest(BaseModel):
    track: str
    stem: str
    gain_db: float = 0.0
    # Explicit because key detection is unreliable on this material; see the
    # service module docstring for the measurements.
    key_shift_semitones: float = 0.0
    source_start_bar: int = Field(default=0, ge=0)


class RemixSlotRequest(BaseModel):
    layers: list[RemixLayerRequest]
    bars: int = Field(default=8, ge=1, le=256)
    crossfade_bars: float = Field(default=2.0, ge=0.0, le=32.0)


class RemixRecipeRequest(BaseModel):
    name: str
    target_bpm: float = Field(ge=40.0, le=240.0)
    slots: list[RemixSlotRequest] = Field(min_length=1, max_length=64)
    beats_per_bar: int = Field(default=4, ge=1, le=16)
    key: str | None = None
    overwrite: bool = True


class RemixPreviewResponse(BaseModel):
    duration_sec: float
    total_bars: int
    bar_seconds: float
    sample_rate: int
    stretch_ratios: dict[str, float]
    layers: list[dict]
    warnings: list[str] = []


class RemixBuildResponse(BaseModel):
    name: str
    directory: str
    stems: dict[str, str]
    duration_sec: float
    manifest: dict
    warnings: list[str] = []


def _to_recipe(body: RemixRecipeRequest) -> RemixRecipe:
    return RemixRecipe(
        name=body.name,
        target_bpm=body.target_bpm,
        beats_per_bar=body.beats_per_bar,
        key=body.key,
        slots=[
            RemixSlot(
                bars=slot.bars,
                crossfade_bars=slot.crossfade_bars,
                layers=[
                    RemixLayer(
                        track=layer.track,
                        stem=layer.stem,
                        gain_db=layer.gain_db,
                        key_shift_semitones=layer.key_shift_semitones,
                        source_start_bar=layer.source_start_bar,
                    )
                    for layer in slot.layers
                ],
            )
            for slot in body.slots
        ],
    )


@router.get("/sources")
async def remix_sources() -> dict:
    """Tracks that have separated stems, with per-stem availability.

    Cheap by construction (a path query, no decoding) so a UI can call it to
    populate pickers without waiting on demucs.
    """
    return {"sources": stem_remixer.list_stem_sources()}


@router.get("/probe/{track}")
async def remix_probe(track: str) -> dict:
    """Tempo and advisory key for one track.

    `key_confident` is reported rather than acted on: chroma flatness measured
    0.978-0.998 on this library, so the detected key is noise.
    """
    try:
        return await asyncio.to_thread(stem_remixer.probe_track, track)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/preview", response_model=RemixPreviewResponse)
async def remix_preview(body: RemixRecipeRequest) -> RemixPreviewResponse:
    """Resolve a recipe without rendering.

    Reports the exact timeline, each source's stretch ratio and measured level,
    so a caller can sanity-check the arrangement before paying for a render
    (a four-stem two-slot render measured 7-23 s depending on cache warmth).
    """
    try:
        recipe = _to_recipe(body)
        recipe.validate()
        data = await asyncio.to_thread(stem_remixer.preview_recipe, recipe)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return RemixPreviewResponse(**data)


@router.post("/build", response_model=RemixBuildResponse)
async def remix_build(body: RemixRecipeRequest) -> RemixBuildResponse:
    """Render a recipe to a four-stem directory under `output/remixes/`.

    The result is a normal stem set, so `/api/audio/enhance-stems` and the
    enhancer chain accept it with no special handling.
    """
    try:
        recipe = _to_recipe(body)
        recipe.validate()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = await asyncio.to_thread(
            stem_remixer.render_remix, recipe, body.overwrite
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return RemixBuildResponse(
        name=result.name,
        directory=result.directory,
        stems=result.stems,
        duration_sec=result.duration_sec,
        manifest=result.manifest,
        warnings=result.warnings,
    )
