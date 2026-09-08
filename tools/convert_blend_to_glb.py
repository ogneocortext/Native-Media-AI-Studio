#!/usr/bin/env python3
"""
Convert .blend -> GLB for Media Library + Three.js Studio

Usage:
  python tools/convert_blend_to_glb.py stage.blend
  python tools/convert_blend_to_glb.py stage.blend --output output/generated_3d/stage.glb
  python tools/convert_blend_to_glb.py stage.blend --public --apply --animations

- Runs Blender 5.2 headless (no MCP needed, survives Blender UI hang)
- Exports with Three.js-friendly settings (Y-up, apply modifiers, bake animations)
- Copies to both output/generated_3d/ (Media Library DB) and packages/frontend/public/models/ (Three.js Studio /models URL)
- AI agents: call this after blender_execute_blender_code generation, before MediaLibrary add-to-studio

Supported: .blend -> .glb/.gltf, preserves armatures/actions, applies transforms.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "output" / "generated_3d"
PUBLIC_MODELS_DIR = PROJECT_ROOT / "packages" / "frontend" / "public" / "models" / "blends"

BLENDER_CANDIDATES = [
    r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender\blender.exe",
]

def find_blender() -> str:
    for c in BLENDER_CANDIDATES:
        if Path(c).exists():
            return c
    w = shutil.which("blender")
    if w:
        return w
    raise FileNotFoundError("Blender not found — install 5.2 at C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe or add to PATH")

BLENDER_SCRIPT = r"""
import bpy, sys, json, os
from pathlib import Path
blend_path = Path(r'''{blend}''')
out_path = Path(r'''{out}''')
export_animations = {anim}
export_apply = {apply_flag}

# Open blend file
bpy.ops.wm.open_mainfile(filepath=str(blend_path))

# Ensure we export visible collections only (not hidden)
# Select all mesh/armature/light/camera objects that are visible
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.data.objects:
    if obj.type in ('MESH','ARMATURE') and not obj.hide_viewport and not obj.hide_get():
        try:
            obj.select_set(True)
        except: pass

# If nothing selected (empty view), select all meshes
if not any(o.select_get() for o in bpy.data.objects):
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.select_set(True)

out_path.parent.mkdir(parents=True, exist_ok=True)
try:
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format='GLB',
        export_apply=export_apply,
        export_yup=True,
        export_animations=export_animations,
        export_frame_range=False,
        export_force_sampling=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        use_selection=False,  # export whole scene (agents: stage + props)
    )
    print(json.dumps({{"success": True, "output": str(out_path), "size": out_path.stat().st_size if out_path.exists() else 0}}))
except Exception as e:
    print(json.dumps({{"success": False, "error": str(e)}}))
    sys.exit(1)
"""

def convert(blend: Path, out: Path | None, to_public: bool, do_apply: bool, do_anim: bool) -> Path:
    blend = Path(blend).resolve()
    if not blend.exists():
        raise FileNotFoundError(f"Blend not found: {blend}")
    if out is None:
        # Default to output/generated_3d/<name>.glb
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out = OUTPUT_DIR / (blend.stem + ".glb")
    else:
        out = Path(out).resolve()
        out.parent.mkdir(parents=True, exist_ok=True)

    blender = find_blender()
    script = BLENDER_SCRIPT.format(
        blend=str(blend).replace("\\", "\\\\"),
        out=str(out).replace("\\", "\\\\"),
        anim="True" if do_anim else "False",
        apply_flag="True" if do_apply else "False",
    )
    # Write temp script
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as tf:
        tf.write(script)
        temp_script = tf.name

    print(f"Blender: {blender}")
    print(f"Blend: {blend} -> GLB: {out} (apply={do_apply}, animations={do_anim})")
    result = subprocess.run(
        [blender, "--background", "--python", temp_script],
        capture_output=True, text=True, timeout=120
    )
    print(result.stdout)
    if result.stderr:
        print("--- stderr ---", result.stderr, file=sys.stderr)
    try:
        os.unlink(temp_script)
    except Exception:
        pass

    if not out.exists():
        raise RuntimeError(f"Export failed — no GLB at {out}\nstdout: {result.stdout}\nstderr: {result.stderr}")

    # Also copy to public/models for Three.js Studio direct /models URL
    if to_public:
        PUBLIC_MODELS_DIR.mkdir(parents=True, exist_ok=True)
        public_dest = PUBLIC_MODELS_DIR / (blend.stem + ".glb")
        shutil.copy2(out, public_dest)
        print(f"Copied to public Three.js path: {public_dest} (/models/blends/{public_dest.name})")

    # Print DB-friendly relative path for Media Library
    try:
        rel = out.relative_to(PROJECT_ROOT / "output")
        print(f"Media Library relative_path: {rel.as_posix()} -> /output/{rel.as_posix()}")
    except Exception:
        pass

    return out

def main():
    parser = argparse.ArgumentParser(description="Convert .blend to GLB for Media Library + Three.js Studio")
    parser.add_argument("blend", help="Path to .blend file (e.g. stage.blend or output/stage.blend)")
    parser.add_argument("--output", "-o", help="Output GLB path (default output/generated_3d/<name>.glb)")
    parser.add_argument("--public", action="store_true", help="Also copy to packages/frontend/public/models/blends/ for /models URL")
    parser.add_argument("--no-apply", dest="apply", action="store_false", help="Don't apply modifiers/transforms")
    parser.add_argument("--no-animations", dest="animations", action="store_false", help="Skip baking animations")
    parser.set_defaults(apply=True, animations=True)
    args = parser.parse_args()
    out = convert(Path(args.blend), Path(args.output) if args.output else None, args.public, args.apply, args.animations)
    print(f"Done: {out}")

if __name__ == "__main__":
    main()
