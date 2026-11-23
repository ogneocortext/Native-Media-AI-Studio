# ruff: noqa
"""Maya-style hero character builder — headless-safe bpy script.

Rebuilds hero_dj around the HouseRig_v1 skeleton (49 bones, T-pose,
faces -Y, Z-up) as a stylized female DJ matching the Maya reference
brief: purple hair mass + ponytail, cat-ear headset with cyan accents,
anime face (cyan eyes, pink cheeks), navy tactical jacket with collar,
shoulder strap + buckle, dark pants and boots.

Two skinning paths, both glTF-clean:
  - BODY parts: ARMATURE_AUTO heat weights (same as skin_weights.py),
    then normalize + cap at 4 influences.
  - HEAD-RIGID parts (hair, ears, headset, face features): a single
    vertex group weighted 1.0 to the Head bone + Armature modifier —
    deterministic, no heat-weight failures on intersecting shells.

Usage:
  blender --background --python tools/characters/maya_dj.py -- \
      [--out PATH.blend]

Prints a single `MAYA_REPORT {...}` JSON line on stdout.
"""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler

RIG_NAME = "HouseRig_v1"

# Palette — cel-shaded targets; the runtime swaps these to toon materials
# keyed by base-color hex, so color IS the material contract.
MAT = {
    "hair": (0.36, 0.10, 0.55, 1.0),      # vibrant purple/magenta
    "jacket": (0.05, 0.07, 0.14, 1.0),    # deep navy/black
    "accent": (0.15, 0.85, 1.00, 1.0),    # electric cyan (emissive)
    "skin": (0.93, 0.72, 0.58, 1.0),
    "pants": (0.10, 0.12, 0.20, 1.0),
    "boot": (0.06, 0.07, 0.11, 1.0),
    "eye": (0.35, 0.92, 1.00, 1.0),       # bright cyan eyes
    "cheek": (0.95, 0.55, 0.70, 1.0),     # pink markings
    "brow": (0.22, 0.08, 0.30, 1.0),
    "mouth": (0.45, 0.15, 0.20, 1.0),
}


def _load_house_rig():
    src = Path(__file__).with_name("house_rig.py").read_text(encoding="utf-8")
    ns: dict = {"__name__": "house_rig_module"}
    exec(compile(src, "house_rig.py", "exec"), ns)
    return ns


def make_mat(name: str, rgba: tuple, emission: tuple | None = None,
             estr: float = 0.0) -> bpy.types.Material:
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = rgba
    if emission is not None:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emission, 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = estr
    return m


def spawn(kind: str, name: str, loc, scale, mat: str,
          rot=None, smooth: bool = True):  # noqa: FBT002, FBT003
    """Create a primitive mesh object. scale may be uniform or (x,y,z)."""
    if kind == "uv":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=1.0)
    elif kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=1.0, depth=1.0)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.0, radius2=0.0, depth=1.0)
    else:
        raise ValueError(kind)
    obj = bpy.context.active_object
    obj.name = name
    if isinstance(scale, (int, float)):
        obj.scale = (scale, scale, scale)
    else:
        obj.scale = scale
    obj.location = loc
    if rot is not None:
        obj.rotation_euler = rot
    mats = {
        "hair": MAT["hair"], "jacket": MAT["jacket"], "accent": MAT["accent"],
        "skin": MAT["skin"], "pants": MAT["pants"], "boot": MAT["boot"],
        "eye": MAT["eye"], "cheek": MAT["cheek"], "brow": MAT["brow"],
        "mouth": MAT["mouth"],
    }
    material = bpy.data.materials.get("MAT_" + mat)
    if material is None:
        emission = MAT["accent"][:3] if mat == "accent" else (
            MAT["eye"][:3] if mat == "eye" else None)
        estr = 2.5 if mat in ("accent", "eye") else 0.0
        material = make_mat("MAT_" + mat, mats[mat], emission=emission, estr=estr)
    obj.data.materials.append(material)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def rigid_head_weight(obj, arm) -> None:
    """Weight every vertex 1.0 to Head + add Armature modifier."""
    vg = obj.vertex_groups.new(name="Head")
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm


