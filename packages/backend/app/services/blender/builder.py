"""
Blender scene builder for music video generation.

Generates Blender Python scripts that create 3D scenes with:
- Stages/environments built from text prompts
- Characters with poseable rigs
- Props and scenery
- Beat-synced animation driven by audio analysis
- GPU rendering (Cycles CUDA / EEVEE real-time)

The generated scripts are executed via Blender MCP, which runs Blender's
Python API headlessly or with a live viewport.
"""

from __future__ import annotations

import json
import logging
import textwrap
from typing import Any

logger = logging.getLogger(__name__)


class BlenderSceneBuilder:
    """Builds Blender Python scripts for music video scene generation.

    Each method returns a string of Python code that can be executed via
    Blender MCP's Python execution tool. The code uses bpy (Blender's Python API).
    """

    def __init__(self, render_engine: str = "CYCLES", resolution: tuple[int, int] = (1920, 1080), fps: int = 24):
        self.render_engine = render_engine
        self.resolution = resolution
        self.fps = fps

    def clear_scene(self) -> str:
        """Generate code to clear the default scene."""
        return textwrap.dedent("""\
            import bpy
            bpy.ops.object.select_all(action='SELECT')
            bpy.ops.object.delete(use_global=False)
            # Remove orphan data
            for block in bpy.data.meshes:
                bpy.data.meshes.remove(block)
            for block in bpy.data.materials:
                bpy.data.materials.remove(block)
            for block in bpy.data.cameras:
                bpy.data.data.cameras.remove(block)
            for block in bpy.data.lights:
                bpy.data.lights.remove(block)
            print("Scene cleared")
        """)

    def setup_render_settings(self, engine: str | None = None, samples: int = 128) -> str:
        """Generate code to configure GPU rendering."""
        engine = engine or self.render_engine
        return textwrap.dedent(f"""\
            import bpy
            scene = bpy.context.scene
            scene.render.engine = '{engine}'
            scene.render.resolution_x = {self.resolution[0]}
            scene.render.resolution_y = {self.resolution[1]}
            scene.render.fps = {self.fps}
            scene.render.image_settings.file_format = 'PNG'
            scene.render.image_settings.color_mode = 'RGBA'
            scene.render.image_settings.color_depth = '16'
            scene.render.filepath = "//render_frames/frame_####.png"
            scene.frame_start = 1
            scene.frame_end = 250  # Will be updated based on audio duration

            if '{engine}' == 'CYCLES':
                scene.cycles.samples = {samples}
                scene.cycles.use_adaptive_sampling = True
                scene.cycles.adaptive_threshold = 0.01
                # GPU rendering via CUDA
                scene.cycles.device = 'GPU'
                # Enable CUDA compute
                prefs = bpy.context.preferences.addons.get('cycles')
                if prefs:
                    cprefs = prefs.preferences
                    cprefs.get_devices()
                    cprefs.compute_device_type = 'CUDA'
                    for device in cprefs.devices:
                        device.use = (device.type == 'CUDA')
                print("Cycles CUDA rendering configured")
            elif '{engine}' == 'BLENDER_EEVEE':
                scene.eevee.taa_render_samples = {samples}
                scene.eevee.use_gtao = True
                scene.eevee.use_bloom = True
                scene.eevee.use_ssr = True
                print("EEVEE rendering configured")
        """)

    def create_stage(self, stage_type: str = "concert") -> str:
        """Generate code to create a stage/environment."""
        stages = {
            "concert": self._concert_stage(),
            "abstract": self._abstract_stage(),
            "nature": self._nature_stage(),
            "urban": self._urban_stage(),
            "space": self._space_stage(),
        }
        return stages.get(stage_type, stages["abstract"])

    def _concert_stage(self) -> str:
        return textwrap.dedent("""\
            import bpy
            import math

            # Floor
            bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
            floor = bpy.context.active_object
            floor.name = "StageFloor"
            mat = bpy.data.materials.new(name="Floor_Mat")
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes["Principled BSDF"]
            bsdf.inputs['Base Color'].default_value = (0.05, 0.05, 0.08, 1)
            bsdf.inputs['Roughness'].default_value = 0.3
            bsdf.inputs['Metallic'].default_value = 0.8
            floor.data.materials.append(mat)

            # Back wall
            bpy.ops.mesh.primitive_plane_add(size=20, location=(0, -8, 5))
            wall = bpy.context.active_object
            wall.name = "BackWall"
            wall.rotation_euler = (math.radians(90), 0, 0)
            wmat = bpy.data.materials.new(name="Wall_Mat")
            wmat.use_nodes = True
            wmat.node_tree.nodes["Principled BSDF"].inputs['Base Color'].default_value = (0.02, 0.02, 0.05, 1)
            wall.data.materials.append(wmat)

            # Stage lights
            bpy.ops.object.light_add(type='SPOT', location=(0, -5, 8))
            spot = bpy.context.active_object
            spot.name = "MainSpot"
            spot.data.energy = 1000
            spot.data.spot_size = math.radians(45)
            spot.data.spot_blend = 0.3
            spot.rotation_euler = (math.radians(70), 0, 0)

            # Colored accent lights
            for i, (x, color) in enumerate([(-5, (1, 0.1, 0.3)), (5, (0.1, 0.3, 1)), (0, (0.1, 1, 0.5))]):
                bpy.ops.object.light_add(type='AREA', location=(x, -3, 6))
                light = bpy.context.active_object
                light.name = f"Accent_{i}"
                light.data.energy = 300
                light.data.color = color
                light.data.size = 3
                light.rotation_euler = (math.radians(60), 0, 0)

            print("Concert stage created")
        """)

    def _abstract_stage(self) -> str:
        return textwrap.dedent("""\
            import bpy
            import math

            # Reflective floor
            bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
            floor = bpy.context.active_object
            floor.name = "Floor"
            mat = bpy.data.materials.new(name="Floor_Mat")
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes["Principled BSDF"]
            bsdf.inputs['Base Color'].default_value = (0.01, 0.01, 0.02, 1)
            bsdf.inputs['Roughness'].default_value = 0.05
            bsdf.inputs['Metallic'].default_value = 1.0
            floor.data.materials.append(mat)

            # Floating geometric shapes as backdrop
            for i in range(8):
                x = (i - 4) * 4
                bpy.ops.mesh.primitive_ico_sphere_add(radius=1.5, location=(x, -10 + (i % 3) * 2, 3 + (i % 4)))
                obj = bpy.context.active_object
                obj.name = f"Geo_{i}"
                m = bpy.data.materials.new(name=f"Geo_Mat_{i}")
                m.use_nodes = True
                hue = (i * 0.13) % 1.0
                # Simple HSV to RGB
                import colorsys
                r, g, b = colorsys.hsv_to_rgb(hue, 0.8, 1.0)
                m.node_tree.nodes["Principled BSDF"].inputs['Base Color'].default_value = (r, g, b, 1)
                m.node_tree.nodes["Principled BSDF"].inputs['Emission Color'].default_value = (r, g, b, 1)
                m.node_tree.nodes["Principled BSDF"].inputs['Emission Strength'].default_value = 0.5
                obj.data.materials.append(m)

            # Volumetric light
            bpy.ops.object.light_add(type='AREA', location=(0, -5, 5))
            light = bpy.context.active_object
            light.name = "KeyLight"
            light.data.energy = 500
            light.data.size = 5
            light.rotation_euler = (math.radians(75), 0, 0)

            print("Abstract stage created")
        """)

    def _nature_stage(self) -> str:
        return textwrap.dedent("""\
            import bpy
            import math

            # Ground terrain
            bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
            ground = bpy.context.active_object
            ground.name = "Ground"
            # Subdivide for terrain
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.subdivide(number_cuts=20)
            bpy.ops.object.mode_set(mode='OBJECT')
            # Add displacement modifier for hills
            mod = ground.modifiers.new(name="Displace", type='DISPLACE')
            tex = bpy.data.textures.new(name="TerrainTex", type='MARBLE')
            tex.noise_scale = 5.0
            mod.texture = tex
            mod.strength = 2.0
            gmat = bpy.data.materials.new(name="Ground_Mat")
            gmat.use_nodes = True
            gmat.node_tree.nodes["Principled BSDF"].inputs['Base Color'].default_value = (0.1, 0.25, 0.05, 1)
            ground.data.materials.append(gmat)

            # Sun light
            bpy.ops.object.light_add(type='SUN', location=(5, 5, 15))
            sun = bpy.context.active_object
            sun.name = "Sun"
            sun.data.energy = 5
            sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(30))

            print("Nature stage created")
        """)

    def _urban_stage(self) -> str:
        return textwrap.dedent("""\
            import bpy
            import math
            import random

            # Street floor
            bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
            floor = bpy.context.active_object
            floor.name = "Street"
            mat = bpy.data.materials.new(name="Asphalt_Mat")
            mat.use_nodes = True
            mat.node_tree.nodes["Principled BSDF"].inputs['Base Color'].default_value = (0.08, 0.08, 0.09, 1)
            mat.node_tree.nodes["Principled BSDF"].inputs['Roughness'].default_value = 0.8
            floor.data.materials.append(mat)

            # Buildings
            for row in range(3):
                for col in range(6):
                    x = (col - 3) * 5
                    y = -8 - row * 6
                    h = random.uniform(4, 12)
                    bpy.ops.mesh.primitive_cube_add(size=2, location=(x, y, h/2))
                    bldg = bpy.context.active_object
                    bldg.scale = (2, 2, h/2)
                    bldg.name = f"Building_{row}_{col}"
                    bmat = bpy.data.materials.new(name=f"Bldg_Mat_{row}_{col}")
                    bmat.use_nodes = True
                    bmat.node_tree.nodes["Principled BSDF"].inputs['Base Color'].default_value = (0.1 + row*0.05, 0.1, 0.15, 1)
                    bldg.data.materials.append(bmat)

            # Neon accent lights
            for i in range(4):
                bpy.ops.object.light_add(type='AREA', location=((i-2)*6, -10, 3))
                light = bpy.context.active_object
                light.name = f"Neon_{i}"
                light.data.energy = 200
                import colorsys
                r, g, b = colorsys.hsv_to_rgb(i * 0.25, 1, 1)
                light.data.color = (r, g, b)
                light.data.size = 2

            print("Urban stage created")
        """)

    def _space_stage(self) -> str:
        return textwrap.dedent("""\
            import bpy
            import math
            import random

            # Black void floor
            bpy.ops.mesh.primitive_plane_add(size=50, location=(0, 0, 0))
            floor = bpy.context.active_object
            floor.name = "Void"
            mat = bpy.data.materials.new(name="Void_Mat")
            mat.use_nodes = True
            mat.node_tree.nodes["Principled BSDF"].inputs['Base Color'].default_value = (0.001, 0.001, 0.005, 1)
            mat.node_tree.nodes["Principled BSDF"].inputs['Roughness'].default_value = 0.1
            mat.node_tree.nodes["Principled BSDF"].inputs['Metallic'].default_value = 0.9
            floor.data.materials.append(mat)

            # Floating crystals/asteroids
            for i in range(15):
                x = random.uniform(-10, 10)
                y = random.uniform(-10, 5)
                z = random.uniform(0, 8)
                bpy.ops.mesh.primitive_ico_sphere_add(radius=random.uniform(0.3, 2), location=(x, y, z))
                obj = bpy.context.active_object
                obj.name = f"Crystal_{i}"
                m = bpy.data.materials.new(name=f"Crystal_Mat_{i}")
                m.use_nodes = True
                hue = random.random()
                import colorsys
                r, g, b = colorsys.hsv_to_rgb(hue, 0.6, 1.0)
                m.node_tree.nodes["Principled BSDF"].inputs['Emission Color'].default_value = (r, g, b, 1)
                m.node_tree.nodes["Principled BSDF"].inputs['Emission Strength'].default_value = 2.0
                obj.data.materials.append(m)

            # Dramatic rim lighting
            bpy.ops.object.light_add(type='SPOT', location=(0, -8, 5))
            spot = bpy.context.active_object
            spot.name = "RimLight"
            spot.data.energy = 2000
            spot.data.spot_size = math.radians(30)
            spot.data.color = (0.6, 0.8, 1.0)
            spot.rotation_euler = (math.radians(80), 0, 0)

            print("Space stage created")
        """)

    def create_character(self, name: str = "Character", style: str = "humanoid") -> str:
        """Generate code to create a poseable character."""
        return textwrap.dedent(f"""\
            import bpy
            import math

            # Create a simple humanoid rig using meta-rig
            bpy.ops.object.armature_add(location=(0, 0, 1))
            armature = bpy.context.active_object
            armature.name = "{name}_Rig"
            armature.data.display_type = 'STICK'

            # Enter edit mode to build basic skeleton
            bpy.context.view_layer.objects.active = armature
            bpy.ops.object.mode_set(mode='EDIT')
            bones = armature.data.edit_bones

            # Spine
            spine = bones.new("Spine")
            spine.head = (0, 0, 1.0)
            spine.tail = (0, 0, 1.4)

            # Chest
            chest = bones.new("Chest")
            chest.head = (0, 0, 1.4)
            chest.tail = (0, 0, 1.7)
            chest.parent = spine

            # Head
            head = bones.new("Head")
            head.head = (0, 0, 1.7)
            head.tail = (0, 0, 1.9)
            head.parent = chest

            # Arms
            for side, sign in [("L", -1), ("R", 1)]:
                upper = bones.new(f"UpperArm_{{side}}")
                upper.head = (sign * 0.2, 0, 1.65)
                upper.tail = (sign * 0.5, 0, 1.5)
                upper.parent = chest

                lower = bones.new(f"LowerArm_{{side}}")
                lower.head = (sign * 0.5, 0, 1.5)
                lower.tail = (sign * 0.7, 0, 1.3)
                lower.parent = upper

            # Legs
            for side, sign in [("L", -1), ("R", 1)]:
                upper = bones.new(f"UpperLeg_{{side}}")
                upper.head = (sign * 0.1, 0, 1.0)
                upper.tail = (sign * 0.1, 0, 0.5)
                upper.parent = spine

                lower = bones.new(f"LowerLeg_{{side}}")
                lower.head = (sign * 0.1, 0, 0.5)
                lower.tail = (sign * 0.1, 0, 0.0)
                lower.parent = upper

            bpy.ops.object.mode_set(mode='OBJECT')

            # Add simple mesh body (capsule)
            bpy.ops.mesh.primitive_cylinder_add(radius=0.25, depth=1.4, location=(0, 0, 1.0))
            body = bpy.context.active_object
            body.name = "{name}_Body"
            bmat = bpy.data.materials.new(name="{name}_Mat")
            bmat.use_nodes = True
            bmat.node_tree.nodes["Principled BSDF"].inputs['Base Color'].default_value = (0.8, 0.6, 0.5, 1)
            body.data.materials.append(bmat)

            # Parent mesh to armature
            body.select_set(True)
            armature.select_set(True)
            bpy.context.view_layer.objects.active = armature
            bpy.ops.object.parent_set(type='ARMATURE_AUTO')

            print(f"Character '{{name}}' created with rig")
        """)

    def create_camera(self, location: tuple[float, float, float] = (0, -6, 2), target: tuple[float, float, float] = (0, 0, 1.5)) -> str:
        """Generate code to create a camera with tracking constraint."""
        return textwrap.dedent(f"""\
            import bpy
            bpy.ops.object.camera_add(location={location})
            cam = bpy.context.active_object
            cam.name = "MainCamera"
            cam.data.lens = 35
            cam.data.clip_start = 0.1
            cam.data.clip_end = 100

            # Point camera at target
            direction = bpy.mathutils.Vector({target}) - bpy.mathutils.Vector({location})
            rot_quat = direction.to_track_quat('-Z', 'Y')
            cam.rotation_euler = rot_quat.to_euler()

            # Set as active camera
            bpy.context.scene.camera = cam
            print("Camera created at {location}")
        """)

    def animate_to_beats(self, beat_times: list[float], intensity: float = 1.0) -> str:
        """Generate code to animate objects in sync with beat timestamps."""
        beats_json = json.dumps(beat_times)
        return textwrap.dedent(f"""\
            import bpy
            import math

            beat_times = {beats_json}
            intensity = {intensity}
            fps = {self.fps}

            # Animate all lights to pulse on beats
            for obj in bpy.data.objects:
                if obj.type == 'LIGHT':
                    base_energy = obj.data.energy
                    for beat_time in beat_times:
                        frame = int(beat_time * fps)
                        # Pulse up
                        obj.data.energy = base_energy * (1.5 + intensity)
                        obj.data.keyframe_insert(data_path="energy", frame=frame)
                        # Back to normal
                        obj.data.energy = base_energy
                        obj.data.keyframe_insert(data_path="energy", frame=frame + 3)

                elif obj.name.startswith("Geo_") or obj.name.startswith("Crystal_"):
                    # Scale bounce on beats
                    base_scale = obj.scale.copy()
                    for i, beat_time in enumerate(beat_times):
                        frame = int(beat_time * fps)
                        # Squash-stretch
                        obj.scale = (base_scale.x * 1.2, base_scale.y * 1.2, base_scale.z * 0.8)
                        obj.keyframe_insert(data_path="scale", frame=frame)
                        obj.scale = base_scale
                        obj.keyframe_insert(data_path="scale", frame=frame + 4)
                        # Slight rotation
                        obj.rotation_euler.z += math.radians(15) * intensity
                        obj.keyframe_insert(data_path="rotation_euler", frame=frame + 2)

            # Animate character if present
            rig = bpy.data.objects.get("Character_Rig")
            if rig and rig.type == 'ARMATURE':
                bpy.context.view_layer.objects.active = rig
                bpy.ops.object.mode_set(mode='POSE')
                for beat_time in beat_times:
                    frame = int(beat_time * fps)
                    # Arm swing
                    for bone_name in ["UpperArm_L", "UpperArm_R"]:
                        bone = rig.pose.bones.get(bone_name)
                        if bone:
                            bone.rotation_euler.x = math.radians(-20) * intensity
                            bone.keyframe_insert(data_path="rotation_euler", frame=frame)
                            bone.rotation_euler.x = 0
                            bone.keyframe_insert(data_path="rotation_euler", frame=frame + 4)
                bpy.ops.object.mode_set(mode='OBJECT')

            print(f"Beat animation applied: {{len(beat_times)}} beats")
        """)

    def add_lyrics_text(self, lyrics: list[dict[str, Any]]) -> str:
        """Generate code to add animated lyric text objects."""
        lyrics_json = json.dumps(lyrics)
        return textwrap.dedent(f"""\
            import bpy

            lyrics_data = {lyrics_json}
            fps = {self.fps}

            for i, lyric in enumerate(lyrics_data):
                text = lyric.get("text", "")
                start_time = lyric.get("start", 0)
                end_time = lyric.get("end", start_time + 2)

                bpy.ops.object.text_add(location=(0, 0, 3))
                txt = bpy.context.active_object
                txt.name = f"Lyric_{{i}}"
                txt.data.body = text
                txt.data.size = 0.5
                txt.data.align_x = 'CENTER'

                # Material
                mat = bpy.data.materials.new(name=f"Lyric_Mat_{{i}}")
                mat.use_nodes = True
                mat.node_tree.nodes["Principled BSDF"].inputs['Emission Color'].default_value = (1, 1, 1, 1)
                mat.node_tree.nodes["Principled BSDF"].inputs['Emission Strength'].default_value = 1.0
                txt.data.materials.append(mat)

                # Animate visibility
                start_frame = int(start_time * fps)
                end_frame = int(end_time * fps)

                # Fade in
                txt.hide_render = True
                txt.keyframe_insert(data_path="hide_render", frame=start_frame - 1)
                txt.hide_render = False
                txt.keyframe_insert(data_path="hide_render", frame=start_frame)
                # Fade out
                txt.hide_render = False
                txt.keyframe_insert(data_path="hide_render", frame=end_frame - 1)
                txt.hide_render = True
                txt.keyframe_insert(data_path="hide_render", frame=end_frame)

            print(f"Added {{len(lyrics_data)}} lyric text objects")
        """)

    def setup_compositor(self) -> str:
        """Generate code to setup the compositor for color grading and effects."""
        return textwrap.dedent("""\
            import bpy
            scene = bpy.context.scene
            scene.use_nodes = True
            scene.render.use_compositing = True

            tree = scene.node_tree
            nodes = tree.nodes
            links = tree.links
            nodes.clear()

            # Render layers
            render_layers = nodes.new('CompositorNodeRLayers')
            render_layers.location = (0, 0)

            # Glare (bloom)
            glare = nodes.new('CompositorNodeGlare')
            glare.location = (200, 0)
            glare.glare_type = 'FOG_GLOW'
            glare.quality = 'HIGH'
            glare.mix = 0.3
            glare.threshold = 0.8

            # Color balance
            color_balance = nodes.new('CompositorNodeColorBalance')
            color_balance.location = (400, 0)
            color_balance.correction_method = 'LIFT_GAMMA_GAIN'
            color_balance.lift = (0.95, 0.95, 1.05)
            color_balance.gamma = (1.0, 1.0, 1.0)
            color_balance.gain = (1.1, 1.0, 1.0)

            # Vignette
            vignette = nodes.new('CompositorNodeLensdist')
            vignette.location = (600, 0)
            vignette.inputs['Distort'].default_value = 0.05
            vignette.inputs['Dispersion'].default_value = 0.02

            # Composite output
            composite = nodes.new('CompositorNodeComposite')
            composite.location = (800, 0)

            # Link nodes
            links.new(render_layers.outputs['Image'], glare.inputs['Image'])
            links.new(glare.outputs['Image'], color_balance.inputs['Image'])
            links.new(color_balance.outputs['Image'], vignette.inputs['Image'])
            links.new(vignette.outputs['Image'], composite.inputs['Image'])

            print("Compositor setup complete (bloom + color grade + vignette)")
        """)

    def render_animation(self, output_path: str = "//render_frames", frame_end: int | None = None) -> str:
        """Generate code to render the animation."""
        frame_end_code = f"bpy.context.scene.frame_end = {frame_end}" if frame_end else ""
        return textwrap.dedent(f"""\
            import bpy
            import os

            scene = bpy.context.scene
            scene.render.filepath = "{output_path}/frame_####.png"
            {frame_end_code}

            # Ensure output directory exists
            output_dir = bpy.path.abspath("{output_path}")
            os.makedirs(output_dir, exist_ok=True)

            print(f"Rendering to: {{output_dir}}")
            print(f"Frames: {{scene.frame_start}} to {{scene.frame_end}}")
            bpy.ops.render.render(animation=True)
            print("Render complete")
        """)

    def build_full_scene(self, config: dict[str, Any]) -> list[str]:
        """Build a complete scene script sequence from a config dict.

        Returns a list of Python code strings to execute in order.
        """
        scripts = []
        scripts.append(self.clear_scene())
        scripts.append(self.setup_render_settings(
            engine=config.get("engine", self.render_engine),
            samples=config.get("samples", 128),
        ))

        stage = config.get("stage", "abstract")
        scripts.append(self.create_stage(stage))

        if config.get("character", True):
            scripts.append(self.create_character(
                name=config.get("character_name", "Character"),
            ))

        scripts.append(self.create_camera(
            location=tuple(config.get("camera_location", [0, -6, 2])),
            target=tuple(config.get("camera_target", [0, 0, 1.5])),
        ))

        beats = config.get("beat_times", [])
        if beats:
            scripts.append(self.animate_to_beats(
                beat_times=beats,
                intensity=config.get("beat_intensity", 1.0),
            ))

        lyrics = config.get("lyrics", [])
        if lyrics:
            scripts.append(self.add_lyrics_text(lyrics))

        if config.get("compositor", True):
            scripts.append(self.setup_compositor())

        return scripts


# Singleton
default_builder = BlenderSceneBuilder()
