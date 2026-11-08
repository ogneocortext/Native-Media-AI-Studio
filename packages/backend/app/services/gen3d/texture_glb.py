"""Texture a GLB mesh: T0 vertex-color bake and/or T1 concept projection.

Implements the texture-generation stage spec'd in
docs/knowledge-library/texture-generation-stage-for-ai-generated-3d-assets-2026.md.

Runs headless under Blender (same invocation pattern as decimate_glb.py):

    blender --background --python texture_glb.py -- <input.glb> <output.glb> \
        [concept_image] [--role hero|mid|background|far] [--force] [--preview out.png]

Per mesh object:
- Meshes that already carry an image texture on Base Color are left alone
  unless --force.
- T1 (concept image given AND role in hero/mid): the concept image is
  projected onto the mesh from a canonical 3/4 view. UVs are overwritten
  with the projection (manual world->camera mapping, deterministic, no
  viewport ops required) and a Principled material samples the concept
  image directly. No bake — direct assign.
- T0 (no usable concept, or role background/far): if the mesh has a color
  attribute (COLOR_0 preferred), smart-UV-unwrap when needed and bake the
  vertex colors into a 1024px image (Cycles DIFFUSE/COLOR pass), then wire
  the baked image as Base Color.

Prints one JSON result line: {success, method, objects, textured, ...}.
Exit 0 on success-or-skip (method may be "none"); nonzero only on hard
failure (import/export error, exception).
"""

import json
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Vector

T1_ROLES = {"hero", "mid"}
BAKE_PX = 1024
# Canonical 3/4 view direction in Blender space (front = -Y, so this is
# front-right-above). Concept images are front views of the object.
VIEW_DIR = Vector((0.85, -1.15, 0.75)).normalized()


def _log(msg: str) -> None:
    print(f"[texture_glb] {msg}", flush=True)


def _clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def _mesh_objects() -> list:
    return [o for o in bpy.context.scene.objects if o.type == "MESH" and o.data]


def _has_image_texture(obj) -> bool:
    """True if a material's Base Color is fed by an image texture node.

    Walks the link graph backwards from each Principled BSDF 'Base Color'
    input; any TEX_IMAGE upstream counts. Falls back to "any TEX_IMAGE in
    the material" when no Principled node exists, so meshes with unusual
    setups are still treated as already textured.
    """
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        bsdfs = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"]
        if not bsdfs:
            if any(n.type == "TEX_IMAGE" and n.image is not None for n in nt.nodes):
                return True
            continue
        for bsdf in bsdfs:
            base = bsdf.inputs.get("Base Color")
            if base is None:
                continue
            # BFS upstream from Base Color looking for an image texture.
            seen = set()
            stack = [link.from_node for link in base.links]
            while stack:
                node = stack.pop()
                if node is None or node.name in seen:
                    continue
                seen.add(node.name)
                if node.type == "TEX_IMAGE" and node.image is not None:
                    return True
                for inp in node.inputs:
                    for link in inp.links:
                        if link.from_node is not None:
                            stack.append(link.from_node)
    return False


def _color_attribute_name(mesh) -> str | None:
    """Return the vertex-color attribute name, preferring COLOR_0."""
    attrs = list(mesh.color_attributes.keys())
    if not attrs:
        return None
    if "COLOR_0" in attrs:
        return "COLOR_0"
    return attrs[0]


def _has_uv(mesh) -> bool:
    return len(mesh.uv_layers) > 0


def _ensure_uv_smart(mesh, obj) -> bool:
    """Smart-UV-unwrap the mesh if it has no UV layer. Returns success."""
    if _has_uv(mesh):
        return True
    try:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)  # noqa: FBT003 - bpy API takes positional bool
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
        return _has_uv(mesh)
    except Exception as e:  # noqa: BLE001
        _log(f"smart_project failed for {obj.name}: {e}")
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:  # noqa: BLE001
            pass
        return False


def _new_bake_material(obj, image, attr_name: str):
    """Material for baking: Color Attribute -> Base Color, target image active."""
    mat = bpy.data.materials.new(name=f"{obj.name}_texbake")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = attr_name
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])

    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    # The bake target must be the active image texture node.
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex
    return mat, tex