def auto_skin(obj, arm) -> dict:
    """ARMATURE_AUTO heat weights + normalize/limit to 4 influences."""
    bpy.ops.object.select_all(action="DESELECT")  # noqa: FBT003
    arm.select_set(True)  # noqa: FBT003
    obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    bpy.ops.object.select_all(action="DESELECT")  # noqa: FBT003
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    weightless = sum(
        1 for v in obj.data.vertices
        if not any(g.weight > 0 for g in v.groups)
    )
    return {"vg": len(obj.vertex_groups), "weightless": weightless}


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out_blend = argv[argv.index("--out") + 1] if "--out" in argv else None

    # Clean scene (default Cube/Camera/Light)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    rig_ns = _load_house_rig()
    arm = rig_ns["build_armature"](hero=False)

    body: list[bpy.types.Object] = []
    head_rigid: list[bpy.types.Object] = []

    # ---- BODY (auto-skinned) -------------------------------------------
    # Head + jaw — anime proportions: tall cranium, small jaw.
    body.append(spawn("uv", "HeadCore", (0, -0.005, 1.665), (0.105, 0.103, 0.118), "skin"))  # noqa
    body.append(spawn("uv", "Jaw", (0, -0.045, 1.585), (0.062, 0.055, 0.045), "skin"))
    body.append(spawn("cyl", "Neck", (0, 0, 1.53), (0.042, 0.042, 0.12), "skin"))

    # Torso — navy jacket shell.
    body.append(spawn("uv", "Torso", (0, 0, 1.22), (0.168, 0.115, 0.25), "jacket"))
    body.append(spawn("uv", "Pelvis", (0, 0, 0.97), (0.155, 0.105, 0.095), "pants"))
    # Shoulder/deltoid caps.
    for s, sx in (("L", 1.0), ("R", -1.0)):
        body.append(spawn("uv", f"Deltoid.{s}", (sx * 0.185, 0, 1.49),
                          (0.075, 0.085, 0.06), "jacket"))
        # Upper arm sleeve — spans inward to x0.10 so it can't gap off the
        # torso at shoulder height (torso surface recedes near the top pole).
        body.append(spawn("uv", f"UpperArm.{s}", (sx * 0.28, 0, 1.47),
                          (0.18, 0.052, 0.052), "jacket"))
        body.append(spawn("uv", f"ForeArm.{s}", (sx * 0.585, 0, 1.47),
                          (0.145, 0.046, 0.046), "jacket"))
        # Mitten hand.
        body.append(spawn("uv", f"HandMesh.{s}", (sx * 0.80, -0.005, 1.465),
                          (0.062, 0.038, 0.048), "skin"))
        # Legs: thigh + knee + shin + ankle + boot + toe. Knee/ankle
        # spheres bridge the gaps between segments (thigh bottom ~0.56,
        # shin top ~0.48, shin bottom ~0.25, boot top ~0.20).
        body.append(spawn("uv", f"Thigh.{s}", (sx * 0.105, 0, 0.76),
                          (0.082, 0.088, 0.135), "pants"))
        body.append(spawn("uv", f"Knee.{s}", (sx * 0.11, 0, 0.54),
                          (0.078, 0.083, 0.09), "pants"))
        body.append(spawn("uv", f"Shin.{s}", (sx * 0.115, 0, 0.36),
                          (0.068, 0.075, 0.115), "pants"))
        body.append(spawn("uv", f"Ankle.{s}", (sx * 0.115, -0.02, 0.225),
                          (0.062, 0.075, 0.058), "boot"))
        body.append(spawn("uv", f"Boot.{s}", (sx * 0.115, -0.045, 0.11),
                          (0.072, 0.115, 0.085), "boot"))
        body.append(spawn("uv", f"Toe.{s}", (sx * 0.115, -0.165, 0.045),
                          (0.058, 0.062, 0.038), "boot"))

    # Jacket details — collar ring, chest strap, buckle, zipper.
    body.append(spawn("cyl", "Collar", (0, 0, 1.50), (0.098, 0.098, 0.05), "jacket"))
    strap = spawn("cube", "ChestStrap", (0.0, -0.108, 1.20), (0.055, 0.02, 0.52), "jacket",
                  rot=Euler((0, 0.42, 0)))
    body.append(strap)
    body.append(spawn("cube", "Buckle", (0.0, -0.128, 0.965), (0.045, 0.02, 0.045), "accent",
                      smooth=False))
    body.append(spawn("cube", "Zipper", (0.0, -0.118, 1.18), (0.012, 0.012, 0.42), "accent",
                      smooth=False))

    # ---- HEAD-RIGID (weighted 1.0 to Head) ------------------------------
    # Hair mass — cap, back fall, side locks, bangs, ponytail sweep.
    head_rigid.append(spawn("uv", "HairCap", (0, 0.02, 1.70), (0.118, 0.115, 0.125), "hair"))
    head_rigid.append(spawn("uv", "HairBack", (0, 0.10, 1.47), (0.115, 0.055, 0.20), "hair"))
    head_rigid.append(spawn("uv", "HairBangs", (0, -0.055, 1.735), (0.10, 0.045, 0.05), "hair"))
    for s, sx in (("L", 1.0), ("R", -1.0)):
        head_rigid.append(spawn("uv", f"SideLock.{s}", (sx * 0.098, -0.015, 1.56),
                                (0.032, 0.045, 0.105), "hair"))
    # Ponytail: sphere chain sweeping back and down (README invariant).
    # Radii overlap neighboring segments — gaps read as floating beads.
    pony = [
        ((0, 0.135, 1.735), 0.060),
        ((0, 0.158, 1.615), 0.065),
        ((0, 0.178, 1.500), 0.060),
        ((0, 0.170, 1.375), 0.050),
    ]
    for i, (loc, r) in enumerate(pony):
        head_rigid.append(spawn("uv", f"Ponytail.{i}", loc, (r, r, r * 1.15), "hair"))
    # Cat ears — dark pyramids with cyan inner wedge.
    for s, sx in (("L", 1.0), ("R", -1.0)):
        head_rigid.append(spawn("cone", f"CatEar.{s}", (sx * 0.062, 0.045, 1.855),
                                (0.038, 0.038, 0.11), "jacket",
                                rot=Euler((0.15, sx * -0.35, sx * 0.15))))
        head_rigid.append(spawn("cone", f"EarInner.{s}", (sx * 0.060, 0.028, 1.852),
                                (0.020, 0.020, 0.07), "accent",
                                rot=Euler((0.15, sx * -0.35, sx * 0.15))))
    # Headset band — arc of small cubes over the crown (X-Z plane at y~0).
    band_parts = []
    R, CZ = 0.125, 1.66  # ends land on the ear cups (~z1.62-1.66), crown ~1.78
    for i in range(9):
        t = math.pi * i / 8
        x = R * math.cos(t)
        z = CZ + R * math.sin(t) * 0.92
        seg = spawn("cube", f"Band.{i}", (x, -0.005, z), (0.022, 0.018, 0.03), "jacket",
                    rot=Euler((0, -(t - math.pi / 2), 0)), smooth=False)
        band_parts.append(seg)
    head_rigid += band_parts
    # Ear cups + cyan trim rings at the band ends.
    for s, sx in (("L", 1.0), ("R", -1.0)):
        head_rigid.append(spawn("cyl", f"EarCup.{s}", (sx * 0.118, -0.01, 1.615),
                                (0.045, 0.045, 0.035), "jacket",
                                rot=Euler((0, math.pi / 2, 0)), smooth=False))
        head_rigid.append(spawn("cyl", f"CupTrim.{s}", (sx * 0.137, -0.01, 1.615),
                                (0.047, 0.047, 0.010), "accent",
                                rot=Euler((0, math.pi / 2, 0)), smooth=False))
    # Face — cyan anime eyes, pink cheeks, brows, small mouth. All pushed
    # proud of the head surface (front ~y=-0.108 at eye line).
    for s, sx in (("L", 1.0), ("R", -1.0)):
        head_rigid.append(spawn("uv", f"Eye.{s}", (sx * 0.042, -0.103, 1.665),
                                (0.030, 0.016, 0.042), "eye"))
        head_rigid.append(spawn("uv", f"Cheek.{s}", (sx * 0.058, -0.098, 1.612),
                                (0.022, 0.014, 0.016), "cheek"))
        head_rigid.append(spawn("cube", f"Brow.{s}", (sx * 0.043, -0.105, 1.712),
                                (0.034, 0.010, 0.009), "brow",
                                rot=Euler((0, 0, sx * -0.12)), smooth=False))
    head_rigid.append(spawn("cube", "Mouth", (0, -0.108, 1.598),
                            (0.020, 0.008, 0.007), "mouth", smooth=False))

    # ---- SKINNING --------------------------------------------------------
    report_failures: list = []
    # Join same-material parts first: 58 primitives would be ~58 draw calls;
    # grouped by material the GLB ships ~12 meshes. Vertex groups and
    # material slots survive join; we re-assert the Armature modifier and
    # parent afterwards so the result is deterministic.
    def join_by_material(objs: list, prefix: str):
        groups: dict[str, list] = {}
        for o in objs:
            mat_name = o.active_material.name if o.active_material else "none"
            groups.setdefault(mat_name, []).append(o)
        out = []
        for mat_name, members in groups.items():
            if len(members) == 1:
                members[0].name = f"{prefix}_{mat_name}"
                out.append(members[0])
                continue
            bpy.ops.object.select_all(action="DESELECT")
            for o in members:
                o.select_set(True)
            bpy.context.view_layer.objects.active = members[0]
            bpy.ops.object.join()
            members[0].name = f"{prefix}_{mat_name}"
            out.append(members[0])
        return out

    def ensure_armature(obj, arm_obj) -> None:
        obj.parent = arm_obj
        if not any(m.type == "ARMATURE" for m in obj.modifiers):
            mod = obj.modifiers.new("Armature", "ARMATURE")
            mod.object = arm_obj

    # Body parts are heat-skinned individually first (proven path — joined
    # intersecting shells can fail heat weighting), then merged by material.
    skin_stats = {}
    for obj in body:
        try:
            skin_stats[obj.name] = auto_skin(obj, arm)
        except Exception as exc:  # noqa: BLE001 - report and continue
            report_failures.append({"object": obj.name, "error": str(exc)})

    head_joined = join_by_material(head_rigid, "HD")
    body_joined = join_by_material(body, "BD")

    report = {"body": skin_stats, "head_rigid": len(head_joined), "failed": report_failures}
    for obj in body_joined:
        try:
            # Joined meshes already carry per-vertex weights; verify budget.
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
            bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
            ensure_armature(obj, arm)
            weightless = sum(
                1 for v in obj.data.vertices
                if not any(g.weight > 0 for g in v.groups)
            )
            report["body"][obj.name] = {"vg": len(obj.vertex_groups), "weightless": weightless}
        except Exception as exc:  # noqa: BLE001 - report and continue
            report["failed"].append({"object": obj.name, "error": str(exc)})
    for obj in head_joined:
        rigid_head_weight(obj, arm)

    if out_blend:
        bpy.ops.wm.save_as_mainfile(filepath=out_blend)

    total_verts = sum(len(o.data.vertices) for o in body_joined + head_joined)
    report.update({
        "ok": not report["failed"],
        "objects": len(body_joined) + len(head_joined),
        "verts": total_verts,
        "bones": len(arm.data.bones),
        "blend": out_blend,
    })
    print("MAYA_REPORT " + json.dumps(report))


main()
