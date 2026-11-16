"""Storyboard generation job handler.
Uses Ollama adapter to generate structured JSON storyboard prompts.

Step 5 S1 (R1): a board's tempo is a *measured* beat grid, never metadata.
Jobs may supply ``analysis`` (bpm + beat_times + downbeats + sections); the
generator validates the grid, derives every scene's absolute times from it,
and carries a ``bpm_conflict`` flag when library/metadata BPM disagrees.
Jobs without ``analysis`` keep the original theme-driven behavior.
"""

import bisect
import json
import re
import statistics
from datetime import datetime
from pathlib import Path
from typing import Any

from ..adapters.ollama import OllamaAdapter
from ..core.config import PROJECT_ROOT
from ..models.job import Job
from ..services.go_worker_client import write_sidecar as go_write_sidecar
from .storyboard_panels import mark_generated, stamp_planned
from .storyboard_sung_diff import diff_sung_sections, not_sung_section_names

OUTPUT_DIR = PROJECT_ROOT / "output" / "storyboards"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TRACK_LYRICS_DIR = PROJECT_ROOT / "packages" / "frontend" / "public" / "track-lyrics"

# R1: a stated BPM and the grid's implied BPM may differ by at most this much.
DEFAULT_BPM_TOLERANCE = 2.0

# S3: scene schema normalization (R3/R4). These are the only framings the
# schema accepts; anything else is dropped rather than guessed.
VALID_FRAMINGS = frozenset({"wide", "medium", "close"})

_FRAMING_ALIASES = {
    "wide": "wide",
    "wide shot": "wide",
    "long shot": "wide",
    "establishing": "wide",
    "medium": "medium",
    "medium shot": "medium",
    "mid": "medium",
    "close": "close",
    "close-up": "close",
    "close up": "close",
    "close_up": "close",
    "closeup": "close",
    "cu": "close",
}


def load_track_lyrics(track_lyrics_id: str | None) -> dict[str, Any] | None:
    """Load one track-lyrics library entry, or None when it is missing.

    The library lives in the frontend's public directory because that is the
    canonical copy the UI reads (design doc section 4). A missing file, an
    unreadable file, or a non-object payload all mean "no library data".
    """
    if not track_lyrics_id:
        return None
    path = TRACK_LYRICS_DIR / f"{track_lyrics_id}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def validate_grid(bpm: float, beat_times: list[float], downbeats: list[int]) -> dict[str, Any]:
    """Validate a supplied measured beat grid.

    Returns ``{ok, bpm, beat_count, downbeat_count, grid_sec, conflict_warnings}``
    on success and raises ``ValueError`` naming the failed check otherwise.
    A grid that does not validate must fail the job: falling back to estimated
    timing is exactly what R1 exists to prevent.
    """
    if not isinstance(beat_times, list) or len(beat_times) < 2:
        raise ValueError("invalid beat grid: beat_times must contain at least 2 beats")
    try:
        times = [float(value) for value in beat_times]
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid beat grid: beat_times must be numeric") from exc
    if any(later <= earlier for earlier, later in zip(times, times[1:], strict=False)):
        raise ValueError("invalid beat grid: beat_times must be monotonically increasing")
    if not isinstance(downbeats, list):
        raise ValueError("invalid beat grid: downbeats must be a list of beat indexes")

    downbeat_indexes: list[int] = []
    for index in downbeats:
        if isinstance(index, bool) or not isinstance(index, int):
            raise ValueError(f"invalid beat grid: downbeat index {index!r} is not an integer")
        if index < 0 or index >= len(times):
            raise ValueError(
                f"invalid beat grid: downbeat index {index} out of range (0..{len(times) - 1})"
            )
        downbeat_indexes.append(index)

    try:
        stated_bpm = float(bpm)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid beat grid: bpm must be numeric") from exc
    if stated_bpm <= 0:
        raise ValueError("invalid beat grid: bpm must be positive")

    intervals = [later - earlier for earlier, later in zip(times, times[1:], strict=False)]
    median_interval = statistics.median(intervals)
    if median_interval <= 0:
        raise ValueError("invalid beat grid: median beat interval must be positive")
    implied_bpm = 60.0 / median_interval
    if abs(implied_bpm - stated_bpm) > DEFAULT_BPM_TOLERANCE:
        raise ValueError(
            "invalid beat grid: implied BPM "
            f"{implied_bpm:.3f} differs from stated BPM {stated_bpm:.3f} "
            f"by more than {DEFAULT_BPM_TOLERANCE:g}"
        )

    return {
        "ok": True,
        "bpm": stated_bpm,
        "beat_count": len(times),
        "downbeat_count": len(downbeat_indexes),
        "grid_sec": times[-1] - times[0],
        "conflict_warnings": [],
    }


