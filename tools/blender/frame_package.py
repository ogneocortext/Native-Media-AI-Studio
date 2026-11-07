"""frame-package/v1 capture (T-VID-17 v1): render a GLB/scene to the contract layout.

    blender --background --python frame_package.py -- <src.glb|.blend> <out_dir> <frames> <fps> <tier> <passes_csv> <pass_scale> <orbit_deg> <near> <far>

Emitted in v1 (verified on Blender 5.2.3):
    beauty/f%06d.png            8-bit sRGB PNG (tier resolution)
    normals/f%06d.png           8-bit RGB, world-space n*0.5+0.5
    depth/f%06d.png             16-bit gray PNG, Z-depth normalized over
                                [near,far] via MapRange (real Z pass, not mist)
    camera.jsonl                intrinsics + cam-to-world per frame
    manifest.json               frame-package/v1 descriptor (claims only real passes)

Deferred (documented, not faked):
- segmentation: Blender 5.2's compositor exposes no object-index socket
  (use_pass_object_index produces no RLayers output; only Cryptomatte
  object passes exist, which need hash-manifest decode — v1.1 work).
- pose: needs the rigged-character binding that does not exist yet.

Blender 5.x Output File notes (all verified live):
- node.format.media_type defaults to MULTI_LAYER_IMAGE, which locks
  file_format to OPEN_EXR_MULTILAYER — set media_type='IMAGE' first.
- FLOAT file_output_items force EXR multilayer; use 'RGBA' items and let
  the float->color socket conversion write gray.
- file_name only gets a frame suffix in animation renders; in still
  mode set node.file_name per frame (done in the render loop).
- ShaderNodeMapRange (not CompositorNodeMapRange) is the working node.
- RLayers pass sockets in 5.x: 'Depth' (was 'Z'), 'Normal', 'Mist';
  no 'IndexOB'.

Determinism: every frame is bpy.context.scene.frame_set(f); orbit is a
pure function of frame index; no wall-clock or unseeded randomness.
"""

import json
import math
import sys
from datetime import UTC, datetime
from pathlib import Path

import bpy
from mathutils import Vector

TIERS = {
    "draft": {"res": (960, 540), "samples": 16},
    "review": {"res": (1280, 720), "samples": 32},
    "final": {"res": (1920, 1080), "samples": 64},
}


def _clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)


def _load(src: str) -> list:
    if src.lower().endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=src)
    else:
        bpy.ops.import_scene.gltf(filepath=src)
    return [o for o in bpy.context.scene.objects if o.type == "MESH" and o.data]


def _ensure_camera() -> bpy.types.Object:
    cam = bpy.context.scene.camera
    if cam is None:
        data = bpy.data.cameras.new("PkgCam")
        cam = bpy.data.objects.new("PkgCam", data)
        bpy.context.scene.collection.objects.link(cam)
        bpy.context.scene.camera = cam
    return cam


