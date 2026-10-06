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
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..services import essentia_tempo_store, remix_jobs, stem_remixer
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
    # Same facts as `warnings`, structured as
    # {code, layer_ref, field, measured_rms_db, suggestion} so
    # an agent can act on them without parsing prose.
    warnings_detail: list[dict] = []


class RemixBuildResponse(BaseModel):
    """Shape of a finished build - the job's `result` on `done`."""

    name: str
    directory: str
    stems: dict[str, str]
    duration_sec: float
    manifest: dict
    warnings: list[str] = []


class RemixJobAccepted(BaseModel):
    """Acknowledgement for a long-running remix operation.

    `/build` and `/enhance` return this immediately and run the
    work in a background job (see `services/remix_jobs.py`); the
    client polls `GET /api/audio/remix/jobs/{job_id}` for the
    result. The full payload is the job's `result` field once
    `state` is `done`.
    """

    job_id: str
    kind: str
    label: str
    state: str


class TempoRefreshRequest(BaseModel):
    """Which tracks to measure. Omit to refresh every track with stems on disk."""

    tracks: list[str] | None = None


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


@router.get("/tempo/status")
async def remix_tempo_status() -> dict:
    """Which tracks have a cached Essentia tempo, and the latest refresh job.

    Cheap: reads a JSON file and in-memory job state, never WSL. This is what the
    UI polls while a refresh runs.
    """
    return essentia_tempo_store.store_status()


@router.post("/tempo/refresh")
async def remix_tempo_refresh(body: TempoRefreshRequest) -> dict:
    """Start a background Essentia refresh. Returns immediately with a job id.

    Deliberately asynchronous. The measured batch over the library is ~31 s, so
    calling this synchronously would hold the request open for half a minute; the
    client polls `/tempo/status` instead. A refresh already in flight is reported
    back rather than queued, because concurrent batches contend for the same WSL
    venv and both get slower.
    """
    tracks = body.tracks or [s["track"] for s in stem_remixer.list_stem_sources()]
    return essentia_tempo_store.start_refresh(tracks)


@router.get("/by-track/{track}")
async def remix_by_track(track: str) -> dict:
    """What exists for one track: the mashups that consumed it, and how.

    This is the provenance view. A mashup may draw on several tracks, so it is
    returned for each of them with `role` recording whether the track was the
    primary source or a contributor -- a shared mashup is real for both tracks and
    hiding it would make it look like it belonged to whichever was listed first.

    Each entry carries a `recipe` reconstructed from its manifest, which is what
    makes "reopen and rearrange" possible: the manifest already records every
    slot, layer, gain, key shift and source offset, so the arrangement can be
    reloaded and rebuilt rather than re-derived by hand.

    Deliberately offers no "similar tracks" ranking. Measured on this library,
    librosa's tempo estimate is grid-quantised and octave-aliased and chroma
    fails a white-noise control, so any similarity ordering would be presenting
    noise as a recommendation. See
    docs/knowledge-library/track-similarity-measurement-2026.md.
    """
    try:
        stem_remixer._safe_track_name(track)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "track": track,
        "remixes": await asyncio.to_thread(stem_remixer.list_remixes_for_track, track),
    }


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


@router.get("/list")
async def remix_list() -> dict:
    """Rendered remixes, read back from the manifests written at render time."""
    return {"remixes": await asyncio.to_thread(stem_remixer.list_remixes)}


class RemixEnhanceRequest(BaseModel):
    """Optional overrides; anything omitted uses the enhancer's own defaults."""
    target_peak_dbfs: float = -1.0
    master_ceiling_dbfs: float = -1.0
    pre_highpass_hz: float | None = None
    vocal_balance_db: float = 0.0
    output_format: str = "wav"


class RemixEnhanceResponse(BaseModel):
    """Shape of a finished enhance - the job's `result` on `done`."""

    name: str
    output_dir: str
    wav_path: str | None = None
    mp3_path: str | None = None
    duration_sec: float = 0.0
    steps: list[dict] = []
    error: str | None = None


