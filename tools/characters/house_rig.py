"""HouseRig_v1 armature builder — headless-safe bpy script.

Builds the house skeleton (49 base / 61 hero bones, Mixamo-compatible
side-suffixed names, T-pose, no leaf bones) as pure data: EditBone
entries need no context, so this runs identically under
`blender --background --python` and MCP `execute_code`.

Contract (browser-character-pipeline-verdicts-2026 §2):
  meters, Blender Z-up build (facing -Y), exported Y-up/+Z via the
  glTF exporter; T-pose palms down; rest matrices frozen once clips
  are retargeted — version the rig (HouseRig_v1) and never change it
  after that point.

Usage:
  blender --background --python tools/characters/house_rig.py -- \
      [--hero] [--output PATH.blend] [--glb PATH.glb]

Prints a single `RIG_REPORT {...}` JSON line on stdout for callers.
"""

import json
import sys

import bpy

RIG_NAME = "HouseRig_v1"

# Rest-pose joint positions for a ~1.7 m stylized character in T-pose.
# Blender space: Z-up, character faces -Y, arms along +/-X.
# Each entry: (name, parent, head(x,y,z), tail(x,y,z)).
# .L = character's left = +X side (Blender convention).

_SHOULDER_Z = 1.47
_ELBOW_X = 0.45
_WRIST_X = 0.72


def _side(name: str, side: str) -> str:
    return f"{name}.{side}"


def _finger_chains(side: str, wrist: tuple[float, float, float]) -> list[tuple]:
    """Thumb/Index/Middle x3 chains extending +X from the wrist."""
    bones = []
    wx, wy, wz = wrist
    # Knuckle row: three fingers fan slightly in Y, thumb angles forward (-Y).
    for finger, fy, len_scale in (("Thumb", -0.035, 0.8), ("Index", 0.005, 1.0), ("Middle", 0.045, 1.05)):
        seg = 0.045 * len_scale
        x = wx + 0.01
        y = wy + fy
        z = wz
        parent = f"Hand.{side}"
        for i in range(3):
            head = (x, y, z)
            # slight downward arc for natural curl rest
            tail = (x + seg, y - 0.004 * (i + 1), z - 0.006 * (i + 1))
            name = _side(f"{finger}{i + 1}", side)
            bones.append((name, parent, head, tail))
            parent = name
            x, y, z = tail
    return bones


def bone_table(*, hero: bool) -> list[tuple]:
    bones: list[tuple] = [
        # Core
        ("Hips", None, (0.0, 0.0, 0.95), (0.0, 0.0, 1.06)),
        ("Spine", "Hips", (0.0, 0.0, 1.06), (0.0, 0.0, 1.20)),
        ("Spine1", "Spine", (0.0, 0.0, 1.20), (0.0, 0.0, 1.33)),
        ("Spine2", "Spine1", (0.0, 0.0, 1.33), (0.0, 0.0, 1.46)),
        ("Neck", "Spine2", (0.0, 0.0, 1.46), (0.0, 0.0, 1.56)),
        ("Head", "Neck", (0.0, 0.0, 1.56), (0.0, 0.0, 1.76)),
        # Face (blink/expression via morphs; bones only for jaw/eyes)
        ("Jaw", "Head", (0.0, -0.03, 1.575), (0.0, -0.10, 1.53)),
        ("Eye.L", "Head", (0.045, -0.095, 1.645), (0.045, -0.115, 1.645)),
        ("Eye.R", "Head", (-0.045, -0.095, 1.645), (-0.045, -0.115, 1.645)),
    ]

    for side, sx in (("L", 1.0), ("R", -1.0)):
        # Arm chain (T-pose, palms down => fingers extend +X, -Y is forward)
        bones += [
            (_side("Shoulder", side), "Spine2", (sx * 0.05, 0.0, _SHOULDER_Z), (sx * 0.17, 0.0, _SHOULDER_Z)),
            (_side("Arm", side), _side("Shoulder", side), (sx * 0.17, 0.0, _SHOULDER_Z), (sx * _ELBOW_X, 0.0, _SHOULDER_Z)),
            (_side("ArmTwist", side), _side("Arm", side), (sx * 0.30, 0.005, _SHOULDER_Z), (sx * 0.44, 0.005, _SHOULDER_Z)),
            (_side("ForeArm", side), _side("Arm", side), (sx * _ELBOW_X, 0.0, _SHOULDER_Z), (sx * _WRIST_X, 0.0, _SHOULDER_Z)),
            (_side("ForeArmTwist", side), _side("ForeArm", side), (sx * 0.55, 0.005, _SHOULDER_Z), (sx * 0.70, 0.005, _SHOULDER_Z)),
            (_side("Hand", side), _side("ForeArm", side), (sx * _WRIST_X, 0.0, _SHOULDER_Z), (sx * (_WRIST_X + 0.13), 0.0, _SHOULDER_Z)),
        ]
        bones += _finger_chains(side, (sx * (_WRIST_X + 0.13), 0.0, _SHOULDER_Z))

        # Leg chain
        bones += [
            (_side("UpLeg", side), "Hips", (sx * 0.10, 0.0, 0.95), (sx * 0.11, 0.0, 0.55)),
            (_side("ThighTwist", side), _side("UpLeg", side), (sx * 0.105, 0.0, 0.78), (sx * 0.11, 0.0, 0.58)),
            (_side("Leg", side), _side("UpLeg", side), (sx * 0.11, 0.0, 0.55), (sx * 0.12, 0.0, 0.12)),
            (_side("Foot", side), _side("Leg", side), (sx * 0.12, 0.0, 0.12), (sx * 0.12, -0.17, 0.03)),
            (_side("ToeBase", side), _side("Foot", side), (sx * 0.12, -0.17, 0.03), (sx * 0.12, -0.26, 0.02)),
        ]

        if hero:
            # Hero variant adds Ring + Pinky chains (61 total)
            bones += _extra_finger_chains(side, (sx * (_WRIST_X + 0.13), 0.0, _SHOULDER_Z))

    return bones