def detect_bpm_conflict(
    measured_bpm: float,
    library_bpm: float | None,
    tolerance_bpm: float = DEFAULT_BPM_TOLERANCE,
) -> bool:
    """Return True when library BPM disagrees with measured BPM beyond tolerance."""
    if library_bpm is None:
        return False
    try:
        return abs(float(measured_bpm) - float(library_bpm)) > float(tolerance_bpm)
    except (TypeError, ValueError):
        return False


def _nearest_beat_index(beat_times: list[float], seconds: float) -> int:
    """Index of the beat time closest to ``seconds``."""
    position = bisect.bisect_left(beat_times, seconds)
    if position <= 0:
        return 0
    if position >= len(beat_times):
        return len(beat_times) - 1
    before = beat_times[position - 1]
    after = beat_times[position]
    return position - 1 if (seconds - before) <= (after - seconds) else position


def derive_scene_times(sections: list[dict[str, Any]], beat_times: list[float]) -> list[dict[str, Any]]:
    """Anchor each section's start/end to the nearest measured beat.

    Emits ``start_beat`` / ``end_beat`` (grid indexes) and
    ``start_sec`` / ``end_sec`` (the exact beat times at those indexes),
    preserving every other section field.
    """
    times = [float(value) for value in beat_times]
    derived: list[dict[str, Any]] = []
    for section in sections or []:
        if not isinstance(section, dict):
            continue
        try:
            start = float(section.get("start", 0.0) or 0.0)
            end = float(section.get("end", start) or start)
        except (TypeError, ValueError):
            continue
        start_beat = _nearest_beat_index(times, start)
        end_beat = _nearest_beat_index(times, end)
        if end_beat <= start_beat and start_beat + 1 < len(times):
            # A section shorter than one beat interval would otherwise compile
            # to an empty span; keep it grid-anchored and non-degenerate.
            end_beat = start_beat + 1
        item = dict(section)
        item.update(
            {
                "start_beat": start_beat,
                "end_beat": end_beat,
                "start_sec": times[start_beat],
                "end_sec": times[end_beat],
            }
        )
        derived.append(item)
    return derived


def _library_bpm(track_lyrics_id: str | None) -> float | None:
    """Top-level ``bpm`` from the track-lyrics library entry, when present."""
    entry = load_track_lyrics(track_lyrics_id)
    if entry is None:
        return None
    raw = entry.get("bpm")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return float(raw)


def _prepare_grid(params: dict[str, Any]) -> dict[str, Any] | None:
    """Validate the job's measured grid and build the board's grid data.

    Returns None when the job carries no ``analysis`` object, which is the
    backward-compatible legacy path.
    """
    analysis = params.get("analysis")
    if not isinstance(analysis, dict):
        return None

    beat_times = analysis.get("beat_times")
    downbeats = analysis.get("downbeats", [])
    validation = validate_grid(analysis.get("bpm"), beat_times, downbeats)

    conflicts: list[str] = []
    if detect_bpm_conflict(validation["bpm"], _library_bpm(params.get("track_lyrics_id"))):
        conflicts.append("library")
    metadata_bpm = params.get("metadata_bpm")
    if (
        not isinstance(metadata_bpm, bool)
        and isinstance(metadata_bpm, (int, float))
        and detect_bpm_conflict(validation["bpm"], float(metadata_bpm))
    ):
        conflicts.append("metadata")

    sections = derive_scene_times(analysis.get("sections") or [], [float(t) for t in beat_times])
    return {
        "bpm": validation["bpm"],
        "bpm_conflict": bool(conflicts),
        "bpm_conflict_sources": conflicts,
        "grid_source": str(analysis.get("source") or "supplied"),
        "beat_times": [float(value) for value in beat_times],
        "downbeats": list(downbeats),
        "sections": sections,
    }


