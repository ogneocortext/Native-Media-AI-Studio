"""
Blender MCP bridge adapter.

Wraps a Blender MCP bridge (Node.js subprocess) that controls Blender for
high-quality rendering. All Blender interaction goes through this adapter;
the rest of the application depends only on this abstract interface.

If Blender's MCP protocol or CLI changes, only this adapter needs updating --
services and API endpoints remain untouched.

Dependency direction: api -> services -> adapters (this module only).
Nothing in this module imports from app.api or app.services.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .bridge_base import BaseBridgeAdapter

logger = logging.getLogger(__name__)

# Default path to the Blender MCP bridge script (relative to repo root).
DEFAULT_BRIDGE_SCRIPT = Path("tools/mcp/blender-mcp-bridge.mjs")

# Default Blender project path.
DEFAULT_BLENDER_PROJECT = Path("blender-project")


class BlenderAdapter(BaseBridgeAdapter):
    """
    Adapter for Blender via the Blender MCP bridge.

    Starts the ``blender-mcp-bridge.mjs`` Node.js subprocess and communicates
    with it via the MCP stdio protocol. All Blender operations (scene
    creation, material assignment, animation, rendering) go through this
    adapter.

    Example usage::

        adapter = BlenderAdapter()
        await adapter.start()
        result = await adapter.execute("render_scene", {
            "scene": "my_scene.blend",
            "output": "/output/render.png",
        })
        await adapter.close()
    """

    def __init__(
        self,
        bridge_script: str | Path | None = None,
        project_path: str | Path | None = None,
        *,
        mock_mode: bool = False,
        startup_timeout: float = 30.0,
        health_timeout: float = 10.0,
    ):
        """
        Initialize the Blender adapter.

        Args:
            bridge_script: Path to the blender-mcp-bridge.mjs script.
                Defaults to ``tools/mcp/blender-mcp-bridge.mjs`` relative to
                the project root.
            project_path: Path to the Blender project directory.
                Defaults to ``blender-project`` relative to the project root.
            mock_mode: If True, skip subprocess lifecycle and use mock responses.
            startup_timeout: Seconds to wait for the bridge to become ready.
            health_timeout: Seconds to wait for health check responses.
        """
        repo_root = Path(__file__).resolve().parents[3]  # packages/backend/app/adapters -> repo root
        script = bridge_script or repo_root / DEFAULT_BRIDGE_SCRIPT
        command = ["node", str(script)]

        # Pass Blender project path via environment variable so the bridge
        # picks it up without command-line changes.
        env = {"BLENDER_PROJECT_PATH": str(project_path or repo_root / DEFAULT_BLENDER_PROJECT)}

        super().__init__(
            bridge_command=command,
            name="blender",
            mock_mode=mock_mode,
            startup_timeout=startup_timeout,
            health_timeout=health_timeout,
            cwd=str(repo_root),
            env=env,
        )

        self._project_path = str(project_path or repo_root / DEFAULT_BLENDER_PROJECT)

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        """Check if Blender MCP bridge and Blender are reachable.

        Tries the ``list_pipeline_commands`` command first (cheap, no
        parameters). Falls back to ``blender_status`` if that fails.
        """
        if self._mock_mode:
            return True

        try:
            result = await self.execute("list_pipeline_commands", {}, timeout=self._health_timeout)
            if isinstance(result, dict) and "error" not in result:
                return True
        except Exception:
            pass

        # Fallback: try blender_status
        try:
            result = await self.execute("blender_status", {}, timeout=self._health_timeout)
            return isinstance(result, dict) and "error" not in result
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Blender-specific convenience methods
    # ------------------------------------------------------------------

    async def list_commands(self) -> dict[str, Any]:
        """List all Blender pipeline commands available from the bridge."""
        return await self.execute("list_pipeline_commands", {})

    async def blender_status(self) -> dict[str, Any]:
        """Get Blender status (version, render engine, etc.)."""
        return await self.execute("blender_status", {})

    async def load_scene(self, path: str) -> dict[str, Any]:
        """Load a Blender scene file.

        Args:
            path: Path to the .blend file.
        """
        return await self.execute("load_scene", {"path": path})

    async def render_scene(
        self,
        scene: str | None = None,
        output: str | None = None,
        frame_start: int | None = None,
        frame_end: int | None = None,
        engine: str | None = None,
        samples: int | None = None,
    ) -> dict[str, Any]:
        """Render a Blender scene.

        Args:
            scene: Scene name to render.
            output: Output file path.
            frame_start: Optional start frame.
            frame_end: Optional end frame.
            engine: Render engine (BLENDER_EEVEE, BLENDER_WORKBENCH, CYCLES).
            samples: Optional render samples.
        """
        params: dict[str, Any] = {}
        if scene:
            params["scene"] = scene
        if output:
            params["output"] = output
        if frame_start is not None:
            params["frame_start"] = frame_start
        if frame_end is not None:
            params["frame_end"] = frame_end
        if engine:
            params["engine"] = engine
        if samples is not None:
            params["samples"] = samples
        return await self.execute("render_scene", params)

    async def create_material(
        self,
        name: str,
        color: str | None = None,
        roughness: float | None = None,
        metallic: float | None = None,
    ) -> dict[str, Any]:
        """Create a Blender material.

        Args:
            name: Material name.
            color: Optional base color (hex string).
            roughness: Optional roughness value (0-1).
            metallic: Optional metallic value (0-1).
        """
        params: dict[str, Any] = {"name": name}
        if color:
            params["color"] = color
        if roughness is not None:
            params["roughness"] = roughness
        if metallic is not None:
            params["metallic"] = metallic
        return await self.execute("create_material", params)

    async def set_material(
        self,
        object_name: str,
        material_name: str,
    ) -> dict[str, Any]:
        """Assign a material to an object.

        Args:
            object_name: Name of the target object.
            material_name: Name of the material to assign.
        """
        return await self.execute(
            "set_material",
            {"object": object_name, "material": material_name},
        )

    async def animate_object(
        self,
        object_name: str,
        property_path: str,
        frame: int,
        value: float,
    ) -> dict[str, Any]:
        """Set an animation keyframe on an object property.

        Args:
            object_name: Name of the target object.
            property_path: Blender data path (e.g. "location.x").
            frame: Frame number for the keyframe.
            value: Property value at the keyframe.
        """
        return await self.execute(
            "animate_object",
            {
                "object": object_name,
                "property_path": property_path,
                "frame": frame,
                "value": value,
            },
        )

    async def execute_blender_command(
        self,
        command: str,
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute an arbitrary Blender pipeline command.

        This is the generic escape hatch for any Blender command not covered
        by the convenience methods above. See ``list_commands()`` for
        available command names.

        Args:
            command: Blender command name.
            parameters: Command parameters.
        """
        return await self.execute("blender_command", {"command": command, "parameters": parameters or {}})

    # ------------------------------------------------------------------
    # Bridge interface implementation
    # ------------------------------------------------------------------

    async def _mock_execute(
        self,
        command: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Mock command execution for testing without Blender.

        Returns realistic mock data matching Blender command output formats.
        """
        cmd = command.lower()
        if cmd == "list_pipeline_commands":
            return {
                "commands": [
                    {"name": "load_scene", "description": "Load a Blender scene"},
                    {"name": "render_scene", "description": "Render a scene"},
                    {"name": "create_material", "description": "Create a material"},
                    {"name": "set_material", "description": "Assign a material"},
                    {"name": "animate_object", "description": "Set an animation keyframe"},
                    {"name": "blender_status", "description": "Get Blender status"},
                ]
            }
        if cmd == "blender_status":
            return {
                "version": "4.0",
                "engine": "CYCLES",
                "samples": 128,
            }
        if cmd == "load_scene":
            return {"success": True, "path": params.get("path") if params else None}
        if cmd == "render_scene":
            return {
                "success": True,
                "output": params.get("output") if params else None,
                "frames": params.get("frame_end", 1) - params.get("frame_start", 0) + 1 if params else 1,
            }
        if cmd == "create_material":
            return {
                "success": True,
                "name": params.get("name") if params else None,
            }
        if cmd == "set_material":
            return {
                "success": True,
                "object": params.get("object") if params else None,
                "material": params.get("material") if params else None,
            }
        if cmd == "animate_object":
            return {"success": True, "frame": params.get("frame") if params else None}
        if cmd == "blender_command":
            return {
                "success": True,
                "command": params.get("command") if params else None,
            }
        return {"success": True, "command": command, "mock": True}