def _finalize_material(obj, image, *, concept: bool):
    """Material used after bake/assign: image texture -> Base Color."""
    mat = bpy.data.materials.new(name=f"{obj.name}_tex")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    if bsdf and "Base Color" in bsdf.inputs:
        for link in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(link)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def _assign_material(obj, mat) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def _bake_vertex_colors(obj, attr_name: str) -> dict:
    """Bake the color attribute into a new 1024px image; return info."""
    image = bpy.data.images.new(
        name=f"{obj.name}_vc", width=BAKE_PX, height=BAKE_PX, alpha=False
    )
    image.colorspace_settings.name = "sRGB"
    image.generated_color = (0.5, 0.5, 0.5, 1.0)

    if not _ensure_uv_smart(obj.data, obj):
        return {"ok": False, "reason": "uv_unwrap_failed"}

    bake_mat, tex_node = _new_bake_material(obj, image, attr_name)
    _assign_material(obj, bake_mat)

    # Cycles CPU bake; COLOR-only diffuse pass captures the attribute.
    scene = bpy.context.scene
    prev_engine = scene.render.engine
    prev_samples = getattr(scene.cycles, "samples", None)
    scene.render.engine = "CYCLES"
    if prev_samples is not None:
        scene.cycles.samples = 1
        scene.cycles.device = "CPU"

    try:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)  # noqa: FBT003 - bpy API takes positional bool
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.bake(
            type="DIFFUSE",
            pass_filter={"COLOR"},
            margin=16,
            use_clear=True,
        )
    except Exception as e:  # noqa: BLE001
        scene.render.engine = prev_engine
        if prev_samples is not None:
            scene.cycles.samples = prev_samples
        return {"ok": False, "reason": f"bake_failed: {e}"}
    finally:
        scene.render.engine = prev_engine
        if prev_samples is not None:
            scene.cycles.samples = prev_samples

    # Swap bake material for the final textured material.
    final_mat = _finalize_material(obj, image, concept=False)
    _assign_material(obj, final_mat)
    return {"ok": True, "image": image.name, "uv": "existing" if _has_uv(obj.data) else "smart"}


