"""
Remix rendering core.

Extracted from stem_remixer.py. Contains timeline planning, slot rendering,
recipe mixing, version archiving, mix reporting and the full ``render_remix``
entry point.
"""

from __future__ import annotations

import json
import logging
import math
import shutil
from typing import TYPE_CHECKING, Any

import numpy as np
import soundfile as sf

from .remix_constants import (
    CALIBRATION_MAX_DB,
    REMIX_SR,
    VERSIONS_DIRNAME,
)
from .remix_dsp import _db_to_linear, _equal_power_ramp, _loop_to_length
from .remix_recipe import RemixRecipe, RemixResult, RemixSlot, asdict
from .remix_source import _safe_remix_name

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from .remix_source_cache import _SourceCache

logger = logging.getLogger(__name__)


class RemixCancelledError(Exception):
    """A render was cancelled between slots.

    Cooperative by construction: ``_mix_recipe`` calls the caller's cancel
    token at each slot boundary and raises before the next slot renders.
    Nothing is destructive, because the whole mix is in memory until it
    completes - see ``render_remix``, which writes nothing until
    ``_mix_recipe`` returns. A cancelled build therefore leaves the
    previous render, if any, exactly as it was.
    """


def plan_timeline(recipe: RemixRecipe) -> dict[str, Any]:
    """Resolve a recipe into exact sample counts, without rendering audio.

    Planning in samples rather than seconds matters: the write cursor and the
    output buffer length are both derived here, and rounding each to seconds
    independently is how they drift apart and leave a truncated tail.
    """
    recipe.validate()
    bar_n = max(1, int(round(recipe.bar_seconds * REMIX_SR)))
    seg_ns = [slot.bars * bar_n for slot in recipe.slots]
    xf_ns = [0]
    for i in range(1, len(recipe.slots)):
        requested = int(round(recipe.slots[i - 1].crossfade_bars * bar_n))
        xf_ns.append(max(0, min(requested, seg_ns[i - 1], seg_ns[i])))
    total_n = sum(seg_ns) - sum(xf_ns)
    if total_n < 1:
        raise ValueError("arrangement renders to zero samples")
    return {"bar_n": bar_n, "seg_ns": seg_ns, "xf_ns": xf_ns, "total_n": total_n}


def _render_slot(
    slot: RemixSlot,
    cache: _SourceCache,
    n_samples: int,
    bar_n: int,
) -> dict[str, np.ndarray]:
    """Mix one slot's layers into per-stem buffers of exactly ``n_samples``."""
    from .remix_constants import STEM_NAMES

    out = {stem: np.zeros((2, n_samples), dtype=np.float32) for stem in STEM_NAMES}
    for layer in slot.layers:
        source = cache.get(layer)
        offset = layer.source_start_bar * bar_n
        # Loop rather than truncate, so a long arrangement over a short stem
        # does not fade to silence for the remainder.
        window = _loop_to_length(source, offset + n_samples)[:, offset:]
        # Loudness staging: the calibration equalizes source masters so the
        # recipe's gain_db is relative to a common anchor, not to whoever
        # mastered loudest. Recorded per (track, stem) in the manifest.
        staged_gain = layer.gain_db + cache.calibration_db(layer.track, layer.stem)
        out[layer.stem] += window * _db_to_linear(staged_gain)
    return out


