"""Chiptune API — tracker-pattern chip-music renderer (T-MUS-06).

Wraps tools/chiptune.py: .chip pattern in, WAV + piano-roll preview out
under output/audio/ (Media Library contract). PREVIEW-FIRST is enforced
by offering a roll-only mode before the full render.
"""

from __future__ import annotations

import re
import sys
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..core.config import PROJECT_ROOT

router = APIRouter(prefix="/api/chiptune", tags=["Chiptune"])

_chip = None


def _load():
    """Lazy-import tools.chiptune (repo-root module, numpy/scipy deps)."""
    global _chip
    if _chip is not None:
        return _chip
    root = str(PROJECT_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        import tools.chiptune as chip
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail=f"chiptune engine unavailable: {e}",
        ) from e
    _chip = chip
    return chip


def _clean_name(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-")
    return stem or "chiptune"


def _jsonable(obj: Any) -> Any:
    """Metrics dicts carry numpy scalars — coerce for JSON encoding."""
    import numpy as np

    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    return obj


class RenderRequest(BaseModel):
    pattern: str | None = Field(
        default=None, description=".chip pattern text; omit to use the demo"
    )
    demo: bool = Field(default=False, description="use the built-in demo pattern")
    name: str = Field(default="chiptune", description="output file stem")
    system: str = Field(
        default="file", description="preset name, or 'all' for every system"
    )
    transpose: int = Field(default=0, description="semitone shift")
    tempo: float | None = Field(default=None, description="BPM override")
    preview: bool = Field(
        default=False,
        description="roll-only mode: piano-roll PNG + pattern metrics, no WAV",
    )
    loudness: float = Field(default=-20.0, description="integrated LUFS target")


@router.get("/systems")
async def list_systems() -> dict[str, Any]:
    chip = _load()
    return {
        "systems": [
            {"name": k, "label": v["label"],
             "voices": len(v["channels"])}
            for k, v in chip.SYSTEMS.items()
        ]
    }


@router.get("/demo")
async def get_demo() -> dict[str, Any]:
    chip = _load()
    return {"pattern": chip.DEMO}


@router.post("/render")
async def render_pattern(req: RenderRequest) -> dict[str, Any]:
    chip = _load()
    if req.pattern is not None:
        text = req.pattern
    elif req.demo or not req.pattern:
        text = chip.DEMO
    else:
        raise HTTPException(status_code=400, detail="provide pattern or demo=true")

    try:
        pat = chip.parse_chip(text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if req.transpose:
        chip.transpose_pattern(pat, req.transpose)
    if req.tempo:
        pat.tempo = req.tempo

    systems = (list(chip.SYSTEMS) if req.system == "all"
               else [req.system or pat.system])
    bad = [s for s in systems if s not in chip.SYSTEMS]
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"unknown system(s): {bad}; see GET /api/chiptune/systems",
        )

    name = _clean_name(req.name)
    out_dir = chip.OUT_DIR
    results = []
    errors = []
    for sysname in systems:
        try:
            if req.preview:
                # PREVIEW-FIRST: roll + pattern metrics only, no audio.
                roll_path = out_dir / f"{name}-{sysname}.roll.png"
                chip.render_roll(pat, sysname, roll_path)
                metrics = chip.pattern_report(pat, sysname)
                results.append({
                    "system": sysname,
                    "roll": str(roll_path.relative_to(PROJECT_ROOT)),
                    "metrics": _jsonable(metrics),
                })
                continue

            pcm, sr = chip.render(pat, system_name=sysname)
            pcm, loud_info = chip.normalize_loudness(pcm, sr, req.loudness)
            suffix = "" if sysname == pat.system and req.system != "all" \
                else f"-{sysname}"
            wav_path = out_dir / f"{name}{suffix}.wav"
            chip.write_wav(wav_path, pcm, sr)
            roll_path = wav_path.with_suffix(".roll.png")
            chip.render_roll(pat, sysname, roll_path)
            results.append({
                "system": sysname,
                "wav": str(wav_path.relative_to(PROJECT_ROOT)),
                "roll": str(roll_path.relative_to(PROJECT_ROOT)),
                "loudnorm": _jsonable(loud_info),
                "metrics": _jsonable(chip.pattern_report(pat, sysname)),
                "signal": _jsonable(chip.signal_report(pcm, sr)),
            })
        except Exception as e:  # noqa: BLE001 — per-system isolation
            errors.append({"system": sysname, "error": str(e)})

    return {"name": name, "preview": req.preview,
            "results": results, "errors": errors}
