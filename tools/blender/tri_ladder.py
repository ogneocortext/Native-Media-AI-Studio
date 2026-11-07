"""Render a triangle-count ladder for a GLB: one PNG per decimation level.

Run via Blender background mode:
    blender --background --python tri_ladder.py -- <input.glb> <out_dir> <counts_csv>

counts_csv is comma-separated target face counts; the literal "orig" renders
the undecimated mesh. Each level re-imports the source fresh so decimation
never compounds. PNGs land in <out_dir> as lod_<count|orig>.png.
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def _clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def _import_glb(path: str) -> list:
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def _face_count(meshes: list) -> int:
    return sum(len(o.data.polygons) for o in meshes if o.data)


def _decimate(meshes: list, target: int, total: int) -> None:
    ratio = max(target / total, 0.0001)
    for obj in meshes:
        if obj.type != "MESH" or not obj.data:
            continue
        mod = obj.modifiers.new(name="Decimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)


def _scene_bounds(meshes: list):
    mins = Vector((1e30, 1e30, 1e30))
    maxs = Vector((-1e30, -1e30, -1e30))
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            mins = Vector(map(min, mins, world))
            maxs = Vector(map(max, maxs, world))
    return mins, maxs


def _setup_camera_light(mins: Vector, maxs: Vector) -> None:
    center = (mins + maxs) / 2
    radius = (maxs - mins).length / 2
    dist = max(radius * 2.4, 0.5)

    cam_data = bpy.data.cameras.new("LadderCam")
    cam = bpy.data.objects.new("LadderCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    # 3/4 view: azimuth 45 deg, elevation ~30 deg
    direction = Vector((1.0, -1.0, 0.7)).normalized()
    cam.location = center + direction * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_end = dist * 10
    bpy.context.scene.camera = cam

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 4.0
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))

    world = bpy.data.worlds.new("W") if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.18, 0.18, 0.2, 1.0)
        bg.inputs[1].default_value = 0.6


def _render(out_dir: Path, name: str) -> None:
    scene = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = eng
            break
        except TypeError:
            continue
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(out_dir / f"{name}.png")
    scene.render.film_transparent = False
    bpy.ops.render.render(write_still=True)


def main() -> int:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) < 3:
        print("Usage: tri_ladder.py -- <input.glb> <out_dir> <counts_csv>")
        return 1
    src, out_dir, counts_csv = args[0], Path(args[1]), args[2]
    out_dir.mkdir(parents=True, exist_ok=True)

    counts = [c.strip() for c in counts_csv.split(",") if c.strip()]
    rendered = []
    for label in counts:
        _clear_scene()
        meshes = _import_glb(src)
        if not meshes:
            print(f"[ladder] no meshes imported for {src}")
            return 1
        total = _face_count(meshes)
        if label.lower() == "orig":
            name = "orig"
        else:
            target = int(label)
            _decimate(meshes, target, total)
            name = f"{target:,}".replace(",", "")
        _setup_camera_light(*_scene_bounds(meshes))
        _render(out_dir, f"lod_{name}")
        final = _face_count(meshes)
        rendered.append((label, total, final))
        print(f"[ladder] {label}: {total:,} -> {final:,} tris -> lod_{name}.png", flush=True)

    print(f"[ladder] done: {len(rendered)} levels in {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
