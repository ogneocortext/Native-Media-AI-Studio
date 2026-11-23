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
from mathutils import Euler

# Relaxed stance: upper arms hang ~66 deg below the T-pose (euler x on the
# bone-local frame), forearms carry a slight elbow bend. Verified against
# HouseRig_v1: Arm.* are XYZ-euler bones, ForeArm.*/Hand.* are quaternion.
ARM_X = -1.15  # upper-arm pitch (radians) — hand drops to ~z 0.95
FOREARM_BEND = -0.45  # forearm local-z quaternion bend (elbow flex)


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
    save_blend = opt("--save-blend", "")
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
    # head_rot_y, head_rot_x, arm_l_sway_y, arm_r_sway_y). Radians, XYZ euler.
    # Arm sway is on local Y: with the arm lowered it reads as a relaxed
    # forward/back swing instead of the old T-pose propeller.
    poses = [
        (1, 0.0, 0.0, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
        (f_end // 4, 0.012, 0.02, 0.02, 0.015, 0.10, -0.02, 0.10, -0.08),
        (f_end // 2, -0.006, -0.015, -0.01, -0.01, -0.06, 0.02, -0.08, 0.10),
        (3 * f_end // 4, 0.010, 0.01, 0.015, 0.01, 0.14, -0.01, 0.12, -0.10),
        (f_end, 0.0, 0.0, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
        (f_end + 1, 0.0, 0.0, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
    ]

    # Nearly every bone on HouseRig_v1 is QUATERNION rotation mode (only
    # Arm.L was XYZ). keyframe_insert("rotation_euler") on a quaternion bone
    # writes fcurves the depsgraph ignores — silent no-op. Normalize all
    # keyed bones to QUATERNION and key rotation_quaternion; euler intents
    # convert 1:1 via Euler.to_quaternion() (verified symmetric on Arm.R).
    keyed = (hips, spine, spine1, neck, head, arm_l, arm_r,
             fore_l, fore_r, hand_l, hand_r)
    for bone in keyed:
        bone.rotation_mode = "QUATERNION"

    def key_rot(bone, euler) -> None:
        bone.rotation_quaternion = Euler(euler).to_quaternion()
        bone.keyframe_insert("rotation_quaternion", frame=frame)

    for frame, hz, hy, sx, s1z, hd_y, hd_x, al_y, ar_y in poses:
        hips.location = (0, 0, 0.95 + hz)
        hips.keyframe_insert("location", frame=frame)
        key_rot(hips, (0.0, hy, 0.0))
        key_rot(spine, (sx, 0.0, 0.0))
        key_rot(spine1, (0.0, 0.0, s1z))
        key_rot(head, (hd_x, hd_y, 0.0))
        key_rot(neck, (hd_x * 0.4, hd_y * 0.4, 0.0))
        key_rot(arm_l, (ARM_X, al_y, 0.0))
        key_rot(arm_r, (ARM_X, ar_y, 0.0))
        key_rot(fore_l, (0.0, 0.0, FOREARM_BEND))
        key_rot(fore_r, (0.0, 0.0, FOREARM_BEND))
        key_rot(hand_l, (0.0, 0.0, 0.0))
        key_rot(hand_r, (0.0, 0.0, 0.0))

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
    if save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=save_blend)

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
