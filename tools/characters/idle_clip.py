"""Author the 'idle' animation clip on HouseRig_v1 — headless-safe.

Adds a 4 s loop (@24 fps) of subtle idle motion — breath sway, weight
shift, slow head look — to the rigged character in a .blend, stashes it
as an NLA track named 'idle' (glTF animation name), and exports GLB.

Loop closure: frame 1 and final frame key identical transforms.

Usage:
  blender --background hero.blend --python tools/characters/idle_clip.py -- \
      [--clip idle] [--out OUT.glb] [--fps 24] [--seconds 4]

Prints a single `CLIP_REPORT {...}` JSON line on stdout.
"""

import json
import sys

import bpy


def key(pb, frame: int, rot=None, loc=None) -> None:
    pb.keyframe_insert(data_path="rotation_euler", frame=frame, index=-1) if rot is not None else None
    if loc is not None:
        pb.keyframe_insert(data_path="location", frame=frame, index=-1)


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

    def opt(flag: str, default: str) -> str:
        return argv[argv.index(flag) + 1] if flag in argv else default

    clip = opt("--clip", "idle")
    out_glb = opt("--out", "")
    fps = int(opt("--fps", "24"))
    seconds = float(opt("--seconds", "4"))

    arm = bpy.data.objects.get("HouseRig_v1")
    if arm is None:
        print("CLIP_REPORT " + json.dumps({"ok": False, "reason": "HouseRig_v1 not in file"}))
        return

    sc = bpy.context.scene
    sc.render.fps = fps
    f_end = int(seconds * fps)
    sc.frame_start = 1
    sc.frame_end = f_end + 1  # +1 so last keyed frame == first (loop closure)

    # Clear existing animation on the rig
    arm.animation_data_clear()

    act = bpy.data.actions.new(clip)
    arm.animation_data_create()
    arm.animation_data.action = act

    def pb(name: str):
        return arm.pose.bones.get(name)

    hips, spine, spine1, neck, head = pb("Hips"), pb("Spine"), pb("Spine1"), pb("Neck"), pb("Head")
    arm_l, arm_r = pb("Arm.L"), pb("Arm.R")
    fore_l, fore_r = pb("ForeArm.L"), pb("ForeArm.R")
    hand_l, hand_r = pb("Hand.L"), pb("Hand.R")

    # Key poses (frame, hips_loc_z, hips_rot_y, spine_rot_x, spine1_rot_z,
    # head_rot_y, head_rot_x, arm_l_z, arm_r_z). Radians, XYZ euler.
    poses = [
        (1, 0.0, 0.0, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
        (f_end // 4, 0.012, 0.02, 0.02, 0.015, 0.10, -0.02, 0.04, -0.03),
        (f_end // 2, -0.006, -0.015, -0.01, -0.01, -0.06, 0.02, -0.03, 0.05),
        (3 * f_end // 4, 0.010, 0.01, 0.015, 0.01, 0.14, -0.01, 0.05, -0.04),
        (f_end, 0.0, 0.0, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
        (f_end + 1, 0.0, 0.0, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
    ]

    for frame, hz, hy, sx, s1z, hd_y, hd_x, al_z, ar_z in poses:
        hips.location = (0, 0, 0.95 + hz)
        hips.rotation_euler = (0.0, hy, 0.0)
        hips.keyframe_insert("location", frame=frame)
        hips.keyframe_insert("rotation_euler", frame=frame)
        for bone, rx, rz in ((spine, sx, 0.0), (spine1, 0.0, s1z)):
            bone.rotation_euler = (rx, 0.0, rz)
            bone.keyframe_insert("rotation_euler", frame=frame)
        head.rotation_euler = (hd_x, hd_y, 0.0)
        head.keyframe_insert("rotation_euler", frame=frame)
        neck.rotation_euler = (hd_x * 0.4, hd_y * 0.4, 0.0)
        neck.keyframe_insert("rotation_euler", frame=frame)
        for bone, rz in ((arm_l, al_z), (arm_r, ar_z)):
            bone.rotation_euler = (0.0, 0.0, rz)
            bone.keyframe_insert("rotation_euler", frame=frame)
        for bone in (fore_l, fore_r, hand_l, hand_r):
            bone.rotation_euler = (0.0, 0.0, 0.0)
            bone.keyframe_insert("rotation_euler", frame=frame)

    # Gentle ease: linear is fine at 24fps for subtle motion; set cyclic
    # via NLA loop later if needed.

    # Stash to NLA track named after the clip -> glTF animation name
    if arm.animation_data and arm.animation_data.nla_tracks:
        for tr in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(tr)
    tr = arm.animation_data.nla_tracks.new()
    tr.name = clip
    tr.strips.new(clip, 1, act)
    arm.animation_data.action = None  # let NLA own it

    if out_glb:
        bpy.ops.export_scene.gltf(
            filepath=out_glb,
            export_format="GLB",
            export_animations=True,
            export_animation_mode="ACTIONS",
            export_yup=True,
            export_apply=True,
        )

    # count keyed fcurves across slotted actions
    n_keys = 0
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                n_keys += len(cb.fcurves)
    report = {
        "ok": True,
        "clip": clip,
        "fps": fps,
        "frames": f_end + 1,
        "fcurves": n_keys,
        "glb": out_glb or None,
    }
    print("CLIP_REPORT " + json.dumps(report))


main()
