"""
Remix audible preview (A3).

Extracted from stem_remixer.py. Contains ``truncate_recipe``, ``render_preview_audio``
and ``preview_recipe``. The preview is the same recipe rendered through the same mix
core, truncated to a bounded length and cached by recipe hash.
"""

from __future__ import annotations

import hashlib
import json
import math
import wave
from pathlib import Path
from typing import Any

import numpy as np

from .remix_constants import REMIX_SR
from .remix_dsp import _loop_to_length
from .remix_recipe import RemixLayer, RemixRecipe, RemixSlot, asdict
from .remix_render import RemixCancelledError, plan_timeline
from .remix_source import _probe_summary

PREVIEW_MAX_SECONDS = 30.0
PREVIEW_MAX_ENTRIES = 12


def _preview_dir() -> Path:
    from . import stem_remixer

    return stem_remixer.PREVIEW_DIR


def truncate_recipe(recipe: RemixRecipe, max_seconds: float = PREVIEW_MAX_SECONDS) -> RemixRecipe:
    """Bound a recipe's rendered length to ``max_seconds``, whole slots first.

    Whole slots stay whole -- an audition of the first three slots and a
    fade tells the user more about the arrangement than a hard cut in the
    middle of the second one. Only the final kept slot is trimmed, and its
    crossfade is clamped with it so `plan_timeline` cannot reject the
    result. Recipes that already fit are returned unchanged.
    """
    bar_seconds = recipe.bar_seconds
    if bar_seconds <= 0:
        raise ValueError("bar_seconds must be positive")
    max_bars = max(1, int(max_seconds / bar_seconds))
    kept: list[RemixSlot] = []
    total_bars = 0
    for slot in recipe.slots:
        if not slot.layers:
            continue
        remaining = max_bars - total_bars
        if remaining <= 0:
            break
        if slot.bars <= remaining:
            kept.append(slot)
            total_bars += slot.bars
            continue
        # Trim the crossing slot: at least one bar, and a crossfade that
        # fits inside both adjacent segments after the trim.
        bars = max(1, remaining)
        trimmed = RemixSlot(
            layers=list(slot.layers),
            bars=bars,
            crossfade_bars=min(
                slot.crossfade_bars, float(bars), float(kept[-1].bars) if kept else float(bars)
            ),
        )
        kept.append(trimmed)
        total_bars += bars
        break
    if not kept:
        raise ValueError("recipe renders to no playable bars")
    return RemixRecipe(
        name=recipe.name,
        target_bpm=recipe.target_bpm,
        beats_per_bar=recipe.beats_per_bar,
        key=recipe.key,
        slots=kept,
    )


def _preview_key(recipe: RemixRecipe) -> str:
    """Stable hash of everything the preview audio depends on."""
    payload = json.dumps(
        {
            "bpm": round(recipe.target_bpm, 3),
            "beats_per_bar": recipe.beats_per_bar,
            "slots": [
                {
                    "bars": slot.bars,
                    "crossfade_bars": slot.crossfade_bars,
                    "layers": [asdict(layer) for layer in slot.layers],
                }
                for slot in recipe.slots
            ],
        },
        sort_keys=True,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]  # noqa: S324 - cache key, not security


def _preview_meta_path(wav_path: Path) -> Path:
    """Sidecar JSON beside a cached excerpt, carrying what the wav cannot."""
    return wav_path.with_suffix(".json")


def _write_preview_meta(wav_path: Path, warnings: list[str]) -> None:
    """Record the mix facts that produced the excerpt.

    The written file is peak-normalised, so the pre-normalisation warnings
    cannot be recovered from it. Without the sidecar a cache hit would report
    ``warnings: []`` for a recipe whose first render warned, which is a
    different answer for the same input.
    """
    _preview_meta_path(wav_path).write_text(
        json.dumps({"warnings": warnings}), encoding="utf-8"
    )