def _extra_finger_chains(side: str, wrist: tuple[float, float, float]) -> list[tuple]:
    bones = []
    wx, wy, wz = wrist
    for finger, fy in (("Ring", 0.085), ("Pinky", 0.12)):
        seg = 0.04
        x, y, z = wx + 0.01, wy + fy, wz
        parent = f"Hand.{side}"
        for i in range(3):
            head = (x, y, z)
            tail = (x + seg, y - 0.004 * (i + 1), z - 0.006 * (i + 1))
            name = _side(f"{finger}{i + 1}", side)
            bones.append((name, parent, head, tail))
            parent = name
            x, y, z = tail
    return bones


def build_armature(*, hero: bool) -> bpy.types.Object:
    arm_data = bpy.data.armatures.new(RIG_NAME)
    armature = bpy.data.objects.new(RIG_NAME, arm_data)
    bpy.context.collection.objects.link(armature)

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)  # noqa: FBT003 - bpy API takes positional bool
    bpy.ops.object.mode_set(mode="EDIT")
    edit = armature.data.edit_bones
    for name, parent, head, tail in bone_table(hero=hero):
        eb = edit.new(name)
        eb.head = head
        eb.tail = tail
        if parent:
            eb.parent = edit[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)  # noqa: FBT003 - bpy API takes positional bool
    return armature


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    hero = "--hero" in argv
    out_blend = argv[argv.index("--output") + 1] if "--output" in argv else None
    out_glb = argv[argv.index("--glb") + 1] if "--glb" in argv else None

    armature = build_armature(hero=hero)

    if out_blend:
        bpy.ops.wm.save_as_mainfile(filepath=out_blend)
    if out_glb:
        bpy.ops.export_scene.gltf(
            filepath=out_glb,
            export_format="GLB",
            export_animations=False,
            export_yup=True,
            use_selection=False,
        )

    bones = [b.name for b in armature.data.bones]
    roots = [b.name for b in armature.data.bones if b.parent is None]
    report = {
        "rig": RIG_NAME,
        "variant": "hero" if hero else "base",
        "bone_count": len(bones),
        "roots": roots,
        "expected": 61 if hero else 49,
        "ok": len(bones) == (61 if hero else 49),
        "blend": out_blend,
        "glb": out_glb,
    }
    print("RIG_REPORT " + json.dumps(report))


if __name__ == "__main__":
    main()