@router.post("/{name}/enhance", response_model=RemixJobAccepted)
async def remix_enhance(
    name: str, body: RemixEnhanceRequest | None = None
) -> RemixJobAccepted:
    """Run the Suno master chain over an already-rendered remix.

    This exists because `/api/audio/enhance-stems` cannot be used for a remix:
    that route takes a *library* filename, resolves it under `output/audio/`, and
    then finds that file's stems. A remix lives at `output/remixes/<name>/`, so
    both attempts return 404 - verified, not assumed. The enhancer *service*
    takes a stem directory and works unchanged, so this route is a thin bridge.

    Returns a job id immediately and masters in the background: the chain is
    CPU bound and measured at ~60 s, so running it inline held the request
    open and put a 600 s timeout on the client. Poll
    `GET /api/audio/remix/jobs/{job_id}`; the enhance response (output
    paths, steps, duration) is the job's `result` once `state` is `done`.

    Everything that can fail fast - the name, the missing directory (404),
    the missing stems (409) - is checked synchronously, so a job that
    starts is a job that has work to do.
    """
    opts = body or RemixEnhanceRequest()
    try:
        directory = stem_remixer.remix_dir(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not directory.is_dir():
        raise HTTPException(status_code=404, detail=f"Remix not found: {name}")

    missing = [s for s in ("vocals", "drums", "bass", "other")
               if not (directory / f"{s}.wav").exists()]
    if missing:
        raise HTTPException(
            status_code=409,
            detail=f"Remix {name} is missing stems: {', '.join(missing)}",
        )

    from ..services.suno_enhancer import EnhanceConfig
    from ..services.suno_enhancer import enhance_stems as run_chain

    kwargs: dict[str, object] = {
        "target_peak_dbfs": opts.target_peak_dbfs,
        "master_ceiling_dbfs": opts.master_ceiling_dbfs,
        "vocal_balance_db": opts.vocal_balance_db,
        "output_format": opts.output_format,
    }
    if opts.pre_highpass_hz is not None:
        # None means "use the chain's default". Passing the 120 Hz the frontend
        # used to hard-code is the mistake worth avoiding - see suno_enhancer.
        kwargs["pre_highpass_hz"] = opts.pre_highpass_hz
    config = EnhanceConfig(**kwargs)

    output_dir = directory / "enhanced"

    def work() -> dict[str, object]:
        # `enhance_stems` is a coroutine that offloads its own per-stem
        # DSP with asyncio.to_thread internally, so it needs an event
        # loop; the job runs in a plain thread, hence asyncio.run here.
        result = asyncio.run(run_chain(directory, output_dir, config))
        # EnhanceResult carries no duration (success/output_dir/wav_path/
        # mp3_path/steps/error), so take it from the remix manifest
        # written at render time.
        duration = 0.0
        try:
            manifest = json.loads(
                (directory / "remix.json").read_text(encoding="utf-8")
            )
            duration = float(manifest.get("duration_sec", 0.0))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            logger.debug("could not read remix manifest for %s", name)
        return RemixEnhanceResponse(
            name=name,
            output_dir=str(output_dir),
            wav_path=result.wav_path,
            mp3_path=result.mp3_path,
            duration_sec=duration,
            steps=result.steps,
            error=result.error,
        ).model_dump()

    job = remix_jobs.start_job("enhance", name, work)
    return RemixJobAccepted(
        job_id=job["job_id"],
        kind=job["kind"],
        label=job["label"],
        state=job["state"],
    )


@router.get("/jobs")
async def remix_jobs_list() -> dict:
    """Recent build/enhance jobs, newest first.

    An overview for a jobs view; `GET /jobs/{job_id}` is the
    per-job status a poller wants.
    """
    return {"jobs": remix_jobs.latest_jobs()}


@router.get("/jobs/{job_id}")
async def remix_job(job_id: str) -> dict:
    """Status of one build/enhance job, including its result.

    `state` is queued | running | done | failed. On `done`,
    `result` holds the response the synchronous endpoint used
    to return (the build payload or the enhance payload); on
    `failed`, `error` carries the exception. A job past
    `JOB_TIMEOUT_SEC` is reported as failed with `timed_out`
    set even though its thread may still be running, so a
    poller always gets a terminal answer.
    """
    job = remix_jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown remix job: {job_id}")
    return job


@router.post("/build", response_model=RemixJobAccepted)
async def remix_build(body: RemixRecipeRequest) -> RemixJobAccepted:
    """Render a recipe to a four-stem directory under `output/remixes/`.

    Returns a job id immediately and renders in the background: the
    measured render is 7-23 s, which is far too long to hold a request
    open, and a synchronous call put a 300 s timeout on the client for
    no benefit. Poll `GET /api/audio/remix/jobs/{job_id}`; the build
    response (name, stems, manifest, warnings) is the job's `result`
    once `state` is `done`.

    The result is a plain stem set, so the enhancer *service* accepts it
    unchanged - but `/api/audio/enhance-stems` does not, because that
    route resolves a library filename under `output/audio/`. Use
    `POST /api/audio/remix/{name}/enhance` to master a rendered remix.

    Validation and the two conditions a render would only hit after
    minutes of stretching - a missing source stem (404) and a name
    collision with `overwrite` off (409) - are pure path checks, so
    they run synchronously here and fail fast rather than inside the
    job, where the caller could only see them as a generic failure.
    """
    try:
        recipe = _to_recipe(body)
        recipe.validate()
        for slot in recipe.slots:
            for layer in slot.layers:
                stem_remixer.resolve_stem_path(layer.track, layer.stem)
        if not body.overwrite and stem_remixer.remix_dir(recipe.name).exists():
            raise FileExistsError(f"Remix already exists: {recipe.name}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    def work() -> dict[str, object]:
        result = stem_remixer.render_remix(recipe, body.overwrite)
        # Constructed through the response model so the payload a
        # client reads from the job is the same shape the endpoint
        # used to enforce, validated rather than assumed.
        return RemixBuildResponse(
            name=result.name,
            directory=result.directory,
            stems=result.stems,
            duration_sec=result.duration_sec,
            manifest=result.manifest,
            warnings=result.warnings,
        ).model_dump()

    job = remix_jobs.start_job("build", body.name, work)
    return RemixJobAccepted(
        job_id=job["job_id"],
        kind=job["kind"],
        label=job["label"],
        state=job["state"],
    )


@router.get("/{name}/file/{which}")
async def remix_file(name: str, which: str):
    """Stream a rendered remix so it can actually be listened to.

    Without this the whole feature is silent: a remix lands in
    `output/remixes/<name>/`, which no other route serves, and
    `/api/audio/file/...` resolves under `output/audio/`. `which` is one of the
    four stem names or `master`, which returns the enhanced mix when one has
    been rendered and explains how to make it otherwise.

    Range requests are left to Starlette's FileResponse, so the browser can
    seek instead of buffering the whole file.
    """
    if which not in {"vocals", "drums", "bass", "other", "master"}:
        raise HTTPException(
            status_code=400,
            detail="which must be vocals|drums|bass|other|master",
        )
    try:
        directory = stem_remixer.remix_dir(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not directory.is_dir():
        raise HTTPException(status_code=404, detail=f"Remix not found: {name}")

    if which == "master":
        enhanced = directory / "enhanced"
        candidates = (
            sorted(enhanced.glob("*_enhanced.wav")) if enhanced.is_dir() else []
        )
        if not candidates:
            raise HTTPException(
                status_code=404,
                detail=(
                    "No enhanced master for this remix yet - run "
                    f"POST /api/audio/remix/{name}/enhance first, or fetch a stem"
                ),
            )
        return FileResponse(str(candidates[0]), media_type="audio/wav")

    path = directory / f"{which}.wav"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Stem {which!r} not present in remix {name!r}",
        )
    return FileResponse(str(path), media_type="audio/wav")
