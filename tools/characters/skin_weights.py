"""Skin a character mesh to HouseRig_v1 — headless-safe bpy script.

Opens a .blend containing a mesh named DJ_Mesh (or --mesh NAME),
builds the HouseRig_v1 armature via house_rig.py's data tables,
auto-weights with ARMATURE_AUTO heat weights, then enforces the
glTF contract: <=4 bone influences per vertex and weight sums = 1.

Usage:
  blender --background hero.blend --python tools/characters/skin_weights.py -- \
      [--mesh DJ_Mesh] [--hero] [--out OUT.blend] [--glb OUT.glb]

Prints a single `SKIN_REPORT {...}` JSON line on stdout.
"""

import json
import sys
from pathlib import Path

import bpy


def _load_house_rig():
    """Import house_rig.py functions without running its __main__ block."""
    src = Path(__file__).with_name("house_rig.py").read_text(encoding="utf-8")
    ns: dict = {"__name__": "house_rig_module"}
    exec(compile(src, "house_rig.py", "exec"), ns)
    return ns


def enforce_weight_budget(mesh_obj: bpy.types.Object, max_influences: int = 4) -> dict:
    """Normalize weights to sum 1 and cap influences per vertex."""
    vg_names = [g.name for g in mesh_obj.vertex_groups]
    stats = {"max_influences_before": 0, "vertices_over": 0}
    for v in mesh_obj.data.vertices:
        n = len(v.groups)
        stats["max_influences_before"] = max(stats["max_influences_before"], n)
        if n > max_influences:
            stats["vertices_over"] += 1
    # Blender ops do the heavy lifting: normalize then hard-limit.
    bpy.context.view_layer.objects.active = mesh_obj
    mesh_obj.select_set(True)  # noqa: FBT003 - bpy API positional bool
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=max_influences)
    mesh_obj.select_set(False)  # noqa: FBT003 - bpy API positional bool

    after = 0
    for v in mesh_obj.data.vertices:
        after = max(after, len(v.groups))
    stats["max_influences_after"] = after
    stats["vg_count"] = len(vg_names)
    return stats


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

    def opt(flag: str, default: str | None = None) -> str | None:
        return argv[argv.index(flag) + 1] if flag in argv else default

    mesh_name = opt("--mesh", "DJ_Mesh")
    hero = "--hero" in argv
    out_blend = opt("--out")
    out_glb = opt("--glb")

    mesh = bpy.data.objects.get(mesh_name)
    if mesh is None or mesh.type != "MESH":
        print("SKIN_REPORT " + json.dumps({"ok": False, "reason": f"mesh '{mesh_name}' not found"}))
        return

    rig_ns = _load_house_rig()
    armature = rig_ns["build_armature"](hero=hero)

    # Parent with automatic heat weights (best-effort; stylized meshes
    # may need manual touch-up in the areas the QA render exposes).
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)  # noqa: FBT003 - bpy API positional bool
    mesh.select_set(True)  # noqa: FBT003 - bpy API positional bool
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    stats = enforce_weight_budget(mesh)

    if out_blend:
        bpy.ops.wm.save_as_mainfile(filepath=out_blend)
    if out_glb:
        bpy.ops.export_scene.gltf(
            filepath=out_glb,
            export_format="GLB",
            export_animations=False,
            export_yup=True,
            export_apply=True,
        )

    report = {
        "ok": True,
        "mesh": mesh_name,
        "armature": armature.name,
        "bones": len(armature.data.bones),
        "weights": stats,
        "blend": out_blend,
        "glb": out_glb,
    }
    print("SKIN_REPORT " + json.dumps(report))


main()