def _project_uvs(obj, cam) -> None:
    """Overwrite the active UV layer with a 3/4-view projection."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        uv_layer = mesh.uv_layers.new(name="UVMap")
    uvs = uv_layer.data
    mw = obj.matrix_world
    # world_to_camera_view handles camera intrinsics (perspective) correctly.
    from bpy_extras.object_utils import world_to_camera_view

    scene = bpy.context.scene
    for li in range(len(mesh.loops)):
        co_world = mw @ mesh.vertices[mesh.loops[li].vertex_index].co
        co = world_to_camera_view(scene, cam, co_world)
        u = min(max(co.x, 0.002), 0.998)
        v = min(max(co.y, 0.002), 0.998)
        uvs[li].uv = (u, v)


def _make_camera(center: Vector, radius: float):
    cam_data = bpy.data.cameras.new(name="texproj_cam")
    cam_data.clip_start = 0.01
    cam_data.clip_end = max(1000.0, radius * 100.0)
    cam = bpy.data.objects.new("texproj_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    dist = max(radius * 4.0, 0.5)
    cam.location = center + VIEW_DIR * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    return cam


def _apply_projection(obj, concept_path: str, errors: list) -> dict:
    """T1: project the concept image onto the mesh from the 3/4 view."""
    try:
        image = bpy.data.images.load(concept_path, check_existing=True)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": f"concept_load_failed: {e}"}
    if not image or image.size[0] == 0:
        return {"ok": False, "reason": "concept_image_empty"}

    # Camera framed on this object's bounding box (world space).
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    center = (lo + hi) * 0.5
    radius = max((hi - lo).length * 0.5, 1e-3)
    cam = _make_camera(center, radius)
    cam_data = cam.data
    try:
        _project_uvs(obj, cam)
    finally:
        bpy.data.objects.remove(cam, do_unlink=True)
        bpy.data.cameras.remove(cam_data)

    mat = _finalize_material(obj, image, concept=True)
    _assign_material(obj, mat)
    return {"ok": True}


def _render_preview(path: str) -> bool:
    """Workbench texture-mode render for visual verification."""
    try:
        scene = bpy.context.scene
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "TEXTURE"
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.render.resolution_x = 640
        scene.render.resolution_y = 640
        scene.render.filepath = path

        meshes = _mesh_objects()
        if meshes:
            corners = []
            for o in meshes:
                corners += [o.matrix_world @ Vector(c) for c in o.bound_box]
            lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
            hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
            center = (lo + hi) * 0.5
            radius = max((hi - lo).length * 0.5, 0.5)
        else:
            center, radius = Vector((0, 0, 0)), 1.0
        cam_data = bpy.data.cameras.new("preview_cam")
        cam_data.clip_end = max(1000.0, radius * 100.0)
        cam = bpy.data.objects.new("preview_cam", cam_data)
        scene.collection.objects.link(cam)
        cam.location = center + VIEW_DIR.normalized() * radius * 3.2
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.camera = cam
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)
        bpy.data.cameras.remove(cam_data)
        return True
    except Exception as e:  # noqa: BLE001
        _log(f"preview render failed: {e}")
        return False


def texture_glb(
    input_path: str,
    output_path: str,
    concept_path: str | None = None,
    *,
    role: str = "mid",
    force: bool = False,
    preview_path: str | None = None,
) -> dict:
    try:
        # Blender's glTF importer cannot read KHR_texture_basisu (Basis
        # Universal) textures — those only exist post-ingest-texture.py.
        # Detect and skip gracefully instead of dying mid-import.
        try:
            head = Path(input_path).read_bytes()[: 8 * 1024 * 1024]
            if b"KHR_texture_basisu" in head:
                return {
                    "success": True,
                    "method": "none",
                    "reason": "basisu_textures_unsupported_by_blender",
                    "objects": 0,
                    "textured": 0,
                }
        except OSError:
            pass
        _clear_scene()
        bpy.ops.import_scene.gltf(filepath=input_path)
        objects = _mesh_objects()
        if not objects:
            return {"success": False, "error": "No mesh objects imported"}

        faces = sum(len(o.data.polygons) for o in objects)
        allow_projection = concept_path is not None and role in T1_ROLES
        if concept_path and not allow_projection:
            _log(f"concept image given but role={role} — T1 gated to hero/mid, using T0/none")

        methods: list[str] = []
        textured = 0
        skipped_textured = 0
        errors: list[str] = []

        for obj in objects:
            if _has_image_texture(obj) and not force:
                skipped_textured += 1
                continue

            attr = _color_attribute_name(obj.data)
            did = False
            if allow_projection:
                res = _apply_projection(obj, concept_path, errors)
                if res.get("ok"):
                    methods.append("projection")
                    textured += 1
                    did = True
                else:
                    errors.append(f"{obj.name}: projection {res.get('reason')}")
            if not did and attr:
                res = _bake_vertex_colors(obj, attr)
                if res.get("ok"):
                    methods.append("vertex_color")
                    textured += 1
                    did = True
                else:
                    errors.append(f"{obj.name}: vertex_color {res.get('reason')}")
            if not did and not allow_projection and not attr:
                errors.append(f"{obj.name}: no color attribute and no concept image")

        if preview_path:
            _render_preview(preview_path)

        if textured == 0:
            # Nothing changed — pass the input through untouched.
            out = Path(output_path)
            if Path(input_path).resolve() != out.resolve():
                shutil.copy2(input_path, output_path)
            method = "none"
        else:
            bpy.ops.export_scene.gltf(
                filepath=output_path,
                export_format="GLB",
                export_apply=True,
                export_texcoords=True,
                export_normals=True,
                export_materials="EXPORT",
            )
            uniq = set(methods)
            method = uniq.pop() if len(uniq) == 1 else ("mixed" if uniq else "none")

        return {
            "success": True,
            "method": method,
            "objects": len(objects),
            "textured": textured,
            "skipped_textured": skipped_textured,
            "faces": faces,
            "concept": bool(concept_path),
            "role": role,
            "errors": errors[:10],
        }
    except Exception as e:  # noqa: BLE001
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if len(args) < 2:
        print(
            "Usage: blender --background --python texture_glb.py -- "
            "<input.glb> <output.glb> [concept_image] "
            "[--role ROLE] [--force] [--preview out.png]"
        )
        sys.exit(1)

    input_path, output_path = args[0], args[1]
    rest = args[2:]
    concept = None
    role = "mid"
    force = False
    preview = None
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--role" and i + 1 < len(rest):
            role = rest[i + 1]
            i += 2
        elif a == "--force":
            force = True
            i += 1
        elif a == "--preview" and i + 1 < len(rest):
            preview = rest[i + 1]
            i += 2
        elif a.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and concept is None:
            concept = a
            i += 1
        else:
            i += 1

    result = texture_glb(input_path, output_path, concept, role=role, force=force, preview_path=preview)
    # Single JSON line the wrapper parses.
    print("TEXTURE_RESULT " + json.dumps(result))
    sys.exit(0 if result.get("success") else 1)
