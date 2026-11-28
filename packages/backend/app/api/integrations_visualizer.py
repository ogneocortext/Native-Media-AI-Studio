"""
AI Visualizer preset generation routes.

Natural-language -> JSON visualizer preset generation (Ollama and Atomic Chat)
plus persisted-preset CRUD. Mounted under /api/integrations by main.py.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..adapters.registry import adapter_registry
from ..core.config import config
from ..core.database import (
    get_all_visualization_presets,
    get_db,
    get_visualization_preset,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Integrations-Visualizer"])


class GenerateVisualizerPresetRequest(BaseModel):
    """Request for generating a visualizer preset from natural language."""

    description: str
    model: str | None = None
    temperature: float = 0.7
    track: dict | None = None


VISUALIZER_PRESET_SCHEMA = {
    "version": "1.0",
    "id": "string - unique preset id (kebab-case)",
    "name": "string - short display name",
    "description": "string - one sentence describing the look",
    "tags": ["string - mood/genre tags"],
    "theme": {
        "primary": "hex color - main mesh/particle color",
        "secondary": "hex color - accent color",
        "accent": "hex color - highlight color",
        "background": "hex color - scene background",
        "text": "hex color - lyric text color",
        "glow": "hex color - glow/emissive color",
    },
    "visualizer": {
        "style": "one of: particles, waveform, pulse, bars, galaxy, terrain",
        "colors": "one of: neon, fire, ocean, forest, sunset, monochrome, custom",
        "intensity": "number 0-1 - overall effect intensity",
        "particleCount": "number 0-2000 - particle count",
        "speed": "number 0-3 - animation speed multiplier",
        "scale": "number 0.1-3 - base scale",
        "glow": "boolean - enable glow effects",
        "rotation": "boolean - enable auto-rotation",
    },
    "camera": {
        "keyframes": [
            {
                "at": "number - seconds",
                "position": [0, 0, 0],
                "target": [0, 0, 0],
                "easing": "linear|easeIn|easeOut|easeInOut",
            }
        ],
        "mode": "orbit|fixed|flythrough|handheld",
        "fov": "number 30-90 - field of view",
    },
    "postfx": {
        "bloom": "number 0-3 - bloom intensity",
        "bloomRadius": "number 0-1",
        "bloomThreshold": "number 0-1",
        "chromaticAberration": "number 0-0.01",
        "filmGrain": "number 0-1",
        "vignetteRadius": "number 0-3",
        "vignetteStrength": "number 0-1",
        "glitch": "number 0-1",
        "sharpen": "number 0-1",
    },
    "lyrics": {
        "style": "kinetic|fade|typewriter|glitch|neon|bounce",
        "glowIntensity": "number 0-1",
        "fontSize": "number 24-96",
        "fontWeight": "number 100-900",
        "letterSpacing": "number 0-0.2",
        "beatReact": "boolean",
        "enterAnimation": "string",
        "exitAnimation": "string",
    },
    "audioReactivity": {
        "bass": "none|scale|glow|shake|pulse|zoom",
        "mid": "none|scale|glow|shake|pulse|zoom",
        "treble": "none|scale|glow|shake|pulse|zoom",
        "beat": "none|pulse|shake|flash|zoom",
        "beatDecay": "number 0-1",
        "smoothing": "number 0-1",
    },
}

# Proper JSON Schema for Ollama's `format` parameter (constrained decoding).
# Passed as `format` to Ollama's /api/generate so token generation is
# constrained to match this shape -- far more reliable than format="json".
VISUALIZER_PRESET_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "string"},
        "id": {"type": "string"},
        "name": {"type": "string"},
        "description": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "theme": {
            "type": "object",
            "properties": {
                "primary": {"type": "string"},
                "secondary": {"type": "string"},
                "accent": {"type": "string"},
                "background": {"type": "string"},
                "text": {"type": "string"},
                "glow": {"type": "string"},
            },
            "required": ["primary", "secondary", "accent", "background", "text", "glow"],
        },
        "visualizer": {
            "type": "object",
            "properties": {
                "style": {
                    "type": "string",
                    "enum": ["particles", "waveform", "pulse", "bars", "galaxy", "terrain"],
                },
                "colors": {"type": "string"},
                "intensity": {"type": "number", "minimum": 0, "maximum": 1},
                "particleCount": {"type": "integer", "minimum": 50, "maximum": 2000},
                "speed": {"type": "number", "minimum": 0, "maximum": 3},
                "scale": {"type": "number", "minimum": 0.1, "maximum": 3},
                "glow": {"type": "boolean"},
                "rotation": {"type": "boolean"},
            },
            "required": [
                "style",
                "colors",
                "intensity",
                "particleCount",
                "speed",
                "scale",
                "glow",
                "rotation",
            ],
        },
        "camera": {
            "type": "object",
            "properties": {
                "keyframes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "at": {"type": "number"},
                            "position": {
                                "type": "array",
                                "items": {"type": "number"},
                                "minItems": 3,
                                "maxItems": 3,
                            },
                            "target": {
                                "type": "array",
                                "items": {"type": "number"},
                                "minItems": 3,
                                "maxItems": 3,
                            },
                            "easing": {
                                "type": "string",
                                "enum": ["linear", "easeIn", "easeOut", "easeInOut"],
                            },
                        },
                        "required": ["at", "position", "target", "easing"],
                    },
                },
                "mode": {"type": "string", "enum": ["orbit", "fixed", "flythrough", "handheld"]},
                "fov": {"type": "number", "minimum": 30, "maximum": 90},
            },
            "required": ["keyframes", "mode", "fov"],
        },
        "postfx": {
            "type": "object",
            "properties": {
                "bloom": {"type": "number", "minimum": 0, "maximum": 3},
                "bloomRadius": {"type": "number", "minimum": 0, "maximum": 1},
                "bloomThreshold": {"type": "number", "minimum": 0, "maximum": 1},
                "chromaticAberration": {"type": "number", "minimum": 0, "maximum": 0.01},
                "filmGrain": {"type": "number", "minimum": 0, "maximum": 1},
                "vignetteRadius": {"type": "number", "minimum": 0, "maximum": 3},
                "vignetteStrength": {"type": "number", "minimum": 0, "maximum": 1},
                "glitch": {"type": "number", "minimum": 0, "maximum": 1},
                "sharpen": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": [
                "bloom",
                "bloomRadius",
                "bloomThreshold",
                "chromaticAberration",
                "filmGrain",
                "vignetteRadius",
                "vignetteStrength",
                "glitch",
                "sharpen",
            ],
        },
        "lyrics": {
            "type": "object",
            "properties": {
                "style": {
                    "type": "string",
                    "enum": ["kinetic", "fade", "typewriter", "glitch", "neon", "bounce"],
                },
                "glowIntensity": {"type": "number", "minimum": 0, "maximum": 1},
                "fontSize": {"type": "number", "minimum": 24, "maximum": 96},
                "fontWeight": {"type": "number", "minimum": 100, "maximum": 900},
                "letterSpacing": {"type": "number", "minimum": 0, "maximum": 0.2},
                "beatReact": {"type": "boolean"},
                "enterAnimation": {"type": "string"},
                "exitAnimation": {"type": "string"},
            },
            "required": [
                "style",
                "glowIntensity",
                "fontSize",
                "fontWeight",
                "letterSpacing",
                "beatReact",
                "enterAnimation",
                "exitAnimation",
            ],
        },
        "audioReactivity": {
            "type": "object",
            "properties": {
                "bass": {
                    "type": "string",
                    "enum": ["none", "scale", "glow", "shake", "pulse", "zoom"],
                },
                "mid": {
                    "type": "string",
                    "enum": ["none", "scale", "glow", "shake", "pulse", "zoom"],
                },
                "treble": {
                    "type": "string",
                    "enum": ["none", "scale", "glow", "shake", "pulse", "zoom"],
                },
                "beat": {"type": "string", "enum": ["none", "pulse", "shake", "flash", "zoom"]},
                "beatDecay": {"type": "number", "minimum": 0, "maximum": 1},
                "smoothing": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": ["bass", "mid", "treble", "beat", "beatDecay", "smoothing"],
        },
    },
    "required": [
        "version",
        "id",
        "name",
        "description",
        "tags",
        "theme",
        "visualizer",
        "camera",
        "postfx",
        "lyrics",
        "audioReactivity",
    ],
}

VISUALIZER_SYSTEM_PROMPT = """You are a music visualizer preset generator. Given a natural language description of a visual style, generate a JSON preset for a 3D audio-reactive visualizer.
RULES:
- Output ONLY valid JSON matching the JSON Schema below -- no markdown fences, no explanation, no extra text
- All hex colors must be 6-digit format like #ff0040
- Choose visualization styles that match the mood described
- For dark/moody: use particles, waveform, cosmic with low intensity
- For energetic/aggressive: use bars, pulse, galaxy with high intensity
- For calm/peaceful: use waveform, terrain with low speed
- Match audio reactivity to the described energy level
- Fill in ALL required fields from the schema; do not omit optional fields
- The output will be validated against this schema -- invalid JSON or missing required fields will be rejected

