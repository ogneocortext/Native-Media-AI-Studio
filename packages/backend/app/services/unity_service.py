"""
Unity service layer.

Provides high-level business logic for Unity Editor integration. All Unity
operations go through the ``UnityAdapter`` adapter -- this service layer
contains no Unity-specific protocol details, only business logic.

Dependency direction: api -> services -> adapters. This module imports
only from app.adapters.unity_adapter. It never imports from app.api.
"""

from __future__ import annotations

import logging
from typing import Any

from ..adapters.unity_adapter import UnityAdapter

logger = logging.getLogger(__name__)


class UnityService:
    """
    Service for Unity Editor integration via the Unity MCP bridge.

    This service owns the business logic for Unity operations:
    scene management, GameObject creation, animation sync, and rendering.
    All communication with Unity goes through the ``UnityAdapter``,
    which handles the MCP protocol and subprocess lifecycle.

    If Unity's MCP protocol changes, only ``UnityAdapter`` needs updating --
    this service layer and all API endpoints remain unchanged.
    """

    def __init__(self, adapter: UnityAdapter | None = None):
        """
        Initialize the Unity service.

        Args:
            adapter: Optional UnityAdapter instance. If not provided,
                a new one is created (mock mode based on environment).
        """
        self._adapter = adapter or UnityAdapter()
        self._started = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the Unity MCP bridge subprocess."""
        if self._started:
            return
        await self._adapter.start()
        self._started = True
        logger.info("Unity service started")

    async def stop(self) -> None:
        """Stop the Unity MCP bridge subprocess."""
        if not self._started:
            return
        await self._adapter.stop()
        self._started = False
        logger.info("Unity service stopped")

    async def restart(self) -> None:
        """Restart the Unity MCP bridge subprocess."""
        await self._adapter.restart()

    async def close(self) -> None:
        """Close the adapter and release resources."""
        await self.stop()

    @property
    def is_started(self) -> bool:
        """Return True if the service has been started."""
        return self._started

    @property
    def adapter(self) -> UnityAdapter:
        """Return the underlying Unity adapter."""
        return self._adapter

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        """Check if Unity and the MCP bridge are reachable."""
        return await self._adapter.health_check()

    # ------------------------------------------------------------------
    # Scene management
    # ------------------------------------------------------------------

    async def create_scene(self, path: str) -> dict[str, Any]:
        """Create a new Unity scene.

        Args:
            path: Asset path for the new scene (e.g. "Assets/Scenes/MyScene.unity").

        Returns:
            Result dictionary from Unity.
        """
        logger.info("Unity service: Creating scene %s", path)
        return await self._adapter.create_scene(path)

    async def load_scene(self, path: str) -> dict[str, Any]:
        """Load an existing Unity scene.

        Args:
            path: Asset path of the scene to load.

        Returns:
            Result dictionary from Unity.
        """
        logger.info("Unity service: Loading scene %s", path)
        return await self._adapter.execute_unity_command("load_scene", {"path": path})

    async def get_editor_status(self) -> dict[str, Any]:
        """Get Unity Editor status (compiling, play mode, etc.)."""
        return await self._adapter.editor_status()

    # ------------------------------------------------------------------
    # GameObject management
    # ------------------------------------------------------------------

    async def create_gameobject(
        self,
        name: str | None = None,
        primitive: str | None = None,
    ) -> dict[str, Any]:
        """Create a GameObject in Unity.

        Args:
            name: Name of the GameObject.
            primitive: Optional primitive type (cube, sphere, capsule, etc.).

        Returns:
            Result dictionary from Unity.
        """
        logger.info("Unity service: Creating GameObject %s", name or "unnamed")
        return await self._adapter.create_gameobject(name=name, primitive=primitive)

    async def add_component(
        self,
        target: str,
        component_type: str,
    ) -> dict[str, Any]:
        """Add a component to a GameObject.

        Args:
            target: Name or path of the target GameObject.
            component_type: Type of component to add (e.g. "AudioSource",
                "Animator", "Rigidbody").

        Returns:
            Result dictionary from Unity.
        """
        logger.info("Unity service: Adding %s to %s", component_type, target)
        return await self._adapter.add_component(target, component_type)

    # ------------------------------------------------------------------
    # Animation sync
    # ------------------------------------------------------------------

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

        Returns:
            Result dictionary from Unity.
        """
        logger.info("Unity service: Creating animation clip %s", path)
        return await self._adapter.create_animation_clip(
            path=path,
            frame_rate=frame_rate,
            loop=loop,
        )

    async def sync_audio_to_scene(
        self,
        audio_path: str,
        scene_path: str,
        bpm: float | None = None,
    ) -> dict[str, Any]:
        """Sync audio to a Unity scene by creating an AudioSource and
        animating it to the detected BPM.

        Args:
            audio_path: Path to the audio file.
            scene_path: Path to the Unity scene.
            audio_path: Path to the audio file.
            bpm: Optional detected BPM for beat synchronization.

        Returns:
            Result dictionary from Unity.
        """
        logger.info("Unity service: Syncing audio %s to scene %s", audio_path, scene_path)

        # Load or create the scene
        await self.create_scene(scene_path)

        # Create an AudioSource GameObject
        result = await self.create_gameobject(name="AudioSource", primitive=None)
        if not isinstance(result, dict) or "error" in result:
            return result

        # Add AudioSource component
        await self.add_component(target="AudioSource", component_type="AudioSource")

        # Return the result
        return {
            "success": True,
            "audio_path": audio_path,
            "scene_path": scene_path,
            "bpm": bpm,
            "gameobject": "AudioSource",
        }

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------

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

        Returns:
            Result dictionary from Unity.
        """
        logger.info("Unity service: Capturing scene view to %s", save_path)
        return await self._adapter.capture_scene_view(
            save_path=save_path,
            width=width,
            height=height,
        )

    # ------------------------------------------------------------------
    # Generic escape hatch
    # ------------------------------------------------------------------

    async def execute_command(
        self,
        command: str,
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute an arbitrary Unity pipeline command.

        This is the escape hatch for any Unity command not covered by
        the convenience methods above.

        Args:
            command: Unity command name.
            parameters: Command parameters.

        Returns:
            Result dictionary from Unity.
        """
        return await self._adapter.execute_unity_command(command, parameters)
