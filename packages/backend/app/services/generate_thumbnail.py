"""Generate thumbnail preview for a 3D model using Blender."""
import bpy
import sys
import os

def generate_thumbnail(glb_path: str, output_path: str, size: int = 256) -> bool:
    """Render a thumbnail of a GLB file using Blender."""
    try:
        # Clear scene
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        
        # Clear data blocks
        for mesh in bpy.data.meshes:
            bpy.data.meshes.remove(mesh)
        for mat in bpy.data.materials:
            bpy.data.materials.remove(mat)
        for cam in bpy.data.cameras:
            bpy.data.cameras.remove(cam)
        for light in bpy.data.lights:
            bpy.data.lights.remove(light)
        
        # Import GLB
        bpy.ops.import_scene.gltf(filepath=glb_path)
        
        # Get imported objects
        imported = bpy.context.selected_objects
        if not imported:
            return False
        
        # Calculate bounding box
        min_coord = [float('inf')] * 3
        max_coord = [float('-inf')] * 3
        for obj in imported:
            if obj.type == 'MESH':
                for vertex in obj.data.vertices:
                    world_co = obj.matrix_world @ vertex.co
                    for i in range(3):
                        min_coord[i] = min(min_coord[i], world_co[i])
                        max_coord[i] = max(max_coord[i], world_co[i])
        
        # Calculate center and size
        center = [(min_coord[i] + max_coord[i]) / 2 for i in range(3)]
        size_obj = max(max_coord[i] - min_coord[i] for i in range(3))
        
        if size_obj < 0.01:
            size_obj = 1.0
        
        # Add camera
        bpy.ops.object.camera_add(location=(center[0] + size_obj * 1.5, center[1] - size_obj * 1.5, center[2] + size_obj * 0.8))
        camera = bpy.context.active_object
        camera.name = "ThumbnailCamera"
        
        # Point camera at center
        from mathutils import Vector, Matrix
        direction = Vector([center[i] - camera.location[i] for i in range(3)])
        rot_quat = direction.to_track_quat('-Z', 'Y')
        camera.rotation_euler = rot_quat.to_euler()
        
        # Set camera as active
        bpy.context.scene.camera = camera
        
        # Add lighting
        bpy.ops.object.light_add(type='SUN', location=(center[0] + size_obj * 2, center[1] - size_obj * 2, center[2] + size_obj * 2))
        sun = bpy.context.active_object
        sun.data.energy = 3.0
        
        bpy.ops.object.light_add(type='AREA', location=(center[0] - size_obj, center[1] + size_obj, center[2] + size_obj * 0.5))
        area = bpy.context.active_object
        area.data.energy = 100.0
        
        # Set render settings
        scene = bpy.context.scene
        scene.render.resolution_x = size
        scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.film_transparent = True
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        
        # Set output path
        scene.render.filepath = output_path
        
        # Render
        bpy.ops.render.render(write_still=True)
        
        return os.path.exists(output_path)
        
    except Exception as e:
        print(f"Error generating thumbnail: {e}", file=sys.stderr)
        return False

if __name__ == "__main__":
    # When called from Blender with: blender --background --python script.py -- arg1 arg2
    # Arguments after -- are in sys.argv
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    
    if len(args) < 2:
        print("Usage: blender --background --python generate_thumbnail.py -- <glb_path> <output_path> [size]")
        sys.exit(1)
    
    glb_path = args[0]
    output_path = args[1]
    size = int(args[2]) if len(args) > 2 else 256
    
    success = generate_thumbnail(glb_path, output_path, size)
    sys.exit(0 if success else 1)