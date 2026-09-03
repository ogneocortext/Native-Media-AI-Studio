"""Decimate a GLB mesh to a target face count using Blender."""
import bpy
import sys
import os
from mathutils import Vector

def decimate_glb(input_path: str, output_path: str, target_faces: int = 50000) -> dict:
    """Import a GLB, decimate to target face count, and export.
    
    Returns dict with original_faces, final_faces, success.
    """
    try:
        # Clear scene
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        
        # Import GLB
        bpy.ops.import_scene.gltf(filepath=input_path)
        
        # Get imported objects
        imported = bpy.context.selected_objects
        if not imported:
            return {"success": False, "error": "No objects imported"}
        
        # Calculate original face count
        original_faces = 0
        for obj in imported:
            if obj.type == 'MESH' and obj.data:
                original_faces += len(obj.data.polygons)
        
        if original_faces == 0:
            return {"success": False, "error": "No mesh data found"}
        
        # If already under target, just export
        if original_faces <= target_faces:
            bpy.ops.export_scene.gltf(
                filepath=output_path,
                export_format='GLB',
                export_apply=True,
                export_texcoords=True,
                export_normals=True,
                export_materials='EXPORT'
            )
            return {
                "success": True,
                "original_faces": original_faces,
                "final_faces": original_faces,
                "decimated": False
            }
        
        # Decimate each mesh object
        ratio = target_faces / original_faces
        for obj in imported:
            if obj.type == 'MESH' and obj.data:
                # Add decimate modifier
                mod = obj.modifiers.new(name="Decimate", type='DECIMATE')
                mod.decimate_type = 'COLLAPSE'
                mod.ratio = ratio
                
                # Apply modifier
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.modifier_apply(modifier=mod.name)
        
        # Calculate final face count
        final_faces = 0
        for obj in imported:
            if obj.type == 'MESH' and obj.data:
                final_faces += len(obj.data.polygons)
        
        # Export decimated GLB
        bpy.ops.export_scene.gltf(
            filepath=output_path,
            export_format='GLB',
            export_apply=True,
            export_texcoords=True,
            export_normals=True,
            export_materials='EXPORT'
        )
        
        return {
            "success": True,
            "original_faces": original_faces,
            "final_faces": final_faces,
            "decimated": True,
            "ratio": ratio
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    
    if len(args) < 2:
        print("Usage: blender --background --python decimate_glb.py -- <input.glb> <output.glb> [target_faces]")
        sys.exit(1)
    
    input_path = args[0]
    output_path = args[1]
    target_faces = int(args[2]) if len(args) > 2 else 50000
    
    result = decimate_glb(input_path, output_path, target_faces)
    print(result)
    sys.exit(0 if result.get("success") else 1)