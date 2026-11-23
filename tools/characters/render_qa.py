"""QA render for hero_dj.blend — views at an idle mid-frame.

Run: blender --background hero_dj.blend --python tools/characters/render_qa.py -- [outdir]
Default outdir is <repo>/docs/scratch resolved from this file's location —
Blender's cwd is NOT the repo root, so a relative path lands outside it.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
repo_root = Path(__file__).resolve().parents[2]
outdir = Path(argv[0]) if argv else repo_root / "docs" / "scratch"
outdir.mkdir(parents=True, exist_ok=True)

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = 640
sc.render.resolution_y = 800
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = "PNG"
sc.frame_set(30)  # mid-idle

# Sun key light + cool fill
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
sc.collection.objects.link(sun)
fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
fill.data.energy = 300
fill.data.size = 3.0
fill.data.color = (0.55, 0.65, 1.0)
fill.location = (-2.5, -3.0, 2.2)
sc.collection.objects.link(fill)
fill.rotation_euler = (math.radians(65), 0, math.radians(-140))

cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam


def aim(cam_obj, loc, target):
    cam_obj.location = loc
    direction = Vector(target) - Vector(loc)
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


target = (0, 0, 0.92)
views = {
    "dj_front": ((0.0, -4.2, 1.35), target),
    "dj_q34": ((2.6, -3.4, 1.45), target),
    "dj_back": ((0.4, 4.0, 1.6), target),
}
for name, (loc, tgt) in views.items():
    aim(cam, loc, tgt)
    sc.render.filepath = str(outdir / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name)
