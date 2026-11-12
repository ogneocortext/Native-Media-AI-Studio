#!/usr/bin/env python3
"""Maya 2.5D cutout rig -- starter builder (Blender 5.3).

Builds a poseable "paper doll" scene from layered character art:
one alpha plane per layer, a small armature (root / spine / head /
hair / arm.L / arm.R), an orthographic front camera, and Eevee
render settings sized for Shorts (720x1280, transparent film).

Usage (from the repo root, on the rig):

    blender --background --python tools/blender-rig/maya_cutout_rig.py -- \
        --layers-dir path/to/layers --out path/to/maya_rig.blend

    # smoke test with a single full-character image instead:
    blender --background --python tools/blender-rig/maya_cutout_rig.py -- \
        --single path/to/sticker.png --out path/to/maya_rig.blend

Layer contract: every layer is a PNG on the SAME canvas size
(1024x1024 recommended) with alpha, so layers register without
manual alignment. Recognised layer names, back to front:

    base.png  head.png  hair.png  arm_l.png  arm_r.png

Missing layers are skipped with a warning, so a partial layer set
still builds. Each plane is parented to the bone of the same name
(arm_l -> arm.L, arm_r -> arm.R, hair -> hair, head -> head,
everything else -> spine).

STATUS: v0.1 starter. Written in the sandbox and NOT yet run in
Blender -- the first rig run is a verification step. API use is
deliberately conservative (manual mesh + shader nodes instead of
the images-as-planes addon) to survive version differences.
"""

import argparse
import os
import sys

import bpy

# Back-to-front layer order and the bone each layer follows.
LAYERS = [
    ("base", "spine", 0.00),
    ("head", "head", 0.02),
    ("hair", "hair", 0.04),
    ("arm_l", "arm.L", 0.06),
    ("arm_r", "arm.R", 0.08),
]

BONES = ["root", "spine", "head", "hair", "arm.L", "arm.R"]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Build the Maya 2.5D cutout rig.")
    p.add_argument("--layers-dir", default=None,
                   help="Folder holding base/head/hair/arm_l/arm_r PNGs.")
    p.add_argument("--single", default=None,
                   help="Single full-character PNG (smoke-test mode).")
    p.add_argument("--out", default=None,
                   help="Where to save the .blend (optional).")
    p.add_argument("--size", type=float, default=2.0,
                   help="Character height in Blender units (default 2.0).")
    return p.parse_args(argv)


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for _ in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures,
                       bpy.data.cameras, bpy.data.lights):
        pass  # orphaned datablocks are purged on save/reload; harmless here


def make_material(name, image_path):
    """Principled material driven by the image's colour + alpha."""
    img = bpy.data.images.load(os.path.abspath(image_path))
    mat = bpy.data.materials.new(name="MAT_" + name)
    mat.use_nodes = True
    # Surface the alpha in the viewport and at render time.
    try:
        mat.surface_render_method = "DITHERED"
    except Exception:
        pass  # older Blender: blend method default is fine for Eevee
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 1.0
    return mat, img


def make_plane(name, image_path, size, z_offset):
    mat, img = make_material(name, image_path)
    aspect = img.size[0] / img.size[1] if img.size[1] else 1.0
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    plane.name = "LYR_" + name
    plane.dimensions = (size * aspect, size, 0.0)
    plane.location = (0.0, z_offset, size / 2.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    plane.data.materials.append(mat)
    return plane


def make_armature():
    arm_data = bpy.data.armatures.new("MayaRig")
    arm = bpy.data.objects.new("MayaRig", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    # (name, head, tail, parent) -- character faces -Y, up is +Z.
    bone_defs = [
        ("root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.4), None),
        ("spine", (0.0, 0.0, 0.4), (0.0, 0.0, 1.2), "root"),
        ("head", (0.0, 0.0, 1.2), (0.0, 0.0, 1.8), "spine"),
        ("hair", (0.0, 0.0, 1.5), (0.0, 0.0, 2.0), "head"),
        ("arm.L", (-0.25, 0.0, 1.15), (-0.6, 0.0, 0.7), "spine"),
        ("arm.R", (0.25, 0.0, 1.15), (0.6, 0.0, 0.7), "spine"),
    ]
    for name, head, tail, parent in bone_defs:
        bone = arm_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        if parent:
            bone.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def parent_to_bone(obj, arm, bone_name):
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    # Bone parenting moves the child into bone space; compensate by
    # keeping the object's world transform as authored.
    obj.matrix_parent_inverse = arm.matrix_world.inverted()


def main():
    args = parse_args()
    if not args.layers_dir and not args.single:
        print("ERROR: pass --layers-dir or --single")
        return 1

    clean_scene()
    arm = make_armature()

    planes = []
    if args.single:
        planes.append((make_plane("single", args.single, args.size, 0.0),
                       "spine"))
    else:
        for layer_name, bone_name, z in LAYERS:
            path = os.path.join(args.layers_dir, layer_name + ".png")
            if not os.path.exists(path):
                print("WARN: missing layer, skipped:", path)
                continue
            planes.append((make_plane(layer_name, path, args.size, z),
                           bone_name))
    if not planes:
        print("ERROR: no layers found -- nothing to rig")
        return 1
    for plane, bone_name in planes:
        parent_to_bone(plane, arm, bone_name)

    # Orthographic front camera (character faces -Y).
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = args.size * 1.15
    cam = bpy.data.objects.new("Camera", cam_data)
    cam.location = (0.0, -5.0, args.size / 2.0)
    cam.rotation_euler = (1.5707963, 0.0, 0.0)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 1280
    scene.render.film_transparent = True
    scene.render.fps = 24

    if args.out:
        out_path = os.path.abspath(args.out)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=out_path)
        print("Saved rig:", out_path)
    print("Rig built:", len(planes), "layer plane(s), bones:", ", ".join(BONES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
