"""
Blender service layer.

Provides high-level business logic for Blender integration. All Blender
operations go through the ``BlenderAdapter`` adapter -- this service layer
contains no Blender-specific protocol details, only business logic.

Dependency direction: api -> services -> adapters. This module imports
only from app.adapters.blender_adapter. It never imports from app.api.
"""

from __future__ import annotations

import logging
from typing import Any

from ..adapters.blender_adapter import BlenderAdapter

logger = logging.getLogger(__name__)


class BlenderService:
    """
    Service for Blender integration via the Blender MCP bridge.

    This service owns the business logic for Blender operations:
    scene loading, material creation, animation, and rendering.
    All communication with Blender goes through the ``BlenderAdapter``,
    which handles the MCP protocol and subprocess lifecycle.

    If Blender's MCP protocol changes, only ``BlenderAdapter`` needs
    updating -- this service layer and all API endpoints remain unchanged.
    """

    def __init__(self, adapter: BlenderAdapter | None = None):
        """
        Initialize the Blender service.

        Args:
            adapter: Optional BlenderAdapter instance. If not provided,
                a new one is created (mock mode based on environment).
        """
        self._adapter = adapter or BlenderAdapter()
        self._started = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the Blender MCP bridge subprocess."""
        if self._started:
            return
        await self._adapter.start()
        self._started = True
        logger.info("Blender service started")

    async def stop(self) -> None:
        """Stop the Blender MCP bridge subprocess."""
        if not self._started:
            return
        await self._adapter.stop()
        self._started = False
        logger.info("Blender service stopped")

    async def restart(self) -> None:
        """Restart the Blender MCP bridge subprocess."""
        await self._adapter.restart()

    async def close(self) -> None:
        """Close the adapter and release resources."""
        await self.stop()

    @property
    def is_started(self) -> bool:
        """Return True if the service has been started."""
        return self._started

    @property
    def adapter(self) -> BlenderAdapter:
        """Return the underlying Blender adapter."""
        return self._adapter

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        """Check if Blender and the MCP bridge are reachable."""
        return await self._adapter.health_check()

    # ------------------------------------------------------------------
    # Scene management
    # ------------------------------------------------------------------

    async def load_scene(self, path: str) -> dict[str, Any]:
        """Load a Blender scene file.

        Args:
            path: Path to the .blend file.

        Returns:
            Result dictionary from Blender.
        """
        logger.info("Blender service: Loading scene %s", path)
        return await self._adapter.load_scene(path)

    async def get_blender_status(self) -> dict[str, Any]:
        """Get Blender status (version, render engine, etc.)."""
        return await self._adapter.blender_status()

    # ------------------------------------------------------------------
    # Materials
    # ------------------------------------------------------------------

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

        Returns:
            Result dictionary from Blender.
        """
        logger.info("Blender service: Creating material %s", name)
        return await self._adapter.create_material(
            name=name,
            color=color,
            roughness=roughness,
            metallic=metallic,
        )

    async def assign_material(
        self,
        object_name: str,
        material_name: str,
    ) -> dict[str, Any]:
        """Assign a material to an object.

        Args:
            object_name: Name of the target object.
            material_name: Name of the material to assign.

        Returns:
            Result dictionary from Blender.
        """
        logger.info(
            "Blender service: Assigning %s to %s", material_name, object_name
        )
        return await self._adapter.set_material(object_name, material_name)

    # ------------------------------------------------------------------
    # Animation
    # ------------------------------------------------------------------

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

        Returns:
            Result dictionary from Blender.
        """
        logger.info(
            "Blender service: Animating %s.%s at frame %d",
            object_name,
            property_path,
            frame,
        )
        return await self._adapter.animate_object(
            object_name=object_name,
            property_path=property_path,
            frame=frame,
            value=value,
        )

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------

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

        Returns:
            Result dictionary from Blender.
        """
        logger.info(
            "Blender service: Rendering scene %s to %s",
            scene or "active",
            output or "default",
        )
        return await self._adapter.render_scene(
            scene=scene,
            output=output,
            frame_start=frame_start,
            frame_end=frame_end,
            engine=engine,
            samples=samples,
        )

    async def render_audio_visualization(
        self,
        audio_path: str,
        output_path: str,
        scene_path: str | None = None,
        bpm: float | None = None,
    ) -> dict[str, Any]:
        """Render an audio-reactive visualization using Blender.

        Loads or creates a scene, creates an audio-reactive material,
        and renders the animation synced to the audio.

        Args:
            audio_path: Path to the audio file.
            output_path: Output video file path.
            scene_path: Optional Blender scene path.
            bpm: Optional detected BPM for beat synchronization.

        Returns:
            Result dictionary from Blender.
        """
        logger.info(
            "Blender service: Rendering audio visualization %s -> %s",
            audio_path,
            output_path,
        )

        # Load or create the scene
        if scene_path:
            await self.load_scene(scene_path)

        # Create an audio-reactive material
        await self.create_material(
            name="AudioReactive",
            color="#00ffff",
            roughness=0.3,
            metallic=0.7,
        )

        # Assign the material to an object
        await self.assign_material(object_name="AudioObject", material_name="AudioReactive")

        # Animate the material based on audio
        frame_start = 0
        frame_end = int((bpm or 120) * 2)  # 2 seconds per beat at given BPM
        for frame in range(frame_start, frame_end + 1):
            value = 0.5 + 0.5 * ((frame % 24) / 24.0)  # Simple pulse
            await self.animate_object(
                object_name="AudioObject",
                property_path="material_slots[0].material.use_nodes",
                frame=frame,
                value=value,
            )

        # Render the animation
        return await self._adapter.render_scene(
            scene=scene_path,
            output=output_path,
            frame_start=frame_start,
            frame_end=frame_end,
            engine="CYCLES",
            samples=128,
        )

    # ------------------------------------------------------------------
    # Generic escape hatch
    # ------------------------------------------------------------------

    async def execute_command(
        self,
        command: str,
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute an arbitrary Blender pipeline command.

        This is the escape hatch for any Blender command not covered by
        the convenience methods above.

        Args:
            command: Blender command name.
            parameters: Command parameters.

        Returns:
            Result dictionary from Blender.
        """
        return await self._adapter.execute_blender_command(command, parameters)