def _read_preview_warnings(wav_path: Path) -> list[str]:
    """Warnings recorded when the excerpt was rendered; [] if unreadable."""
    try:
        data = json.loads(_preview_meta_path(wav_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return []
    return list(data.get("warnings", [])) if isinstance(data, dict) else []


def render_preview_audio(
    recipe: RemixRecipe, max_seconds: float = PREVIEW_MAX_SECONDS
) -> dict[str, Any]:
    """Render a bounded, playable excerpt of a recipe (A3).

    Returns ``{path, duration_sec, truncated, warnings}``. The result is
    cached by recipe hash, so an unchanged recipe replays from disk rather
    than re-timestretching every source. The cache holds the newest
    ``PREVIEW_MAX_ENTRIES`` excerpts and drops the rest - a preview nobody
    replays is dead weight.
    """
    _preview_dir().mkdir(parents=True, exist_ok=True)
    bounded = truncate_recipe(recipe, max_seconds)
    truncated = len(bounded.slots) != len(recipe.slots) or any(
        a.bars != b.bars for a, b in zip(bounded.slots, recipe.slots, strict=False)
    )
    key = _preview_key(bounded)
    destination = _preview_dir() / f"{key}.wav"

    if destination.exists():
        warnings = _read_preview_warnings(destination)
    else:
        import soundfile as sf

        from . import stem_remixer

        mixed, plan, warnings, _ratios = stem_remixer._mix_recipe(bounded)
        # A single stereo mixdown, peak-normalised: an audition is no use
        # if it plays back quieter than the full build would.
        mono = np.zeros(plan["total_n"], dtype=np.float32)
        for buf in mixed.values():
            mono += buf.mean(axis=0)
        peak = float(np.max(np.abs(mono))) if mono.size else 0.0
        if peak > 0:
            mono = mono / peak
        sf.write(str(destination), np.stack([mono, mono], axis=0).T, REMIX_SR, subtype="PCM_16")
        _write_preview_meta(destination, warnings)

    _prune_previews()
    return {
        "path": str(destination),
        "duration_sec": round(_wav_duration_sec(destination), 3),
        "truncated": truncated,
        "warnings": warnings,
    }


def _wav_duration_sec(path: Path) -> float:
    """Duration of a 16-bit PCM WAV from its header -- no decode needed."""
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / float(handle.getframerate())


def _prune_previews(keep: int = PREVIEW_MAX_ENTRIES) -> None:
    """Drop the oldest preview files beyond ``keep``, newest-first by mtime.

    The ``.json`` sidecar goes with its wav: leaving it behind would orphan a
    file every later run rewrites anyway.
    """
    preview_dir = _preview_dir()
    if not preview_dir.exists():
        return
    files = sorted(preview_dir.glob("*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in files[keep:]:
        for candidate in (stale, _preview_meta_path(stale)):
            try:
                candidate.unlink()
            except OSError:
                pass


def _near_silent_detail(layer: RemixLayer, rms: float, bar_seconds: float) -> dict[str, Any]:
    """Structured form of the near-silence warning.

    ``first_audible_sec`` is already measured by the probe, so the
    suggestion can name the bar to jump to instead of the vague
    "check source_start_bar" the free-text form is stuck with. An
    agent (or a UI) can act on ``code``/``field``/``suggestion`` without
    parsing prose.
    """
    first_audible = _probe_summary(layer.track).get("first_audible_sec")
    suggestion = "check source_start_bar"
    if isinstance(first_audible, (int, float)) and first_audible > 0.0 and bar_seconds > 0.0:
        bar = math.ceil(float(first_audible) / bar_seconds - 1e-9)
        suggestion = (
            f"first_audible_sec is {float(first_audible):.2f}; try source_start_bar >= {bar}"
        )
    return {
        "code": "near_silent",
        "layer_ref": f"{layer.track}/{layer.stem}",
        "field": "source_start_bar",
        "measured_rms_db": round(rms, 2),
        "suggestion": suggestion,
    }


def _masking_warnings(slot_index: int, layers: list[RemixLayer]) -> tuple[list[str], list[dict[str, Any]]]:
    """Frequency-slotting warnings (knowledge: mashup-arrangement-theory section4).

    Two layers in the same band mask each other: louder but muddier, not
    fuller. Drums are exempt -- transients poke through sustained material,
    so stacking drums is a level problem, not a masking problem.
    """
    warnings: list[str] = []
    details: list[dict[str, Any]] = []
    by_stem: dict[str, list[RemixLayer]] = {}
    for layer in layers:
        by_stem.setdefault(layer.stem, []).append(layer)
    bass = by_stem.get("bass", [])
    if len(bass) >= 2:
        refs = " + ".join(f"{lyr.track}/bass" for lyr in bass)
        warnings.append(
            f"slot {slot_index + 1}: two bass layers ({refs}) will mask each other -- "
            "keep one, or cut the other 3-6 dB"
        )
        details.append(
            {
                "code": "bass_collision",
                "layer_ref": f"slot {slot_index + 1}: {refs}",
                "field": "gain_db",
                "suggestion": "keep one bass layer; cut the other 3-6 dB or drop it",
            }
        )
    other = by_stem.get("other", [])
    if len(other) >= 2 and max(lyr.gain_db for lyr in other) - min(lyr.gain_db for lyr in other) <= 6.0:
        refs = " + ".join(f"{lyr.track}/other" for lyr in other)
        warnings.append(
            f"slot {slot_index + 1}: two 'other' stems at similar gain ({refs}) -- "
            "midrange masking likely; pull one down 3-6 dB or lowpass it (lowpass_hz)"
        )
        details.append(
            {
                "code": "midrange_masking",
                "layer_ref": f"slot {slot_index + 1}: {refs}",
                "field": "gain_db",
                "suggestion": "pull one 'other' down 3-6 dB or set lowpass_hz on it",
            }
        )
    return warnings, details


def preview_recipe(recipe: RemixRecipe) -> dict[str, Any]:
    """Resolve a recipe without rendering any audio.

    Reports the exact timeline, each source's stretch ratio and its *measured*
    level, so a caller can sanity-check an arrangement before paying for a
    render. It does load and stretch the audio (that is how the RMS is
    measured), so it is not free - it is just free of the write and the
    crossfade mixing.

    The near-silence warning exists because of a real trap: several tracks here
    open with an instrumental intro, so a layer pointing at ``source_start_bar=0``
    can be digitally silent and read as a broken mixer. It is reported twice:
    ``warnings`` stays a list of human-readable strings (existing callers), and
    ``warnings_detail`` carries the same facts structured as
    ``{code, layer_ref, field, measured_rms_db, suggestion}`` so an agent
    does not have to parse prose. Two RMS values appear in the response and
    they mean different things: ``layers[].measured_rms_db`` is the whole
    aligned source (a gain-suggestion reference), while the near-silent
    detail's ``measured_rms_db`` is the slice the slot renders from the
    layer's own ``source_start_bar`` - the one a listener actually hears.
    """
    recipe.validate()
    plan = plan_timeline(recipe)
    from . import stem_remixer

    cache = stem_remixer._SourceCache(recipe.target_bpm)
    bar_n = plan["bar_n"]
    layers: list[dict[str, Any]] = []
    warnings: list[str] = []
    warnings_detail: list[dict[str, Any]] = []
    for si, slot in enumerate(recipe.slots):
        for layer in slot.layers:
            rms = cache.measured_rms_db(layer)
            source_bpm = cache.bpm_for(layer.track)
            layers.append(
                {
                    "track": layer.track,
                    "stem": layer.stem,
                    "source_bpm": round(source_bpm, 3),
                    "measured_rms_db": round(rms, 2),
                    "stretch_ratio": round(recipe.target_bpm / max(source_bpm, 1e-9), 4),
                    "source_start_bar": layer.source_start_bar,
                }
            )
            # The near-silent check reads the slice the slot renders, not the
            # whole source: a stem that opens silently has a healthy
            # whole-file RMS and would otherwise render four bars of nothing
            # with no warning at all.
            window_rms = cache.window_rms_db(layer, slot.bars * bar_n, bar_n)
            if window_rms < -50.0:
                warnings_detail.append(_near_silent_detail(layer, window_rms, recipe.bar_seconds))
                warnings.append(
                    f"{layer.track}/{layer.stem} is near-silent at this offset "
                    f"({window_rms:.0f} dBFS) - check source_start_bar"
                )
        mw, md = _masking_warnings(si, slot.layers)
        warnings.extend(mw)
        warnings_detail.extend(md)
    return {
        "duration_sec": round(plan["total_n"] / REMIX_SR, 3),
        "total_bars": sum(slot.bars for slot in recipe.slots),
        "bar_seconds": round(recipe.bar_seconds, 4),
        "sample_rate": REMIX_SR,
        "stretch_ratios": {k: round(v, 4) for k, v in cache.stretch_ratios.items()},
        "layers": layers,
        "warnings": warnings,
        "warnings_detail": warnings_detail,
    }


__all__ = [
    "PREVIEW_DIR",
    "truncate_recipe",
    "_preview_key",
    "_preview_meta_path",
    "_write_preview_meta",
    "_read_preview_warnings",
    "render_preview_audio",
    "_wav_duration_sec",
    "_prune_previews",
    "_near_silent_detail",
    "_masking_warnings",
    "preview_recipe",
]