def _mix_recipe(
    recipe: RemixRecipe,
    cache: _SourceCache | None = None,
    should_cancel: Callable[[], bool] | None = None,
    progress_cb: Callable[[float, str], None] | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, int], list[str], dict[str, float]]:
    """Render a recipe's slots into per-stem buffers, in memory.

    Shared by the full render and the audible preview (A3), so a preview
    exercises the same tempo alignment, key shifting, tone shaping,
    crossfades and per-layer gains as the build it previews -- a preview
    that mixed differently would misrepresent the thing it previews.

    ``should_cancel`` is polled at each slot boundary and raises
    ``RemixCancelledError`` when it returns True. The check sits between slots
    rather than inside them, so cancellation is bounded by one slot's
    render time (seconds) while a slot itself always completes - there
    is no clean way to abort a time-stretch mid-flight.

    Returns (stems, plan, warnings, stretch_ratios); the ratios are part
    of the manifest's provenance, so they come back with the audio.
    """
    from . import stem_remixer
    from .remix_constants import STEM_NAMES

    plan = plan_timeline(recipe)
    bar_n, seg_ns, xf_ns, total_n = (plan["bar_n"], plan["seg_ns"], plan["xf_ns"], plan["total_n"])
    cache = cache or stem_remixer._SourceCache(recipe.target_bpm)
    mixed = {stem: np.zeros((2, total_n), dtype=np.float32) for stem in STEM_NAMES}

    written = 0
    previous: dict[str, np.ndarray] | None = None
    previous_n = 0
    for index, slot in enumerate(recipe.slots):
        if should_cancel is not None and should_cancel():
            raise RemixCancelledError(f"cancelled after {index} of {len(recipe.slots)} slots")
        seg_n = seg_ns[index]
        segment = _render_slot(slot, cache, seg_n, bar_n)
        xf = xf_ns[index]
        if previous is None:
            for stem in STEM_NAMES:
                mixed[stem][:, :seg_n] = segment[stem]
            written = seg_n
        else:
            fade_out, fade_in = _equal_power_ramp(xf)
            overlap_start = written - xf
            for stem in STEM_NAMES:
                mixed[stem][:, overlap_start:written] = (
                    previous[stem][:, previous_n - xf :] * fade_out
                    + segment[stem][:, :xf] * fade_in
                )
                if seg_n > xf:
                    mixed[stem][:, written : written + seg_n - xf] += segment[stem][:, xf:]
            written += seg_n - xf
        previous = segment
        previous_n = seg_n
        # Report per-slot progress (0.0 -> 1.0 across slots)
        if progress_cb is not None:
            frac = (index + 1) / len(recipe.slots)
            progress_cb(frac, f"Mixing slot {index + 1} of {len(recipe.slots)}")

    assert written == total_n, f"write cursor {written} != planned length {total_n}"

    # Consumers need plain Python ints (a manifest can hand over floats, and
    # numpy scalars leak in through the stretch maths), so normalise here
    # once. `seg_ns`/`xf_ns` are lists, so each element is converted: `int()`
    # on the list itself is a TypeError, which is exactly how this line
    # failed when `_mix_recipe` first ran.
    int_plan: dict[str, Any] = {
        key: [int(v) for v in value] if isinstance(value, list) else int(value)
        for key, value in plan.items()
    }

    # Peak warnings, shared by both paths: a caller is told before it writes.
    warnings: list[str] = []
    for stem, buf in mixed.items():
        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        if peak > 1.0:
            warnings.append(
                f"{stem} peaks at {20.0 * math.log10(peak):+.2f} dBFS before the limiter"
            )
    return mixed, int_plan, warnings, dict(cache.stretch_ratios)


def _version_dir(name: str, version: int) -> Path:
    """One archived render: `<name>/.versions/vNNN/`."""
    from . import stem_remixer

    return stem_remixer.REMIX_DIR / name / VERSIONS_DIRNAME / f"v{version:03d}"


def _archive_previous_render(out_dir: Path) -> int | None:
    """Move the current render aside as the next archived version.

    Everything except ``.versions/`` moves, so a version carries its own
    stems, manifest and ``enhanced/`` master - an archived version is a
    complete render, not a half-reference. The directory itself is
    recreated by the caller, which then writes the new render into it.

    Returns the version number the previous render was archived as, or
    None when there was nothing to archive (an empty directory) or the
    move failed. A failure to archive must not fail the render: the new
    mix is already in memory, and losing a stale archive is a smaller
    loss than losing the build the user asked for. The caller records
    the number in the manifest, so a missing version is visible rather
    than silent.
    """
    entries = [p for p in out_dir.iterdir() if p.name != VERSIONS_DIRNAME]
    if not entries:
        return None  # an empty directory is not a render; nothing to keep
    versions_root = out_dir / VERSIONS_DIRNAME
    versions_root.mkdir(parents=True, exist_ok=True)
    existing = sorted(p.name for p in versions_root.glob("v*") if p.is_dir())
    # Step over any number already taken, so a hand-created directory or
    # a partially failed archive cannot make two renders claim one slot.
    version = len(existing) + 1
    while f"v{version:03d}" in existing:
        version += 1
    destination = versions_root / f"v{version:03d}"
    destination.mkdir(parents=True, exist_ok=True)
    try:
        for entry in out_dir.iterdir():
            if entry.name == VERSIONS_DIRNAME:
                continue
            shutil.move(str(entry), str(destination / entry.name))
    except OSError:
        logger.exception("could not archive the previous render in %s", out_dir)
        return None
    return version


def build_mix_report(mixed: dict[str, np.ndarray]) -> dict[str, Any]:
    """Post-build mix report: per-stem and summed-mix loudness facts.

    For the R1 revision loop: an agent reads this instead of listening --
    per-stem integrated LUFS shows the balance ("vocals 8 dB hotter than
    drums"), true peak and the clipping flag show whether the limiter
    engaged. Measured from the clipped buffers (what is on disk); the
    clipping flag comes from the pre-clip peak (anything over 0 dBFS hit
    the limiter at write). LUFS fields are None when ffmpeg is missing;
    peak_dbfs is always measured (pure numpy).

    Resolves _ebur128_stats through the stem_remixer shim at call time, so
    tests can monkeypatch `stem_remixer._ebur128_stats`.
    """
    import math

    from . import stem_remixer

    stems: dict[str, dict[str, Any]] = {}
    mix_buf = None
    for stem, buf in mixed.items():
        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        clipped = np.clip(buf, -1.0, 1.0)
        stats = stem_remixer._ebur128_stats(clipped, REMIX_SR)
        stems[stem] = {
            "integrated_lufs": stats["integrated_lufs"],
            "true_peak_dbfs": stats["true_peak_dbfs"],
            "peak_dbfs": round(20.0 * math.log10(peak + 1e-12), 2),
            "clipping": bool(peak > 1.0),
        }
        mix_buf = clipped if mix_buf is None else mix_buf + clipped
    mix_peak = float(np.max(np.abs(mix_buf))) if mix_buf is not None and mix_buf.size else 0.0
    from . import stem_remixer

    mix_stats = (
        stem_remixer._ebur128_stats(np.clip(mix_buf, -1.0, 1.0), REMIX_SR)
        if mix_buf is not None
        else {"integrated_lufs": None, "true_peak_dbfs": None}
    )
    return {
        "stems": stems,
        "mix": {
            "integrated_lufs": mix_stats["integrated_lufs"],
            "true_peak_dbfs": mix_stats["true_peak_dbfs"],
            "peak_dbfs": round(20.0 * math.log10(mix_peak + 1e-12), 2),
            "clipping": bool(mix_peak > 1.0),
        },
    }