def _ensure_light() -> None:
    if not any(o.type == "LIGHT" for o in bpy.context.scene.objects):
        data = bpy.data.lights.new("PkgSun", type="SUN")
        data.energy = 4.0
        obj = bpy.data.objects.new("PkgSun", data)
        bpy.context.scene.collection.objects.link(obj)
        obj.rotation_euler = (math.radians(50), 0, math.radians(30))
    world = bpy.context.scene.world or bpy.data.worlds.new("PkgWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.18, 0.18, 0.2, 1.0)
        bg.inputs[1].default_value = 0.6
    # Linear normalized depth over fixed shot bounds via mist pass.
    world.mist_settings.use_mist = True
    # Blender 5.x renamed mist_start/mist_depth -> start/depth.
    world.mist_settings.start = 0.0
    world.mist_settings.depth = 100.0
    world.mist_settings.falloff = "LINEAR"


def _world_normal_material() -> bpy.types.Material:
    """Emission material encoding world-space normals as n*0.5+0.5 -> RGB."""
    mat = bpy.data.materials.get("NMA_WorldNormal")
    if mat:
        return mat
    mat = bpy.data.materials.new("NMA_WorldNormal")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    xform = nt.nodes.new("ShaderNodeVectorTransform")
    xform.vector_type = "NORMAL"
    xform.convert_from = "CAMERA"
    xform.convert_to = "WORLD"
    nt.links.new(geo.outputs["Normal"], xform.inputs["Vector"])
    # world normal -> n*0.5+0.5 per channel: VectorMath MULTIPLY then ADD.
    vmul = nt.nodes.new("ShaderNodeVectorMath")
    vmul.operation = "MULTIPLY"
    vmul.inputs[1].default_value = (0.5, 0.5, 0.5)
    vadd = nt.nodes.new("ShaderNodeVectorMath")
    vadd.operation = "ADD"
    vadd.inputs[1].default_value = (0.5, 0.5, 0.5)
    nt.links.new(xform.outputs["Vector"], vmul.inputs[0])
    nt.links.new(vmul.outputs["Vector"], vadd.inputs[0])
    nt.links.new(vadd.outputs["Vector"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    emit.inputs["Strength"].default_value = 1.0
    return mat


def _setup_compositor(out_dir: Path, *, want_depth: bool, want_seg: bool,
                      seg_max: int = 1, near_far: tuple[float, float] = (0.1, 100.0)) -> dict[str, bpy.types.Node]:
    """File Output node writes depth (Mist) and seg (Object Index) PNGs.

    Returns the set of passes actually wired — the manifest must only claim
    passes that were emitted.
    """
    scene = bpy.context.scene
    # Blender 5.x: compositor is a node group on compositing_node_group.
    ng = bpy.data.node_groups.get("NMA_PackageComp") or bpy.data.node_groups.new(
        "NMA_PackageComp", "CompositorNodeTree"
    )
    ng.nodes.clear()
    scene.compositing_node_group = ng
    nt = ng
    rl = nt.nodes.new("CompositorNodeRLayers")
    iface = getattr(ng, "interface", None)
    if iface is not None and not any(
        getattr(s, "in_out", "") == "OUTPUT" and getattr(s, "name", "") == "Image"
        for s in iface.items_tree
    ):
        iface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    base = nt.nodes.new("NodeGroupOutput")
    base.is_active_output = True
    nt.links.new(rl.outputs["Image"], base.inputs["Image"])

    # Blender 5.x Output File: one node per pass. Format lives on the nested
    # `format` struct (fo.format.file_format / .color_depth) — the flat
    # attributes are read-only. Research note: industry AOV practice is
    # float EXR, but the frame-package/v1 contract fixes PNG16-gray; the
    # real Z 'Depth' pass is normalized over [near,far] via MapRange, which
    # preserves the contract's linear-normalized semantics.
    emitted: dict[str, bpy.types.Node] = {}
    jobs = (
        (want_depth, "depth", "Depth", "Depth", "depthmap"),
        (want_seg, "segmentation", "Segmentation", "Object Index", "segmap"),
    )
    for want, pass_name, label, sock, kind in jobs:
        if not want:
            continue
        try:
            fo = nt.nodes.new("CompositorNodeOutputFile")
            fo.directory = str(out_dir / pass_name)
            # Blender 5.x: node media_type defaults to MULTI_LAYER_IMAGE which
            # locks file_format to OPEN_EXR_MULTILAYER. media_type='IMAGE'
            # unlocks PNG; color_depth '16' gives 16-bit output.
            fo.format.media_type = "IMAGE"
            fo.format.file_format = "PNG"
            fo.format.color_depth = "16"
            fo.format.color_mode = "BW"  # true grayscale colortype
            # RGBA socket + FLOAT MapRange result -> 16-bit gray PNG.
            fo.file_output_items.new("RGBA", label)
            fo.file_name = "f"
            src_socket = rl.outputs[sock]
            mr = nt.nodes.new("ShaderNodeMapRange")
            if kind == "depthmap":
                mr.inputs["From Min"].default_value = near_far[0]
                mr.inputs["From Max"].default_value = near_far[1]
                mr.inputs["To Min"].default_value = 0.0
                mr.inputs["To Max"].default_value = 1.0
                if hasattr(mr, "clamp"):
                    mr.clamp = True
            else:
                # Object index 1..N -> i/65535 so PNG16 stores the exact index.
                mr.inputs["From Min"].default_value = 1.0
                mr.inputs["From Max"].default_value = float(max(2, seg_max))
                mr.inputs["To Min"].default_value = 1.0 / 65535.0
                mr.inputs["To Max"].default_value = 1.0
                if hasattr(mr, "clamp"):
                    mr.clamp = True
            nt.links.new(src_socket, mr.inputs["Value"])
            nt.links.new(mr.outputs["Result"], fo.inputs[label])
            emitted[pass_name] = fo
        except Exception as e:
            print(f"[pkg] WARN: {pass_name} output failed: {e}")
    return emitted


def _camera_json(cam: bpy.types.Object, frame: int, w: int, h: int, near: float, far: float) -> dict:
    """Contract §3.7: fx/fy/cx/cy + column-major cam-to-world 4x4."""
    data = cam.data
    # sensor fit: AUTO -> horizontal if aspect >=1 else vertical
    aspect = w / h
    if data.sensor_fit == "VERTICAL" or (data.sensor_fit == "AUTO" and aspect < 1):
        fy = h * data.lens / data.sensor_height
        fx = fy
        cx, cy = w / 2, h / 2
    else:
        fx = w * data.lens / data.sensor_width
        fy = fx
        cx, cy = w / 2, h / 2
    m = cam.matrix_world
    # column-major 4x4 (glTF convention per contract): flat[c*4+r] = m[r][c]
    ext = [m[r][c] for c in range(4) for r in range(4)]
    return {
        "f": frame,
        "intrinsics": {"fx": fx, "fy": fy, "cx": cx, "cy": cy, "width": w, "height": h},
        "extrinsics_cam_to_world": ext,
        "depth_near": near,
        "depth_far": far,
        "rig_id": None,
    }


def _downscale_dir(directory: Path, factor: float) -> None:
    """Downscale every PNG in a pass dir by `factor` (0.5 -> quarter pixels).

    Uses bpy's own image loader/saver so 16-bit depth/seg stays 16-bit.
    """
    scene = bpy.context.scene
    saved_depth = scene.render.image_settings.color_depth
    for p in sorted(directory.glob("f*.png")):
        img = bpy.data.images.load(str(p))
        nw = max(2, int(img.size[0] * factor) // 2 * 2)
        nh = max(2, int(img.size[1] * factor) // 2 * 2)
        img.scale(nw, nh)
        scene.render.image_settings.color_depth = "16" if "depth" in directory.name or "segmentation" in directory.name else "8"
        img.save_render(str(p), scene=scene)
        bpy.data.images.remove(img)
    scene.render.image_settings.color_depth = saved_depth
    print(f"[pkg] downscaled {directory.name} x{factor}", flush=True)


def main() -> int:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) < 10:
        print("Usage: frame_package.py -- <src> <out_dir> <frames> <fps> <tier> <passes_csv> <pass_scale> <orbit_deg> <near> <far>")
        return 1
    # Blender's cwd is NOT the caller's — always work in absolute paths or
    # output silently lands relative to the Blender install drive.
    src, out_dir = str(Path(args[0]).resolve()), Path(args[1]).resolve()
    n_frames, fps = int(args[2]), int(args[3])
    tier = args[4]
    passes = {p.strip() for p in args[5].split(",") if p.strip()}
    pass_scale = float(args[6])
    orbit = float(args[7])
    near, far = float(args[8]), float(args[9])
    cfg = TIERS.get(tier, TIERS["draft"])
    w, h = cfg["res"]
    out_dir.mkdir(parents=True, exist_ok=True)

    _clear_scene()
    meshes = _load(src)
    if not meshes:
        print("[pkg] no meshes loaded")
        return 1
    _ensure_light()
    cam = _ensure_camera()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.fps = fps
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        for attr in ("taa_samples", "taa_render_samples"):
            if hasattr(eevee, attr):
                setattr(eevee, attr, cfg["samples"])
                break
    scene.view_settings.view_transform = "AgX"
    scene.frame_start, scene.frame_end = 1, n_frames
    vl_pass = scene.view_layers[0]
    if "depth" in passes:
        vl_pass.use_pass_z = True  # real Z depth; normalized over clip bounds below
    if "segmentation" in passes:
        vl_pass.use_pass_object_index = True
        for i, obj in enumerate(meshes, start=1):
            obj.pass_index = i
    want_depth = "depth" in passes
    want_seg = "segmentation" in passes
    emitted = _setup_compositor(
        out_dir, want_depth=want_depth, want_seg=want_seg,
        seg_max=len(meshes), near_far=(near, far),
    )
    if "depth" in passes and "depth" not in emitted:
        print("[pkg] WARN: depth pass requested but not emitted (no slot)")
    if "segmentation" in passes and "segmentation" not in emitted:
        print("[pkg] WARN: segmentation requested but not emitted (no slot)")

    norm_mat = _world_normal_material() if "normals" in passes else None
    vl = scene.view_layers[0]
    cam_data = cam.data
    if not cam_data.lens:
        cam_data.lens = 50

    # Orbit: pure function of frame index — camera orbits scene center.
    mins = Vector((1e30,) * 3)
    maxs = Vector((-1e30,) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            mins = Vector(map(min, mins, p))
            maxs = Vector(map(max, maxs, p))
    center = (mins + maxs) / 2
    radius = max((maxs - mins).length / 2 * 2.4, 0.5)

    beauty_dir = out_dir / "beauty"
    normals_dir = out_dir / "normals"
    cam_log = out_dir / "camera.jsonl"
    beauty_dir.mkdir(exist_ok=True)
    if "normals" in passes:
        normals_dir.mkdir(exist_ok=True)

    rendered = []
    for f in range(1, n_frames + 1):
        scene.frame_set(f)
        # Output File only appends frame numbers in animation renders; in
        # still mode every pass would overwrite one file. Set file_name per
        # frame so each pass writes f<frame><Slot>.png.
        for node in emitted.values():
            node.file_name = f"f{f:06d}"
        if orbit:
            ang = math.radians(orbit) * (f - 1) / max(n_frames - 1, 1)
            direction = Vector((math.cos(ang), math.sin(ang), 0.45)).normalized()
            cam.location = center + direction * radius
            cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        # Beauty + depth + seg in one render (compositor File Output emits extras).
        if "beauty" in passes:
            scene.render.filepath = str(beauty_dir / f"f{f:06d}.png")
            vl.material_override = None
            scene.view_settings.view_transform = "AgX"
            bpy.ops.render.render(write_still=True)
        elif want_depth or want_seg:
            # No beauty requested: still need one render for the data passes.
            vl.material_override = None
            scene.view_settings.view_transform = "Standard"
            bpy.ops.render.render(write_still=True)
        # Normals: override material, Standard transform (data, not display).
        if "normals" in passes:
            vl.material_override = norm_mat
            scene.view_settings.view_transform = "Standard"
            scene.render.filepath = str(normals_dir / f"f{f:06d}.png")
            bpy.ops.render.render(write_still=True)
            vl.material_override = None
            scene.view_settings.view_transform = "AgX"
        rendered.append(f)
        if f % 10 == 0 or f == n_frames:
            print(f"[pkg] frame {f}/{n_frames}", flush=True)

    # Normalize File Output names (f0001.png -> f000001.png) and apply the
    # storage valve: pass_scale < 1 downscales control passes in post.
    import re as _re

    for d in (out_dir / "depth", out_dir / "normals", out_dir / "segmentation"):
        if not d.is_dir():
            continue
        for p in d.glob("f*.png"):
            # Names look like f000001Depth.png (file_name + slot name).
            m6 = _re.fullmatch(r"f(\d{6})[A-Za-z]*\.png", p.name)
            if m6:
                p.rename(d / f"f{m6.group(1)}.png")

    if pass_scale < 1.0:
        for d in (out_dir / "depth", out_dir / "normals", out_dir / "segmentation"):
            if d.is_dir():
                _downscale_dir(d, pass_scale)

    # Palette: object index -> name (1-based, matching pass_index).
    if "segmentation" in emitted:
        palette = {str(i): {"name": o.name, "asset_id": None} for i, o in enumerate(meshes, start=1)}
        (out_dir / "segmentation_palette.json").write_text(
            json.dumps(palette, indent=2) + "\n", encoding="utf-8"
        )

    if "camera" in passes:
        with cam_log.open("w", encoding="utf-8") as fh:
            for f in rendered:
                scene.frame_set(f)
                if orbit:
                    ang = math.radians(orbit) * (f - 1) / max(n_frames - 1, 1)
                    direction = Vector((math.cos(ang), math.sin(ang), 0.45)).normalized()
                    cam.location = center + direction * radius
                    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
                fh.write(json.dumps(_camera_json(cam, f, w, h, near, far)) + "\n")

    # storage_bytes: sum of emitted package files (beauty+passes+jsonl+manifest later)
    def _tree_bytes(p: Path) -> int:
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())

    # Manifest claims only what was actually emitted.
    effective = set()
    if "beauty" in passes:
        effective.add("beauty")
    if "normals" in passes:
        effective.add("normals")  # rendered via material override, not compositor
    effective |= set(emitted)
    if "camera" in passes:
        effective.add("camera")
    manifest_passes = {"beauty": True} if "beauty" in effective else {}
    for p in ("depth", "normals", "segmentation"):
        if p in effective:
            manifest_passes[p] = {
                "encoding": "png16-gray" if p in ("depth", "segmentation") else "png8-rgb-linear",
                "scale": min(1.0, pass_scale),
                "conditional": False,
            }
            if p == "depth":
                manifest_passes[p]["near"], manifest_passes[p]["far"] = near, far
    storage = _tree_bytes(out_dir)
    manifest = {
        "contract": "frame-package/v1",
        "scene_id": Path(src).stem,
        "spec_id": None,
        "spec_version": None,
        "spec_hash8": None,
        "frame_count": n_frames,
        "fps": fps,
        "duration_seconds": n_frames / fps,
        "width": w,
        "height": h,
        "passes": manifest_passes,
        "assets": [],
        "camera_rig": "orbit" if orbit else None,
        "builder": {"engine": "blender-bpy", "version": bpy.app.version_string},
        "created_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "storage_bytes": storage,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"[pkg] done: {n_frames} frames -> {out_dir} ({_tree_bytes(out_dir) / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
