"""Assign a chrome PBR material to an untextured GLB via Blender."""
import bpy
import sys

def apply_chrome(input_path: str, output_path: str):
    try:
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=input_path)
        objs = [o for o in bpy.context.selected_objects if o.type == 'MESH']
        if not objs:
            return {"success": False, "error": "no mesh"}
        # create chrome material
        mat = bpy.data.materials.new(name="Chrome")
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()
        out = nodes.new(type='ShaderNodeOutputMaterial')
        out.location = (300, 0)
        principled = nodes.new(type='ShaderNodeBsdfPrincipled')
        principled.location = (0, 0)
        # Principled BSDF inputs: Base Color, Metallic, Roughness
        # Use light gray base, metallic 1.0, roughness 0.15 for chrome
        principled.inputs['Base Color'].default_value = (0.85, 0.85, 0.88, 1)
        # Metallic
        if 'Metallic' in principled.inputs:
            principled.inputs['Metallic'].default_value = 1.0
        # Roughness
        principled.inputs['Roughness'].default_value = 0.15
        # Specular
        if 'Specular IOR Level' in principled.inputs:
            principled.inputs['Specular IOR Level'].default_value = 1.0
        links.new(principled.outputs['BSDF'], out.inputs['Surface'])
        for o in objs:
            if o.data.materials:
                o.data.materials[0] = mat
            else:
                o.data.materials.append(mat)
        bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB', export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT')
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    if len(args) < 2:
        print("Usage: blender --background --python apply_chrome.py -- <in.glb> <out.glb>")
        sys.exit(1)
    r = apply_chrome(args[0], args[1])
    print(r)
    sys.exit(0 if r.get("success") else 1)
