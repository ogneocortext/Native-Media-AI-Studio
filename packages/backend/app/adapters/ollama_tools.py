"""
Ollama tool definitions and implementations mixin.

Extracted from ollama_adapter.py. Contains the JSON-schema tool
definitions exposed to the LLM and the Python implementations of each
built-in tool (3D scene manipulation, storyboard links, project introspection,
system health, job queue, visualization config).
"""

from __future__ import annotations

import glob
import json
import logging
import operator
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class OllamaToolsMixin:
    """Mixin providing LLM tool definitions and their implementations.

    Intended to be mixed into ``OllamaAdapter`` alongside
    ``OllamaModelMixin`` and ``BaseAdapter``.
    """

    # ------------------------------------------------------------------
    # Tool definitions (JSON schemas exposed to the LLM)
    # ------------------------------------------------------------------

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Get JSON schema definitions for all built-in tools (OpenAI-compatible)."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "scene_add_object",
                    "description": "Add a 3D object (sphere, box, cylinder, cone, torus, crown) to the scene.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "obj_type": {
                                "type": "string",
                                "enum": ["sphere", "box", "cylinder", "cone", "torus", "crown"],
                            },
                            "position": {
                                "type": "array",
                                "items": {"type": "number"},
                                "description": "[x, y, z] position",
                            },
                            "color": {"type": "string", "description": "Hex color like #ff0000"},
                            "scale": {
                                "type": "array",
                                "items": {"type": "number"},
                                "description": "[x, y, z] scale",
                            },
                            "metalness": {"type": "number", "minimum": 0, "maximum": 1},
                            "roughness": {"type": "number", "minimum": 0, "maximum": 1},
                            "emissive": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 2,
                                "description": "Emissive glow intensity",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_light",
                    "description": "Add a light (point, spot, directional) to the scene.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "light_type": {
                                "type": "string",
                                "enum": ["point", "spot", "directional"],
                            },
                            "color": {"type": "string"},
                            "intensity": {"type": "number"},
                            "position": {"type": "array", "items": {"type": "number"}},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_set_camera",
                    "description": "Set camera movement mode.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "mode": {
                                "type": "string",
                                "enum": ["orbit", "dolly", "handheld", "static"],
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_set_particles",
                    "description": "Configure particle effects (count, color, speed).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "count": {"type": "integer", "minimum": 0, "maximum": 5000},
                            "color": {"type": "string"},
                            "speed": {"type": "number", "minimum": 0, "maximum": 5},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_keyframe",
                    "description": "Add an animation keyframe for an object at a specific time.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "object_index": {
                                "type": "integer",
                                "description": "Index of the object to animate",
                            },
                            "time": {"type": "number", "description": "Time in seconds"},
                            "position": {"type": "array", "items": {"type": "number"}},
                            "rotation": {"type": "array", "items": {"type": "number"}},
                            "scale": {"type": "array", "items": {"type": "number"}},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_clear",
                    "description": "Clear all objects and keyframes from the scene.",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_get_state",
                    "description": "Get the current scene state as JSON.",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_set_bloom",
                    "description": "Set bloom post-processing strength (0-1.5).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "strength": {"type": "number", "minimum": 0, "maximum": 1.5},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_set_duration",
                    "description": "Set the animation duration in seconds.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "seconds": {"type": "number", "minimum": 1, "maximum": 120},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_storyboard_element",
                    "description": "Add a storyboard visual element (crown, skyline, orb, ring, spiral, mountain, city, tree, lightning, rain, snow, fire, wave, galaxy, neuron, fractal, text, particle_field, light_rays, lens_flare).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "element_type": {
                                "type": "string",
                                "enum": [
                                    "crown",
                                    "skyline",
                                    "orb",
                                    "ring",
                                    "spiral",
                                    "mountain",
                                    "city",
                                    "tree",
                                    "lightning",
                                    "rain",
                                    "snow",
                                    "fire",
                                    "wave",
                                    "galaxy",
                                    "neuron",
                                    "fractal",
                                    "text",
                                    "particle_field",
                                    "light_rays",
                                    "lens_flare",
                                    "stage",
                                    "equalizer",
                                    "vinyl",
                                    "pillar",
                                    "bar",
                                ],
                            },
                            "position": {"type": "array", "items": {"type": "number"}},
                            "color": {"type": "string"},
                            "scale": {"type": "array", "items": {"type": "number"}},
                            "rotation": {"type": "array", "items": {"type": "number"}},
                            "metalness": {"type": "number", "minimum": 0, "maximum": 1},
                            "roughness": {"type": "number", "minimum": 0, "maximum": 1},
                            "emissive": {"type": "number", "minimum": 0, "maximum": 2},
                            "storyboard_ref": {
                                "type": "string",
                                "description": "Reference to storyboard scene/section",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_set_camera_for_shot",
                    "description": "Set camera based on storyboard shot type (wide, close_up, macro, overhead, dolly, tracking, handheld, low_angle, birds_eye).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "shot_type": {
                                "type": "string",
                                "enum": [
                                    "wide",
                                    "close_up",
                                    "macro",
                                    "overhead",
                                    "dolly",
                                    "tracking",
                                    "handheld",
                                    "low_angle",
                                    "birds_eye",
                                ],
                            },
                            "target": {"type": "array", "items": {"type": "number"}},
                            "fov": {"type": "number", "minimum": 10, "maximum": 120},
                            "movement": {
                                "type": "string",
                                "enum": ["static", "orbit", "dolly", "tracking", "handheld"],
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_text",
                    "description": "Add 3D text element for lyrics, titles, or labels.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "position": {"type": "array", "items": {"type": "number"}},
                            "color": {"type": "string"},
                            "size": {"type": "number", "minimum": 0.1, "maximum": 5},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_environment",
                    "description": "Set the environment/background mood (studio, city, void, sunset, neon, forest, space).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "env_type": {
                                "type": "string",
                                "enum": [
                                    "studio",
                                    "city",
                                    "void",
                                    "sunset",
                                    "neon",
                                    "forest",
                                    "space",
                                ],
                            },
                            "color": {"type": "string"},
                            "fog": {"type": "number", "minimum": 0, "maximum": 0.1},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_link_to_storyboard",
                    "description": "Link this scene to a storyboard document for reference.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "storyboard_path": {"type": "string"},
                            "track_name": {"type": "string"},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "audio_list",
                    "description": "List all available audio files in the studio output/audio directory. Returns filenames and relative paths that can be used as inputs to audio analysis or upload tools.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "media_list",
                    "description": "List all available media files (video, images) in the studio output directory. Returns filenames and relative paths.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_project_structure",
                    "description": "Get the project directory structure to understand codebase layout.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "depth": {
                                "type": "integer",
                                "default": 3,
                                "description": "Depth of directory traversal (1-5)",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "search_docs",
                    "description": "Search project documentation for specific topics or keywords.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"},
                            "limit": {
                                "type": "integer",
                                "default": 5,
                                "description": "Maximum number of results",
                            },
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_system_health",
                    "description": "Get real-time system health status including CPU, memory, disk, and GPU VRAM usage.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_jobs",
                    "description": "List all jobs in the queue, optionally filtered by status.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "type": "string",
                                "description": "Filter by job status (queued, running, completed, failed)",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_job_status",
                    "description": "Get the status and progress of a specific job by ID.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "job_id": {"type": "string", "description": "Job ID to check"},
                        },
                        "required": ["job_id"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "generate_visualization",
                    "description": "Generate a visualization configuration for the canvas based on style, color scheme, and BPM.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "style": {
                                "type": "string",
                                "enum": ["particles", "waveform", "geometric", "fractal"],
                                "default": "particles",
                            },
                            "color_scheme": {
                                "type": "string",
                                "enum": ["neon", "fire", "ocean", "forest", "sunset", "monochrome"],
                                "default": "neon",
                            },
                            "intensity": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 1,
                                "default": 0.7,
                            },
                            "bpm": {"type": "integer", "default": 120},
                        },
                    },
                },
            },
        ]

    # ------------------------------------------------------------------
    # Built-in tool registry
    # ------------------------------------------------------------------

    def _get_built_in_tools(self) -> dict[str, Any]:
        """Get built-in tool implementations."""
        return {
            # Project / docs / health / jobs tools
            "get_project_structure": self._tool_get_project_structure,
            "search_docs": self._tool_search_docs,
            "get_system_health": self._tool_get_system_health,
            "list_jobs": self._tool_list_jobs,
            "get_job_status": self._tool_get_job_status,
            "generate_visualization": self._tool_generate_visualization,
            # Three.js scene tools
            "scene_add_object": self._tool_scene_add_object,
            "scene_add_light": self._tool_scene_add_light,
            "scene_set_camera": self._tool_scene_set_camera,
            "scene_set_particles": self._tool_scene_set_particles,
            "scene_add_keyframe": self._tool_scene_add_keyframe,
            "scene_clear": self._tool_scene_clear,
            "scene_get_state": self._tool_scene_get_state,
            "scene_set_bloom": self._tool_scene_set_bloom,
            "scene_set_duration": self._tool_scene_set_duration,
            # Storyboard-driven tools
            "scene_add_storyboard_element": self._tool_scene_add_storyboard_element,
            "scene_set_camera_for_shot": self._tool_scene_set_camera_for_shot,
            "scene_add_text": self._tool_scene_add_text,
            "scene_add_environment": self._tool_scene_add_environment,
            "scene_link_to_storyboard": self._tool_scene_link_to_storyboard,
            # Media list tools
            "audio_list": self._tool_audio_list,
            "media_list": self._tool_media_list,
        }

    # ------------------------------------------------------------------
    # Three.js Scene Tools
    # ------------------------------------------------------------------

    async def _tool_scene_add_object(
        self,
        obj_type: str = "sphere",
        position: list[float] | None = None,
        color: str = "#ffffff",
        scale: list[float] | None = None,
        metalness: float = 0.6,
        roughness: float = 0.3,
        emissive: float = 0.1,
    ) -> str:
        """Add a 3D object to the scene."""
        obj = {
            "type": obj_type,
            "position": position or [0, 0.5, 0],
            "color": color,
            "scale": scale or [1, 1, 1],
            "metalness": metalness,
            "roughness": roughness,
            "emissive": emissive,
        }
        self._scene_state["objects"].append(obj)
        return (
            f"Added {obj_type} object. Scene now has {len(self._scene_state['objects'])} objects."
        )

    async def _tool_scene_add_light(
        self,
        light_type: str = "point",
        color: str = "#ffffff",
        intensity: float = 10.0,
        position: list[float] | None = None,
    ) -> str:
        """Add a light to the scene."""
        light = {
            "type": light_type,
            "color": color,
            "intensity": intensity,
            "position": position or [0, 5, 0],
        }
        self._scene_state["lights"].append(light)
        return f"Added {light_type} light. Scene now has {len(self._scene_state['lights'])} lights."

    async def _tool_scene_set_camera(self, mode: str = "orbit") -> str:
        """Set the camera movement mode (orbit, dolly, handheld, static)."""
        self._scene_state["camera"] = mode
        return f"Camera mode set to '{mode}'."

    async def _tool_scene_set_particles(
        self,
        count: int | None = None,
        color: str | None = None,
        speed: float | None = None,
    ) -> str:
        """Configure particle effects."""
        if count is not None:
            self._scene_state["particles"]["count"] = count
        if color is not None:
            self._scene_state["particles"]["color"] = color
        if speed is not None:
            self._scene_state["particles"]["speed"] = speed
        return f"Particles: {self._scene_state['particles']}"

    async def _tool_scene_add_keyframe(
        self,
        object_index: int = 0,
        time: float = 0.0,
        position: list[float] | None = None,
        rotation: list[float] | None = None,
        scale: list[float] | None = None,
    ) -> str:
        """Add an animation keyframe for an object."""
        track = None
        for t in self._scene_state["keyframes"]:
            if t.get("target") == object_index:
                track = t
                break
        if track is None:
            track = {"target": object_index, "keyframes": []}
            self._scene_state["keyframes"].append(track)
        kf = {"time": time}
        if position:
            kf["position"] = position
        if rotation:
            kf["rotation"] = rotation
        if scale:
            kf["scale"] = scale
        track["keyframes"].append(kf)
        track["keyframes"].sort(key=operator.itemgetter("time"))
        return f"Added keyframe at t={time}s for object {object_index}. Track has {len(track['keyframes'])} keyframes."

    async def _tool_scene_clear(self) -> str:
        """Clear all objects and keyframes from the scene."""
        self._scene_state["objects"] = []
        self._scene_state["lights"] = []
        self._scene_state["keyframes"] = []
        return "Scene cleared."

    async def _tool_scene_get_state(self) -> str:
        """Get the current scene state as JSON."""
        return json.dumps(self._scene_state, indent=2)

    async def _tool_scene_set_bloom(self, strength: float = 0.8) -> str:
        """Set bloom post-processing strength (0-1.5)."""
        self._scene_state["bloom"] = max(0, min(1.5, strength))
        return f"Bloom strength set to {self._scene_state['bloom']}."

    async def _tool_scene_set_duration(self, seconds: float = 30.0) -> str:
        """Set the animation duration in seconds."""
        self._scene_state["duration"] = max(1, seconds)
        return f"Animation duration set to {self._scene_state['duration']}s."

    # ------------------------------------------------------------------
    # Storyboard-Driven Scene Tools
    # ------------------------------------------------------------------

    async def _tool_scene_add_storyboard_element(
        self,
        element_type: str = "crown",
        position: list[float] | None = None,
        color: str = "#ffd700",
        scale: list[float] | None = None,
        rotation: list[float] | None = None,
        metalness: float = 0.9,
        roughness: float = 0.1,
        emissive: float = 0.2,
        storyboard_ref: str = "",
    ) -> str:
        """Add a storyboard visual element (crown, skyline, orb, ring, text, particle_field, light_rays)."""
        element = {
            "type": element_type,
            "position": position or [0, 0.5, 0],
            "color": color,
            "scale": scale or [1, 1, 1],
            "rotation": rotation or [0, 0, 0],
            "metalness": metalness,
            "roughness": roughness,
            "emissive": emissive,
            "storyboard_ref": storyboard_ref,
        }
        self._scene_state["objects"].append(element)
        idx = len(self._scene_state["objects"]) - 1
        return f"Added storyboard element '{element_type}' at index {idx}" + (
            f" (ref: {storyboard_ref})" if storyboard_ref else ""
        )

    async def _tool_scene_set_camera_for_shot(
        self,
        shot_type: str = "wide",
        target: list[float] | None = None,
        fov: float = 50,
        movement: str = "static",
    ) -> str:
        """Set camera based on storyboard shot type (wide, close_up, macro, overhead, dolly, tracking, handheld)."""
        shot_configs = {
            "wide": {"position": [0, 3, 10], "fov": 60, "movement": "orbit"},
            "close_up": {"position": [0, 1, 4], "fov": 35, "movement": "static"},
            "macro": {"position": [0, 0.5, 2], "fov": 25, "movement": "static"},
            "overhead": {"position": [0, 10, 0.1], "fov": 50, "movement": "static"},
            "dolly": {"position": [0, 3, 10], "fov": 50, "movement": "dolly"},
            "tracking": {"position": [5, 2, 5], "fov": 45, "movement": "orbit"},
            "handheld": {"position": [0, 3, 8], "fov": 50, "movement": "handheld"},
            "low_angle": {"position": [0, -1, 6], "fov": 55, "movement": "static"},
            "birds_eye": {"position": [0, 15, 0.1], "fov": 45, "movement": "orbit"},
        }
        config = shot_configs.get(shot_type, shot_configs["wide"])
        if target:
            config["target"] = target
        config["fov"] = fov
        if movement != "static":
            config["movement"] = movement
        self._scene_state["camera"] = config
        return f"Camera set to '{shot_type}' shot: {config}"

    async def _tool_scene_add_text(
        self,
        text: str = "Title",
        position: list[float] | None = None,
        color: str = "#ffffff",
        size: float = 1.0,
        font: str = "bold",
    ) -> str:
        """Add 3D text element (rendered as a plane with text texture)."""
        element = {
            "type": "text",
            "text": text,
            "position": position or [0, 2, 0],
            "color": color,
            "scale": [size * len(text) * 0.6, size, 0.1],
            "rotation": [0, 0, 0],
            "metalness": 0.1,
            "roughness": 0.8,
            "emissive": 0.0,
            "storyboard_ref": "text",
        }
        self._scene_state["objects"].append(element)
        return f"Added text '{text}' at position {element['position']}."

    async def _tool_scene_add_environment(
        self,
        env_type: str = "studio",
        color: str = "#0a0a0f",
        fog: float = 0.015,
    ) -> str:
        """Set the environment/background (studio, city, void, sunset, neon, forest, space)."""
        env_configs = {
            "studio": {"color": "#0a0a0f", "fog": 0.015, "ambient": 0.4},
            "city": {"color": "#1a1a2e", "fog": 0.02, "ambient": 0.3},
            "void": {"color": "#000000", "fog": 0.005, "ambient": 0.1},
            "sunset": {"color": "#ff6b35", "fog": 0.025, "ambient": 0.5},
            "neon": {"color": "#0a0a1a", "fog": 0.02, "ambient": 0.2},
            "forest": {"color": "#0a1a0a", "fog": 0.03, "ambient": 0.3},
            "space": {"color": "#000005", "fog": 0.001, "ambient": 0.05},
        }
        config = env_configs.get(env_type, env_configs["studio"])
        if color != "#0a0a0f":
            config["color"] = color
        if fog != 0.015:
            config["fog"] = fog
        self._scene_state["environment"] = config
        return f"Environment set to '{env_type}': {config}"

    async def _tool_scene_link_to_storyboard(
        self,
        storyboard_path: str = "",
        track_name: str = "",
    ) -> str:
        """Link the scene to a storyboard document for reference."""
        self._scene_state["storyboard"] = {
            "path": storyboard_path,
            "track": track_name,
        }
        return f"Linked to storyboard: {storyboard_path or track_name}"

    # ------------------------------------------------------------------
    # Project / docs / health / jobs tools
    # ------------------------------------------------------------------

    async def _tool_get_project_structure(self, depth: int = 3) -> str:
        """Get project directory structure."""
        root = Path(__file__).resolve().parents[2]
        lines = []

        def walk(path: Path, prefix: str = "", current_depth: int = 0):
            if current_depth >= depth:
                return
            try:
                entries = sorted(p.name for p in path.iterdir())
            except PermissionError:
                return
            for i, entry in enumerate(entries):
                if entry.startswith(".") or entry in [
                    "node_modules",
                    "__pycache__",
                    "venv",
                    ".git",
                ]:
                    continue
                full_path = path / entry
                is_last = i == len(entries) - 1
                connector = "+--- " if is_last else "+--- "
                lines.append(f"{prefix}{connector}{entry}")
                if full_path.is_dir():
                    extension = "    " if is_last else "|   "
                    walk(full_path, prefix + extension, current_depth + 1)

        walk(root)
        return "\n".join(lines[:100])

    async def _tool_search_docs(self, query: str, limit: int = 5) -> str:
        """Search project documentation - scans real docs/ and markdown files."""
        root = Path(__file__).resolve().parents[2]
        results: list[str] = []
        query_lower = query.lower()

        for pattern in ["**/*.md", "docs/**/*.md", "packages/**/README.md"]:
            for filepath in glob.glob(str(Path(root) / pattern), recursive=True):
                if self._search_doc_file(filepath, query_lower, root, results, limit):
                    return "\n\n".join(results)

        return "\n\n".join(results) if results else f"No docs found for '{query}'"

    @staticmethod
    def _search_doc_file(
        filepath: str, query_lower: str, root: Path, results: list[str], limit: int
    ) -> bool:
        """Append the first matching snippet for one file. True if limit hit."""
        try:
            content = Path(filepath).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return False
        if query_lower not in content.lower():
            return False
        lines = content.split("\n")
        for i, line in enumerate(lines):
            if query_lower not in line.lower():
                continue
            start = max(0, i - 1)
            end = min(len(lines), i + 3)
            snippet = "\n".join(lines[start:end])
            rel_path = Path(filepath).relative_to(root)
            results.append(f"[{rel_path}]:\n{snippet}")
            return len(results) >= limit
        return False

    async def _tool_get_system_health(self) -> str:
        """Get real system health status using psutil."""
        try:
            import psutil

            cpu = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage("/")

            health_parts = [
                f"CPU: {cpu}%",
                f"Memory: {mem.percent}% ({mem.used / (1024**3):.1f}GB / {mem.total / (1024**3):.1f}GB)",
                f"Disk: {disk.percent}% ({disk.used / (1024**3):.1f}GB / {disk.total / (1024**3):.1f}GB)",
            ]

            try:
                import subprocess

                result = subprocess.run(
                    [
                        "nvidia-smi",
                        "--query-gpu=utilization.memory,memory.used,memory.total",
                        "--format=csv,noheader,nounits",
                    ],
                    encoding="utf-8",
                    errors="replace",
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if result.returncode == 0:
                    parts = result.stdout.strip().split(",")
                    if len(parts) >= 3:
                        mem_pct = float(parts[0])
                        mem_used = float(parts[1])
                        mem_total = float(parts[2])
                        health_parts.append(
                            f"GPU VRAM: {mem_pct:.0f}% ({mem_used:.0f}MB / {mem_total:.0f}MB)"
                        )
            except (FileNotFoundError, Exception):
                pass

            return "System health: " + ", ".join(health_parts)
        except ImportError:
            return "System health: psutil not installed. Run: pip install psutil"

    async def _tool_list_jobs(self, status: str | None = None) -> str:
        """List real jobs from the queue manager."""
        try:
            from ..queue.manager import queue_manager

            jobs = await queue_manager.get_all_jobs()
            if status:
                jobs = [j for j in jobs if j.status == status]

            status_counts: dict[str, int] = {}
            for job in jobs:
                s = job.status
                status_counts[s] = status_counts.get(s, 0) + 1

            parts = [f"{count} {st}" for st, count in sorted(status_counts.items())]
            return f"Jobs: {', '.join(parts)}" if parts else "Jobs: none in queue"
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Failed to list jobs: {e}")
            return f"Jobs: queue unavailable ({e})"

    async def _tool_get_job_status(self, job_id: str) -> str:
        """Get real status of a specific job."""
        try:
            from ..queue.manager import queue_manager

            job = await queue_manager.get_job(job_id)
            if not job:
                return f"Job {job_id}: not found"
            status = job.status
            progress = job.progress
            return f"Job {job_id}: {status}, {progress:.0%} complete"
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Failed to get job status: {e}")
            return f"Job {job_id}: error retrieving status ({e})"

    async def _tool_generate_visualization(
        self,
        style: str = "particles",
        color_scheme: str = "neon",
        intensity: float = 0.7,
        bpm: int = 120,
    ) -> str:
        """Generate a visualization configuration for the canvas."""
        config = {
            "type": "visualization",
            "style": style,
            "colorScheme": color_scheme,
            "intensity": intensity,
            "bpm": bpm,
            "colors": self._get_color_palette(color_scheme),
            "params": {
                "particleCount": int(200 * intensity),
                "speed": 0.5 + (bpm / 240),
                "scale": 1.0 + (intensity * 0.5),
                "glow": intensity > 0.6,
                "rotation": True,
            },
        }
        return json.dumps(config)

    def _get_color_palette(self, scheme: str) -> dict[str, str]:
        """Get color palette for visualization."""
        palettes = {
            "neon": {"primary": "#ff00ff", "secondary": "#00ffff", "accent": "#ffff00"},
            "fire": {"primary": "#ff4500", "secondary": "#ff8c00", "accent": "#ffd700"},
            "ocean": {"primary": "#006994", "secondary": "#40e0d0", "accent": "#7fffd4"},
            "forest": {"primary": "#228b22", "secondary": "#32cd32", "accent": "#90ee90"},
            "sunset": {"primary": "#ff6b6b", "secondary": "#feca57", "accent": "#ff9ff3"},
            "monochrome": {"primary": "#ffffff", "secondary": "#888888", "accent": "#cccccc"},
        }
        return palettes.get(scheme, palettes["neon"])

    async def _tool_audio_list(self) -> str:
        """List all available audio files in the studio output/audio directory."""
        try:
            from ...core.config import PROJECT_ROOT

            audio_dir = PROJECT_ROOT / "output" / "audio"
            if not audio_dir.exists():
                return "Audio directory not found"

            audio_files = []
            for ext in ("*.wav", "*.mp3", "*.flac", "*.ogg", "*.m4a"):
                audio_files.extend(audio_dir.glob(ext))

            if not audio_files:
                return "No audio files found"

            file_list = [f.name for f in sorted(audio_files)]
            return f"Audio files ({len(file_list)}): " + ", ".join(file_list[:20])
        except Exception as e:
            logger.warning(f"Failed to list audio files: {e}")
            return f"Audio list unavailable: {e}"

    async def _tool_media_list(self) -> str:
        """List all available media files (video, images) in the studio output directory."""
        try:
            from ...core.config import PROJECT_ROOT

            output_dir = PROJECT_ROOT / "output"
            if not output_dir.exists():
                return "Output directory not found"

            media_files = []
            for ext in ("*.mp4", "*.webm", "*.mov", "*.avi", "*.png", "*.jpg", "*.jpeg", "*.webp"):
                media_files.extend(output_dir.rglob(ext))

            if not media_files:
                return "No media files found"

            file_list = [f.name for f in sorted(media_files)]
            return f"Media files ({len(file_list)}): " + ", ".join(file_list[:20])
        except Exception as e:
            logger.warning(f"Failed to list media files: {e}")
            return f"Media list unavailable: {e}"

    # ------------------------------------------------------------------
    # HTTP Helper Methods
    # ------------------------------------------------------------------

    async def _http_get(self, path: str) -> dict[str, Any]:
        """Make a GET request to the backend API."""
        from ..core.config import config as _cfg
        backend_url = _cfg.backend_url
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{backend_url}{path}",
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise RuntimeError(f"Backend GET {path} failed: {resp.status} - {error}")
                return await resp.json()

    async def _http_post(self, path: str, data: dict[str, Any]) -> dict[str, Any]:
        """Make a POST request to the backend API."""
        from ..core.config import config as _cfg
        backend_url = _cfg.backend_url
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{backend_url}{path}",
                json=data,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise RuntimeError(f"Backend POST {path} failed: {resp.status} - {error}")
                return await resp.json()