def render_remix(
    recipe: RemixRecipe,
    *,
    overwrite: bool = True,
    should_cancel: Callable[[], bool] | None = None,
    progress_cb: Callable[[float, str], None] | None = None,
) -> RemixResult:
    """Render a recipe to a four-stem directory under ``output/remixes/``.

    The output is a plain stem set, so it feeds the existing enhancer chain,
    ``/api/audio/stem-file`` playback and the visualizer with no special casing.

    Writing happens only after ``_mix_recipe`` returns, which is what makes
    cancellation non-destructive: ``should_cancel`` raises ``RemixCancelledError``
    during the mix, before this function touches the output directory, so a
    cancelled build leaves any previous render exactly as it was.
    """
    name = _safe_remix_name(recipe.name)
    from . import stem_remixer

    cache = stem_remixer._SourceCache(recipe.target_bpm)
    mixed, plan, warnings, stretch_ratios = stem_remixer._mix_recipe(
        recipe, cache, should_cancel, progress_cb
    )
    calibration = cache.calibration_report()
    for ref, rec in calibration.items():
        if rec["measured_lufs"] is None:
            warnings.append(
                f"{ref}: loudness calibration skipped (ffmpeg/measurement failed) -- layer renders uncalibrated"
            )
        elif rec["clamped"]:
            warnings.append(
                f"{ref}: calibration {rec['offset_db']:+.1f} dB hit the +/-{CALIBRATION_MAX_DB:.0f} dB clamp -- source is unusually quiet/loud, check the stem"
            )
    total_n = plan["total_n"]

    out_dir = stem_remixer.REMIX_DIR / name
    version = 1
    if out_dir.exists():
        if not overwrite:
            raise FileExistsError(f"Remix already exists: {out_dir}")
        # A rebuild used to delete the previous render: one mis-click on
        # Build and the mix you were A/B-ing against was gone. The prior
        # render is archived under ``.versions/`` first, so the lineage
        # survives and the current directory stays the live one.
        archived_as = _archive_previous_render(out_dir)
        if archived_as is not None:
            version = archived_as + 1
    out_dir.mkdir(parents=True, exist_ok=True)

    stems_out: dict[str, str] = {}
    for stem, buf in mixed.items():
        destination = out_dir / f"{stem}.wav"
        sf.write(str(destination), np.clip(buf, -1.0, 1.0).T, REMIX_SR, subtype="PCM_16")
        stems_out[stem] = str(destination)

    manifest = {
        "name": name,
        "version": version,
        "target_bpm": round(recipe.target_bpm, 3),
        "beats_per_bar": recipe.beats_per_bar,
        "total_bars": sum(slot.bars for slot in recipe.slots),
        "duration_sec": round(total_n / REMIX_SR, 3),
        "sample_rate": REMIX_SR,
        "key_advisory": recipe.key,
        "source_tracks": sorted({layer.track for slot in recipe.slots for layer in slot.layers}),
        "stretch_ratios": {k: round(v, 4) for k, v in stretch_ratios.items()},
        "warnings": warnings,
        "loudness_calibration_db": {ref: rec["offset_db"] for ref, rec in calibration.items()},
        "slots": [
            {
                "bars": slot.bars,
                "crossfade_bars": slot.crossfade_bars,
                "layers": [asdict(layer) for layer in slot.layers],
            }
            for slot in recipe.slots
        ],
    }
    mix_report = build_mix_report(mixed)
    manifest["mix_report"] = mix_report
    for stem, entry in mix_report["stems"].items():
        if entry["clipping"]:
            warnings.append(
                f"{stem} hits {entry['peak_dbfs']:+.1f} dBFS -- the limiter engaged; pull its layers down"
            )
    if mix_report["mix"]["clipping"]:
        warnings.append(
            f"summed mix hits {mix_report['mix']['peak_dbfs']:+.1f} dBFS -- the limiter engaged on the master"
        )
    (out_dir / "remix.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return RemixResult(
        name=name,
        directory=str(out_dir),
        stems=stems_out,
        manifest=manifest,
        duration_sec=manifest["duration_sec"],
        warnings=warnings,
        mix_report=mix_report,
    )


__all__ = [
    "RemixCancelledError",
    "plan_timeline",
    "_render_slot",
    "_mix_recipe",
    "_version_dir",
    "_archive_previous_render",
    "build_mix_report",
    "render_remix",
]
