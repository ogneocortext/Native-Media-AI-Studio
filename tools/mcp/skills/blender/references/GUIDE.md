# Blender Skill Guide

## plan_blender_script

### Basic usage
```
mcp__ollama-tools__plan_blender_script --description "low-poly knight with metal armor"
```

### With target asset type
```
mcp__ollama-tools__plan_blender_script --description "glowing crystal" --target material
```

### With custom model
```
mcp__ollama-tools__plan_blender_script --description "sci-fi corridor" --target scene --model qwen3.5:4b
```

### Returns
A JSON object with `script`, `instructions`, and `required_assets`. Execute with `blender_execute_blender_code` or in Blender's Text Editor.

## suggest_3d_prompt

### Basic usage
```
mcp__ollama-tools__suggest_3d_prompt --idea "low-poly knight"
```

### With category and style
```
mcp__ollama-tools__suggest_3d_prompt --idea "futuristic armor" --category clothing --style cyberpunk
```

### Returns
An optimized 3D-ready prompt plus negative prompt.

## generate_3d_concept

### Basic usage
```
mcp__ollama-tools__generate_3d_concept --description "cyberpunk knight with glowing armor"
```

### With category and dimensions
```
mcp__ollama-tools__generate_3d_concept --description "crystal castle" --category 3d-environment --width 1920 --height 1080
```

### Returns
A generated concept image URL via ComfyUI.

### Common patterns
- **Concept first**: Use suggest_3d_prompt to refine an idea, then generate_3d_concept to visualize it
- **Asset pipeline**: Generate concept → plan_blender_script to create the actual 3D asset
- **Category matching**: Match category to asset type (character for models, clothing for textures, etc.)

### Parameters reference
| Tool | Parameter | Type | Required | Default | Description |
|------|-----------|------|----------|---------|-------------|
| plan_blender_script | description | string | Yes | — | What to build in Blender |
| plan_blender_script | target | string | No | "mesh" | Asset type: mesh, material, rig, scene, lighting, cleanup, uv |
| plan_blender_script | model | string | No | "qwen3.5:4b" | Ollama text model |
| suggest_3d_prompt | idea | string | Yes | — | Raw character/object idea |
| suggest_3d_prompt | category | string | No | "character" | character, clothing, skin_material, environment |
| suggest_3d_prompt | style | string | No | — | Style hint: cyberpunk, fantasy, realistic, stylized |
| generate_3d_concept | description | string | Yes | — | Subject description |
| generate_3d_concept | category | string | No | "3d-character" | 3d-character, 3d-character-texture, 3d-clothing, 3d-skin-material, 3d-environment |
| generate_3d_concept | width | number | No | 1024 | Width in pixels |
| generate_3d_concept | height | number | No | 1024 | Height in pixels |

### Notes
- Uses Ollama text model (qwen3.5:4b) with constrained JSON output
- Scripts use `bpy` only, metric units, and `Mesh.from_pydata` for geometry
- generate_3d_concept requires ComfyUI running at http://127.0.0.1:8188
- Nothing leaves the machine

## Cross-Skill References

- **comfyui**: Generate concept images via generate_3d_concept — see `comfyui` skill
- **context**: Store 3D scene state and asset references — see `context` skill