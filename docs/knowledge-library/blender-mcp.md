---
tags:
  - blender
  - 3d-rendering
  - mcp
  - scene-building
aliases:
  - Blender MCP
  - Blender Integration
  - Scene Builder
cssclasses:
  - technical-guide
date: 2026-08-24
---

# 🖥️ Blender MCP Integration

> [!info] Scope
> Controlling Blender 5.2 via MCP protocol for automated scene building.
> Part of [[Native Media AI Studio]] music video pipeline.

---

## Setup Requirements

### Blender Configuration

> [!warning] Enable Addon
> 1. Open Blender 5.2
> 2. Edit → Preferences → Add-ons
> 3. Search "Blender MCP"
> 4. Enable the checkbox
> 5. Sidebar (N-panel) → "Blender MCP" tab → Start Server

### Connection Details

| Setting | Value |
|---------|-------|
| Blender Version | 5.2.0 LTS |
| Addon Version | 1.5 |
| Protocol Version | 4 |
| Transport | WebSocket |
| MCP Server | `blender-mcp` |

---

## Available Capabilities

### Scene Operations

> [!example] Get Scene Info
> ```python
> blender_get_scene_info()
> # Returns: object count, object list, materials
> ```

> [!example] Execute Python Code
> ```python
> blender_execute_blender_code(code="""
> import bpy
> bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
> """)
> ```

### Object Operations

> [!example] Get Object Details
> ```python
> blender_get_object_info(object_name="Cube")
> # Returns: location, rotation, scale, dimensions
> ```

> [!example] Viewport Screenshot
> ```python
> blender_get_viewport_screenshot()
> # Returns: image of current viewport
> ```

### PolyHaven Assets

> [!tip] Free HDRIs & Textures
> ```python
> blender_download_polyhaven_asset(
>     asset_id="symmetrical_garden",
>     asset_type="hdris",
>     resolution="2k"
> )
> ```

### Sketchfab Models

> [!note] 3D Model Download
> ```python
> blender_download_sketchfab_model(
>     uid="model_uid_here",
>     target_size=2.0  # meters
> )
> ```

---

## Scene Building for Music Videos

### Stage Construction

> [!example] Concert Stage
> ```python
> blender_execute_blender_code(code="""
> import bpy
> 
> # Clear scene
> bpy.ops.object.select_all(action='SELECT')
> bpy.ops.object.delete()
> 
> # Create stage platform
> bpy.ops.mesh.primitive_cylinder_add(
>     radius=5, depth=0.3, location=(0, 0, -0.15)
> )
> stage = bpy.context.active_object
> stage.name = "Stage"
> 
> # Add LED wall (back)
> bpy.ops.mesh.primitive_plane_add(
>     size=8, location=(0, -3, 2)
> )
> led_wall = bpy.context.active_object
> led_wall.name = "LED_Wall"
> led_wall.rotation_euler = (1.1, 0, 0)
> 
> # Add lighting
> bpy.ops.object.light_add(type='SPOT', location=(2, 3, 4))
> spot = bpy.context.active_object
> spot.data.energy = 500
> spot.data.spot_size = 0.8
> spot.data.color = (0.9, 0.7, 1.0)  # Purple tint
> """)
> ```

### Character Placement

> [!tip] Import 3D Character
> Import generated 3D models from [[3d-rendering]]:
> ```python
> blender_execute_blender_code(code="""
> import bpy
> 
> # Import generated 3D model
> bpy.ops.import_scene.obj(filepath="output/generated_3d/my_robot.obj")
> character = bpy.context.selected_objects[0]
> character.name = "MainCharacter"
> character.location = (0, 0, 0)
> character.scale = (0.5, 0.5, 0.5)
> """)
> ```

### Camera Setup

