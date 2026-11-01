"""
Unity MCP bridge adapter.

Wraps the ``tools/mcp/unity-mcp-bridge.mjs`` Node.js subprocess, which in turn
controls Unity Editor via its Pipeline server. All Unity interaction goes
through this adapter; the rest of the application depends only on this
abstract interface.

If Unity's MCP protocol changes, only this adapter needs updating -- services
and API endpoints remain untouched.

Dependency direction: api -> services -> adapters (this module only).
Nothing in this module imports from app.api or app.services.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .bridge_base import BaseBridgeAdapter

logger = logging.getLogger(__name__)

# Default path to the Unity MCP bridge script (relative to repo root).
DEFAULT_BRIDGE_SCRIPT = Path("tools/mcp/unity-mcp-bridge.mjs")

# Default path to the Unity project.
DEFAULT_PROJECT_PATH = Path("unity-project-mcp")


class UnityAdapter(BaseBridgeAdapter):
    """
    Adapter for Unity Editor via the Unity MCP bridge.

    Starts the ``unity-mcp-bridge.mjs`` Node.js subprocess and communicates
    with it via the MCP stdio protocol. All Unity operations (scene creation,
    GameObject management, animation, rendering) go through this adapter.

    Example usage::

        adapter = UnityAdapter()
        await adapter.start()
        result = await adapter.execute("create_gameobject", {
            "name": "Player",
            "primitive": "capsule",
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
        Initialize the Unity adapter.

        Args:
            bridge_script: Path to the unity-mcp-bridge.mjs script.
                Defaults to ``tools/mcp/unity-mcp-bridge.mjs`` relative to
                the project root.
            project_path: Path to the Unity project directory.
                Defaults to ``unity-project-mcp`` relative to the project root.
            mock_mode: If True, skip subprocess lifecycle and use mock responses.
            startup_timeout: Seconds to wait for the bridge to become ready.
            health_timeout: Seconds to wait for health check responses.
        """
        repo_root = Path(__file__).resolve().parents[3]  # packages/backend/app/adapters -> repo root
        script = bridge_script or repo_root / DEFAULT_BRIDGE_SCRIPT
        command = ["node", str(script)]

        # Pass Unity project path via environment variable so the bridge
        # picks it up without command-line changes.
        env = {"UNITY_PROJECT_PATH": str(project_path or repo_root / DEFAULT_PROJECT_PATH)}

        super().__init__(
            bridge_command=command,
            name="unity",
            mock_mode=mock_mode,
            startup_timeout=startup_timeout,
            health_timeout=health_timeout,
            cwd=str(repo_root),
            env=env,
        )

        self._project_path = str(project_path or repo_root / DEFAULT_PROJECT_PATH)

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        """Check if Unity MCP bridge and Unity Editor are reachable.

        Tries the ``list_pipeline_commands`` command first (cheap, no
        parameters). Falls back to ``editor_status`` if that fails.
        """
        if self._mock_mode:
            return True

        try:
            result = await self.execute("list_pipeline_commands", {}, timeout=self._health_timeout)
            if isinstance(result, dict) and "error" not in result:
                return True
        except Exception:
            pass

        # Fallback: try editor_status
        try:
            result = await self.execute("editor_status", {}, timeout=self._health_timeout)
            return isinstance(result, dict) and "error" not in result
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Unity-specific convenience methods
    # ------------------------------------------------------------------

    async def list_commands(self) -> dict[str, Any]:
        """List all Unity pipeline commands available from the bridge."""
        return await self.execute("list_pipeline_commands", {})

    async def editor_status(self) -> dict[str, Any]:
        """Get Unity Editor status (compiling, play mode, etc.)."""
        return await self.execute("editor_status", {})

    async def create_scene(self, path: str) -> dict[str, Any]:
        """Create a new Unity scene at the given path."""
        return await self.execute("create_scene", {"path": path})

    async def create_gameobject(
        self,
        name: str | None = None,
        primitive: str | None = None,
    ) -> dict[str, Any]:
        """Create a GameObject or primitive in Unity.

        Args:
            name: Name of the GameObject.
            primitive: Primitive type (cube, sphere, capsule, cylinder, plane, quad).
        """
        params: dict[str, Any] = {}
        if name:
            params["name"] = name
        if primitive:
            params["primitive"] = primitive
        return await self.execute("create_gameobject", params)

    async def add_component(self, target: str, component_type: str) -> dict[str, Any]:
        """Add a component to a GameObject.

        Args:
            target: Name or path of the target GameObject.
            component_type: Type of component to add.
        """
        return await self.execute(
            "add_component",
            {"target": target, "type": component_type},
        )

    async def capture_scene_view(
        self,
        save_path: str,
        width: int | None = None,
        height: int | None = None,
    ) -> dict[str, Any]:
        """Capture the Unity Scene View to a PNG file.

        Args:
            save_path: Output file path for the screenshot.
            width: Optional image width.
            height: Optional image height.
        """
        params: dict[str, Any] = {"save_path": save_path}
        if width is not None:
            params["width"] = width
        if height is not None:
            params["height"] = height
        return await self.execute("capture_scene_view", params)

    async def create_animation_clip(
        self,
        path: str,
        *,
        frame_rate: float | None = None,
        loop: bool | None = None,
    ) -> dict[str, Any]:
        """Create an AnimationClip asset in Unity.

        Args:
            path: Asset path for the animation clip.
            frame_rate: Optional frame rate.
            loop: Optional loop flag.
        """
        params: dict[str, Any] = {"path": path}
        if frame_rate is not None:
            params["frameRate"] = frame_rate
        if loop is not None:
            params["loop"] = loop
        return await self.execute("create_animation_clip", params)

    async def execute_unity_command(
        self,
        command: str,
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute an arbitrary Unity pipeline command.

        This is the generic escape hatch for any Unity command not covered by
        the convenience methods above. See ``list_commands()`` for available
        command names.

        Args:
            command: Unity command name.
            parameters: Command parameters.
        """
        return await self.execute("unity_command", {"command": command, "parameters": parameters or {}})

    # ------------------------------------------------------------------
    # Bridge interface implementation
    # ------------------------------------------------------------------

    async def _mock_execute(
        self,
        command: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Mock command execution for testing without Unity.

        Returns realistic mock data matching Unity command output formats.
        """
        cmd = command.lower()
        if cmd == "list_pipeline_commands":
            return {
                "commands": [
                    {"name": "create_gameobject", "description": "Create a GameObject"},
                    {"name": "add_component", "description": "Add a component"},
                    {"name": "capture_scene_view", "description": "Capture a screenshot"},
                    {"name": "editor_status", "description": "Get editor status"},
                    {"name": "create_scene", "description": "Create a scene"},
                    {"name": "create_animation_clip", "description": "Create an animation clip"},
                ]
            }
        if cmd == "editor_status":
            return {
                "playing": False,
                "compiling": False,
                "paused": False,
            }
        if cmd == "create_scene":
            return {"success": True, "path": params.get("path", "untitled") if params else "untitled"}
        if cmd == "create_gameobject":
            return {
                "success": True,
                "name": params.get("name", "GameObject") if params else "GameObject",
                "primitive": params.get("primitive") if params else None,
            }
        if cmd == "add_component":
            return {
                "success": True,
                "target": params.get("target") if params else None,
                "component": params.get("type") if params else None,
            }
        if cmd == "capture_scene_view":
            return {
                "success": True,
                "path": params.get("save_path") if params else None,
            }
        if cmd == "create_animation_clip":
            return {"success": True, "path": params.get("path") if params else None}
        if cmd == "unity_command":
            return {
                "success": True,
                "command": params.get("command") if params else None,
            }
        return {"success": True, "command": command, "mock": True}