JSON SCHEMA (grounding -- match this structure exactly):
{schema_json}

Respond with ONLY the JSON object."""


async def _generate_visualizer_preset(
    adapter, body: GenerateVisualizerPresetRequest, backend_name: str
) -> dict:
    """Shared visualizer preset generation logic (Ollama / Atomic Chat).

    Both adapters return a compatible {"response", "model", "done"} shape,
    so the same prompt, JSON parsing and persistence path works for either
    backend. Atomic Chat's generate() now forwards format/think so JSON
    mode (format="json") and thinking disable (think=False) work.
    """
    description = body.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="Description is required")
    model = body.model or config.default_model
    temperature = body.temperature
    track_meta = body.track or {}
    bpm = track_meta.get("bpm")
    energy = track_meta.get("energy")
    duration = track_meta.get("duration_seconds")
    genre = track_meta.get("genre", "")
    adapter.set_activity(model, "visualizer", description[:80])
    track_context = ""
    if bpm or energy or duration or genre:
        parts = []
        if genre:
            parts.append(f"genre: {genre}")
        if bpm:
            parts.append(f"tempo: {bpm} BPM")
        if energy is not None:
            energy_label = "high" if energy > 0.6 else "low" if energy < 0.35 else "medium"
            parts.append(f"energy: {energy_label} ({energy:.2f})")
        if duration:
            parts.append(f"duration: {duration:.0f}s")
        track_context = "\n\nTRACK CONTEXT (adapt the preset to match this music):\n" + "\n".join(
            f"- {p}" for p in parts
        )
        track_context += (
            "\n\n- Scale animation speed to the BPM (faster tempo -> quicker transitions)"
        )
        track_context += (
            "\n- Match intensity to the energy level (high energy -> more particles, faster motion)"
        )
        track_context += "\n- Set camera keyframe 'at' times to fit within the track duration"
        if energy is not None:
            if energy > 0.6:
                track_context += (
                    "\n- Use high-intensity audio reactivity (shake, flash, zoom on beat)"
                )
            elif energy < 0.35:
                track_context += "\n- Use gentle reactivity (slow pulse, glow, no shake)"
    logger.info(
        "Generating visualizer preset: backend=%s, model=%s, desc_len=%d, track=%s",
        backend_name,
        model,
        len(description),
        bool(track_context),
    )
    try:
        # Ollama supports JSON Schema in `format` for constrained decoding
        # (token-by-token enforcement of the schema shape). Atomic Chat only
        # guarantees format="json" string mode.
        fmt_param = VISUALIZER_PRESET_JSON_SCHEMA if backend_name == "ollama" else "json"
        # Ground the model by including the schema in the system prompt text
        system_prompt_grounded = VISUALIZER_SYSTEM_PROMPT.format(
            schema_json=json.dumps(VISUALIZER_PRESET_JSON_SCHEMA, indent=2)
        )
        result = await adapter.generate(
            {
                "prompt": f"Generate a visualizer preset for: {description}{track_context}",
                "model": model,
                "system": system_prompt_grounded,
                "format": fmt_param,
                "think": False,
                "options": {
                    "temperature": temperature,
                    "num_ctx": 8192,
                },
            }
        )
        response_text = result.get("response", "")
        if not response_text:
            raise HTTPException(status_code=502, detail=f"{backend_name} returned empty response")
        try:
            preset = json.loads(response_text)
        except json.JSONDecodeError:
            from ..core.text import strip_code_fences

            preset = json.loads(strip_code_fences(response_text))
        preset.setdefault("version", "1.0")
        if not preset.get("id"):
            preset["id"] = "ai-generated"
        if not preset.get("name"):
            preset["name"] = "AI Generated"
        preset.setdefault("tags", [])
        preset.setdefault("description", description)
        try:
            from ..core.database import save_visualization_preset

            track_hash = hashlib.md5(
                f"{description}{bpm}{energy}{genre}".encode()
            ).hexdigest()[:16]
            track_name = track_meta.get("track_name") or description[:60]
            save_visualization_preset(
                {
                    "track_name": track_name,
                    "track_hash": track_hash,
                    "preset_name": preset.get("name", "AI Generated"),
                    "visualization_style": preset.get("visualizer", {}).get(
                        "style", preset.get("style", "geometric")
                    ),
                    "params": preset,
                    "ollama_model": result.get("model", model),
                    "prompt": description,
                    "lyrics": track_meta.get("lyrics", ""),
                    "bpm": bpm or 120,
                    "energy_level": (
                        "high"
                        if (energy or 0) > 0.6
                        else "low"
                        if (energy or 0) < 0.35
                        else "medium"
                    ),
                    "mood_tags": preset.get("tags", []),
                    "genre_tags": [genre] if genre else [],
                }
            )
            out_dir = Path(__file__).resolve().parents[4] / "storage" / "visualizer_presets"
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{track_hash}.json").write_text(
                json.dumps(preset, indent=2), encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"Failed to persist visualizer preset: {e}")
        return {
            "success": True,
            "preset": preset,
            "model": result.get("model", model),
            "persisted": True,
        }
    except json.JSONDecodeError as e:
        logger.error(
            "Failed to parse %s JSON response: %s (raw: %s)", backend_name, e, response_text[:200]
        )
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {e}") from e
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Visualizer preset generation failed (%s): %s", backend_name, e)
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        adapter.clear_activity(model)


@router.post("/ollama/visualizer")
async def generate_visualizer_preset(body: GenerateVisualizerPresetRequest) -> dict:
    """Generate a visualizer preset from a natural language description using Ollama."""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    return await _generate_visualizer_preset(adapter, body, "ollama")


@router.post("/atomic-chat/visualizer")
async def generate_visualizer_preset_atomic(body: GenerateVisualizerPresetRequest) -> dict:
    """Generate a visualizer preset from a natural language description using Atomic Chat."""
    adapter = adapter_registry.get("atomic-chat")
    if not adapter:
        raise HTTPException(status_code=404, detail="Atomic Chat not available")
    return await _generate_visualizer_preset(adapter, body, "atomic-chat")


@router.get("/ollama/visualizer/presets")
async def list_visualizer_presets() -> dict:
    """List persisted visualizer presets (DB + file)."""
    presets = get_all_visualization_presets()
    # Also include file-based presets not yet in DB
    file_dir = Path(__file__).resolve().parents[4] / "storage" / "visualizer_presets"
    files = [p.name for p in file_dir.glob("*.json")] if file_dir.exists() else []
    return {"presets": presets, "files": files, "count": len(presets)}


@router.get("/ollama/visualizer/preset/{track_hash}")
async def get_visualizer_preset(track_hash: str) -> dict:
    """Retrieve a persisted preset by track_hash."""
    import json as _json
    from pathlib import Path as _Path

    preset = get_visualization_preset(track_hash)
    if preset:
        return {"preset": preset["params"], "meta": preset}
    # Fallback to file
    file_path = (
        _Path(__file__).resolve().parents[4] / "storage" / "visualizer_presets" / f"{track_hash}.json"
    )
    if file_path.exists():
        return {
            "preset": _json.loads(file_path.read_text(encoding="utf-8")),
            "meta": {"source": "file"},
        }
    raise HTTPException(status_code=404, detail="Preset not found")


@router.delete("/ollama/visualizer/preset/{preset_id}")
async def delete_visualizer_preset(preset_id: str) -> dict:
    """Delete a saved preset by id."""
    with get_db() as conn:
        cur = conn.execute("DELETE FROM visualization_presets WHERE id = ?", (preset_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Preset not found")
    # Also remove file if exists (by id or hash)
    file_dir = Path(__file__).resolve().parents[4] / "storage" / "visualizer_presets"
    for f in file_dir.glob(f"{preset_id[:16]}*.json"):
        try:
            f.unlink()
        except Exception:
            pass
    return {"deleted": preset_id}