> [!example] Cinematic Camera
> ```python
> blender_execute_blender_code(code="""
> import bpy
> 
> # Create camera
> bpy.ops.object.camera_add(location=(7, -7, 4))
> camera = bpy.context.active_object
> camera.name = "MainCamera"
> 
> # Point at stage center
> direction = (0, 0, 1)
> camera.rotation_euler = (1.1, 0, 0.78)
> 
> # Set as active camera
> bpy.context.scene.camera = camera
> 
> # Camera settings
> cam_data = camera.data
> cam_data.lens = 35  # 35mm focal length
> cam_data.sensor_width = 36
> cam_data.dof.use_dof = True
> cam_data.dof.aperture_fstop = 2.8
> """)
> ```

---

## Beat-Synced Animation

> [!important] Music Sync
> Animate objects to beat timestamps from audio analysis:

```python
# Beat times from [[music-video-production]]
beat_times = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]

# Animate camera on beats
for i, beat_time in enumerate(beat_times):
    frame = int(beat_time * 24)  # 24 fps
    
    # Camera shake on beat
    camera.location.x = 7 + (0.1 if i % 2 == 0 else -0.1)
    camera.keyframe_insert(data_path="location", frame=frame)
```

### Animation Presets

| Effect | Description | Use Case |
|--------|-------------|----------|
| Beat Pulse | Scale object on each beat | Props, stage elements |
| Camera Shake | Small position offset on beats | Energy moments |
| Color Flash | Light color change on beats | LED walls, lights |
| Zoom In | Dolly in on chorus | Build intensity |
| Orbit | Circle camera around subject | Showcase moments |

---

## Rendering for Music Videos

### Output Settings

> [!example] Video Render Settings
> ```python
> blender_execute_blender_code(code="""
> import bpy
> scene = bpy.context.scene
> 
> # Output settings
> scene.render.filepath = "output/frames/frame_"
> scene.render.image_settings.file_format = 'PNG'
> scene.render.resolution_x = 1920
> scene.render.resolution_y = 1080
> scene.render.resolution_percentage = 100
> 
> # Frame range (10 seconds at 24fps)
> scene.frame_start = 1
> scene.frame_end = 240
> scene.render.fps = 24
> 
> # Render engine (CUDA)
> scene.render.engine = 'CYCLES'
> scene.cycles.device = 'GPU'
> scene.cycles.samples = 128
> scene.cycles.use_denoising = True
> """)
> ```

### Render Animation

> [!note] Batch Rendering
> ```python
> blender_execute_blender_code(code="""
> import bpy
> bpy.ops.render.render(animation=True)
> """)
> ```

---

## Integration with Pipeline

### Workflow Order

```mermaid
graph TD
    A[Audio Analysis] --> B[Scene Design]
    B --> C[Generate 3D Assets]
    C --> D[Import to Blender]
    D --> E[Build Stage]
    E --> F[Add Camera]
    F --> G[Beat Sync Animation]
    G --> H[Render Frames]
    H --> I[Composite Video]
```

### Data Flow

1. **[[music-video-production]]** → Audio analysis (beats, sections)
2. **[[3d-rendering]]** → Generate 3D props/characters
3. **[[comfyui-workflows]]** → Generate textures/backgrounds
4. **Blender MCP** → Build scene, animate, render
5. **[[youtube-optimization]]** → Export and publish

---

## Troubleshooting

### Connection Issues

| Error | Cause | Solution |
|-------|-------|----------|
| `Could not connect` | Addon not enabled | Enable in Preferences → Add-ons |
| `Server not running` | MCP stopped | Click "Start MCP Server" in sidebar |
| `Protocol version mismatch` | Outdated addon | Run `uvx blender-mcp install-addon` |

### Rendering Issues

| Error | Cause | Solution |
|-------|-------|----------|
| Black render | No lights/lights too weak | Add lighting to scene |
| Slow render | High samples/resolution | Reduce samples, use EEVEE |
| OOM on render | Scene too complex | Reduce geometry, use instancing |

---

## See Also

- [[music-video-production]] — Full production workflow
- [[3d-rendering]] — GPU rendering optimization
- [[comfyui-workflows]] — Asset generation
- [[technical-reference]] — System architecture
- [[prompt-engineering]] — 3D asset prompts

---

*Last updated: 2026-08-24*