def _prepare_sung_filter(params: dict[str, Any]) -> dict[str, Any] | None:
    """Diff the lyric sheet against the transcript (R2), or None if incomplete.

    Both a Whisper-shaped ``transcript`` and a resolvable ``track_lyrics_id``
    are required. When either is missing the caller keeps the post-S1 behavior
    untouched: no filtering, no crash.
    """
    transcript = params.get("transcript")
    if not isinstance(transcript, dict):
        return None
    entry = load_track_lyrics(params.get("track_lyrics_id"))
    if entry is None:
        return None
    library_sections = entry.get("sections")
    if not isinstance(library_sections, list) or not library_sections:
        return None
    results = diff_sung_sections(library_sections, transcript)
    return {
        "results": results,
        "status_by_name": {item["name"]: item["status"] for item in results},
        "not_sung": not_sung_section_names(results),
    }


def _merge_grid_scenes(
    scenes: list[dict[str, Any]], sections: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Attach grid-derived timing and section identity to the LLM's scenes.

    The grid owns all timing: each scene's ``start``/``end`` are the exact
    beat times at ``start_beat``/``end_beat``. The LLM still supplies the
    descriptive fields (title, description, camera, palette).
    """
    merged: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        base = scenes[index] if index < len(scenes) and isinstance(scenes[index], dict) else {}
        scene = dict(base)
        scene.setdefault("id", f"scene-{index + 1}")
        scene.setdefault("title", str(section.get("name") or f"Scene {index + 1}"))
        scene.setdefault("description", "")
        scene["section"] = section.get("name")
        scene["start_beat"] = section["start_beat"]
        scene["end_beat"] = section["end_beat"]
        scene["start_sec"] = section["start_sec"]
        scene["end_sec"] = section["end_sec"]
        scene["start"] = section["start_sec"]
        scene["end"] = section["end_sec"]
        merged.append(scene)
    return merged


def _character_entries(raw_characters: Any) -> list[dict[str, Any]]:
    """Normalize the ``characters[]`` job param into board character data.

    Each entry needs an ``asset``; ``name`` falls back to the asset's file
    stem so a scene can name a character. ``identity_checklist`` and
    ``off_axis`` are carried through with validated types.
    """
    entries: list[dict[str, Any]] = []
    if not isinstance(raw_characters, list):
        return entries
    for item in raw_characters:
        if not isinstance(item, dict):
            continue
        asset = item.get("asset")
        if not isinstance(asset, str) or not asset.strip():
            continue
        raw_name = item.get("name")
        name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else Path(asset).stem
        checklist = item.get("identity_checklist")
        if not isinstance(checklist, list):
            checklist = []
        entries.append(
            {
                "name": name,
                "asset": asset,
                "identity_checklist": [str(value) for value in checklist if str(value).strip()],
                "off_axis": bool(item.get("off_axis", False)),
            }
        )
    return entries


def _scene_names_character(text: str, name: str) -> bool:
    if not name:
        return False
    return re.search(rf"\b{re.escape(name)}\b", text, re.IGNORECASE) is not None


def _normalize_framing(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return _FRAMING_ALIASES.get(value.strip().lower())


def _character_ref_for_scene(
    scene: dict[str, Any], characters: list[dict[str, Any]]
) -> tuple[dict[str, Any] | None, str]:
    """Derive a scene's ``character_ref`` from the board's character roster.

    Returns ``(ref, reason)``. A single-character board attaches its character
    to every character scene (a scene that names the character, or a
    medium/close coverage shot). With several characters, the scene must name
    exactly one; otherwise no ref is invented and the miss is counted.
    """
    if not characters:
        return None, "no-characters"
    text = f"{scene.get('title', '')} {scene.get('description', '')}"
    mentioned = [entry for entry in characters if _scene_names_character(text, entry["name"])]

    def as_ref(entry: dict[str, Any]) -> dict[str, Any]:
        return {
            "asset": entry["asset"],
            "identity_checklist": entry["identity_checklist"],
            "off_axis": entry["off_axis"],
        }

    if len(characters) == 1:
        framing = _normalize_framing(scene.get("framing"))
        if mentioned:
            return as_ref(characters[0]), "named"
        if framing in {"medium", "close"}:
            return as_ref(characters[0]), "single-character-framing"
        return None, "single-character-not-a-character-scene"
    if len(mentioned) == 1:
        return as_ref(mentioned[0]), "named"
    if len(mentioned) > 1:
        return None, "ambiguous-character"
    return None, "unmatched-character"


def _library_section_plan(entry: dict[str, Any] | None) -> dict[tuple[str, int], dict[str, Any]]:
    """Map ``(section name, occurrence)`` to a library section.

    Duplicate names are real (Valley Phonk has three Hooks); the Nth scene of
    a given name maps to the Nth library section of that name.
    """
    plan: dict[tuple[str, int], dict[str, Any]] = {}
    if entry is None:
        return plan
    seen: dict[str, int] = {}
    for section in entry.get("sections") or []:
        if not isinstance(section, dict):
            continue
        name = str(section.get("name") or "")
        occurrence = seen.get(name, 0)
        plan[(name, occurrence)] = section
        seen[name] = occurrence + 1
    return plan


def _apply_scene_schema(
    scenes: list[dict[str, Any]],
    library_entry: dict[str, Any] | None,
    characters: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Stamp derivable schema fields onto scenes; never trust the LLM's values.

    Derived: ``lyric_lines`` from the library section mapping, ``character_ref``
    from ``characters[]``. Normalized: ``framing`` to the schema vocabulary.
    Left absent when underivable: ``source_aspect``, ``accent``. The report
    counts what happened so a missing field is visible, not silent.
    """
    plan = _library_section_plan(library_entry)
    seen: dict[str, int] = {}
    attached = 0
    unmatched = 0
    lyric_line_refs = 0

    for scene in scenes:
        if not isinstance(scene, dict):
            continue
        # Never keep an LLM-supplied character_ref or lyric_lines: both are
        # derivable and therefore owned by this step.
        scene.pop("character_ref", None)
        scene.pop("lyric_lines", None)

        name = str(scene.get("section") or "")
        occurrence = seen.get(name, 0)
        seen[name] = occurrence + 1
        library_section = plan.get((name, occurrence))
        if library_section is not None:
            lines = library_section.get("lines") or []
            if lines:
                scene["lyric_lines"] = [
                    {"section": name, "index": index} for index in range(len(lines))
                ]
                lyric_line_refs += len(lines)

        ref, reason = _character_ref_for_scene(scene, characters)
        if ref is not None:
            scene["character_ref"] = ref
            attached += 1
        elif reason in {"ambiguous-character", "unmatched-character"}:
            unmatched += 1

        framing = _normalize_framing(scene.get("framing"))
        if framing is None:
            scene.pop("framing", None)
        else:
            scene["framing"] = framing

        source_aspect = scene.get("source_aspect")
        if not isinstance(source_aspect, str) or not source_aspect.strip():
            scene.pop("source_aspect", None)

        accent = scene.get("accent")
        if not isinstance(accent, dict) or not accent.get("type"):
            scene.pop("accent", None)

    report = {
        "scenes": len(scenes),
        "character_refs_attached": attached,
        "character_refs_unmatched": unmatched,
        "lyric_lines_attached": lyric_line_refs,
    }
    return scenes, report


def _apply_panel_images(
    scenes: list[dict[str, Any]], panel_images: dict[str, Any]
) -> tuple[list[dict[str, Any]], int, int]:
    """Move scenes whose id appears in ``panel_images`` to ``generated``.

    Returns ``(scenes, generated_count, unmatched_count)``. Unknown ids and
    empty refs are counted, never silently dropped.
    """
    scene_ids = {
        str(scene.get("id") or f"scene-{index + 1}") for index, scene in enumerate(scenes)
    }
    unmatched = sum(1 for key in panel_images if str(key) not in scene_ids)
    generated = 0
    updated: list[dict[str, Any]] = []
    for index, scene in enumerate(scenes):
        scene_id = str(scene.get("id") or f"scene-{index + 1}")
        if scene_id in panel_images:
            try:
                scene = mark_generated(scene, panel_images[scene_id])
                generated += 1
            except ValueError:
                unmatched += 1
        updated.append(scene)
    return updated, generated, unmatched


class StoryboardGeneratorHandler:
    """Handler for storyboard generation jobs using Ollama LLM."""

    def __init__(self, adapter: OllamaAdapter | None = None):
        self.adapter = adapter or OllamaAdapter()

    async def process_job(self, job: Job) -> dict[str, Any]:
        """Process a storyboard generation job."""
        params = job.params
        theme = params.get("theme", "A creative story")
        num_scenes = params.get("num_scenes", 5)
        model = params.get("model", self.adapter.get_default_model())

        grid = _prepare_grid(params)
        sung = _prepare_sung_filter(params)
        characters = _character_entries(params.get("characters"))
        raw_place_theme = params.get("place_theme")
        place_theme = raw_place_theme.strip() if isinstance(raw_place_theme, str) else None
        place_theme = place_theme or None
        prompt = theme
        if place_theme:
            prompt = f"{theme}\n\nPlace/conformance theme: {place_theme}"
        if grid:
            names = [str(section.get("name") or "") for section in grid["sections"]]
            prompt = (
                f"{theme}\n\nStoryboard exactly these sections in order: "
                + ", ".join(name for name in names if name)
            )
            num_scenes = len(grid["sections"])

        result = dict(
            await self.adapter.generate_with_fallback(
                {
                    "prompt": prompt,
                    "num_scenes": num_scenes,
                    "model": model,
                }
            )
        )

        if grid:
            scenes = _merge_grid_scenes(result.get("scenes") or [], grid["sections"])
            result["scenes"] = scenes
            result["total_scenes"] = len(scenes)
            result["bpm"] = grid["bpm"]
            result["bpm_conflict"] = grid["bpm_conflict"]
            result["bpm_conflict_sources"] = grid["bpm_conflict_sources"]
            result["grid_source"] = grid["grid_source"]
            result["beat_times"] = grid["beat_times"]
            result["downbeats"] = grid["downbeats"]
            result["sections"] = grid["sections"]
            if grid["sections"]:
                result["estimated_duration_seconds"] = grid["sections"][-1]["end_sec"]

        if sung:
            # R2: a section that was written but not sung earns no scene.
            if grid:
                for section in result["sections"]:
                    section["status"] = sung["status_by_name"].get(section.get("name"), "sung")
            else:
                result["sections"] = sung["results"]
            result["scenes"] = [
                scene
                for scene in result.get("scenes") or []
                if sung["status_by_name"].get(scene.get("section"), "sung") == "sung"
            ]
            result["total_scenes"] = len(result["scenes"])
            result["sections_not_sung"] = sung["not_sung"]
            if grid and result["scenes"]:
                result["estimated_duration_seconds"] = result["scenes"][-1]["end_sec"]

        # S3: deterministic schema pass. The LLM's scene fields are never
        # trusted where the board can derive them itself.
        library_entry = load_track_lyrics(params.get("track_lyrics_id"))
        if characters or library_entry is not None:
            result["scenes"], report = _apply_scene_schema(
                result.get("scenes") or [], library_entry, characters
            )
            result["enrichment_report"] = report
        if characters:
            result["characters"] = characters
        if place_theme:
            result["place_theme"] = place_theme

        # S4: panel lifecycle. Every board is stamped; panel_images move
        # matching scenes to generated. The LLM never owns lifecycle state.
        result["scenes"] = stamp_planned(result.get("scenes") or [])
        panel_images_supplied = isinstance(params.get("panel_images"), dict)
        if panel_images_supplied:
            scenes, generated, unmatched = _apply_panel_images(
                result["scenes"], params.get("panel_images") or {}
            )
            result["scenes"] = scenes
            result["panels_generated"] = generated
            if unmatched:
                result["panel_images_unmatched"] = unmatched

        output_files = await self.save_storyboard(job, result)

        response: dict[str, Any] = {
            "storyboard_path": output_files["storyboard"],
            "num_scenes": result.get("total_scenes", num_scenes),
            "total_duration": result.get("estimated_duration_seconds", 0),
            "model_used": result.get("model_used", model),
            "style": result.get("style", "cinematic"),
            "transitions": result.get("transitions", []),
        }
        if grid:
            response["bpm"] = grid["bpm"]
            response["bpm_conflict"] = grid["bpm_conflict"]
            response["grid_source"] = grid["grid_source"]
        if panel_images_supplied:
            response["panels_generated"] = result.get("panels_generated", 0)
        return response

    async def save_storyboard(self, job: Job, result: dict[str, Any]) -> dict[str, str]:
        """Save storyboard JSON to output folder."""
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        filename = f"{timestamp}_{job.id[:8]}"
        storyboard_path = OUTPUT_DIR / f"{filename}.json"

        storyboard_data = {
            "job_id": job.id,
            "theme": result.get("theme", ""),
            "generated_at": datetime.now().isoformat(),
            "scenes": result.get("scenes", []),
            "total_scenes": result.get("total_scenes", 0),
            "estimated_duration_seconds": result.get("estimated_duration_seconds", 0),
            "style": result.get("style", "cinematic"),
            "transitions": result.get("transitions", []),
            "model_used": result.get("model_used", "unknown"),
            "mock": result.get("mock", False),
        }

        # Grid data is present only on S1 boards; a legacy board keeps exactly
        # the ten keys above and nothing else.
        if "bpm" in result:
            storyboard_data["bpm"] = result.get("bpm")
            storyboard_data["bpm_conflict"] = result.get("bpm_conflict", False)
            storyboard_data["bpm_conflict_sources"] = result.get("bpm_conflict_sources", [])
            storyboard_data["grid_source"] = result.get("grid_source")
            storyboard_data["beat_times"] = result.get("beat_times", [])
            storyboard_data["downbeats"] = result.get("downbeats", [])
            storyboard_data["sections"] = result.get("sections", [])

        # S2 boards add sung-truth data; absent inputs leave it out entirely.
        if "sections" in result and "sections" not in storyboard_data:
            storyboard_data["sections"] = result["sections"]
        if "sections_not_sung" in result:
            storyboard_data["sections_not_sung"] = result["sections_not_sung"]

        # S3 scene-schema data is additive and only present when derivable.
        if "characters" in result:
            storyboard_data["characters"] = result["characters"]
        if "place_theme" in result:
            storyboard_data["place_theme"] = result["place_theme"]
        if "enrichment_report" in result:
            storyboard_data["enrichment_report"] = result["enrichment_report"]

        # S4 lifecycle: unmatched image ids are data, not a silent drop.
        if "panel_images_unmatched" in result:
            storyboard_data["panel_images_unmatched"] = result["panel_images_unmatched"]

        # Persist through go-worker when available; fall back to direct write.
        worker_result = await go_write_sidecar(job.id, storyboard_data, filename=filename)
        if worker_result is None or not worker_result.get("written"):
            with open(storyboard_path, "w", encoding="utf-8") as f:
                json.dump(storyboard_data, f, indent=2)

        return {"storyboard": str(storyboard_path)}

    async def generate_storyboard_direct(
        self, theme: str, model: str = "qwen2.5:3b", num_scenes: int = 5
    ) -> dict[str, Any]:
        """Generate a storyboard directly (not via job queue)."""
        return await self.adapter.generate_storyboard(theme, model, num_scenes)


default_handler = StoryboardGeneratorHandler()
