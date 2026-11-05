---
name: blender
description: Generate executable Blender Python (bpy) scripts from natural-language descriptions.
version: "1.0.0"
server: ollama-tools
tools:
  - plan_blender_script
tags:
  - blender
  - 3d
  - python
  - bpy
---

# Blender Skill

Generate executable Blender Python (bpy) scripts from natural-language descriptions.

## Tools

### plan_blender_script
Generate an executable Blender Python script from a natural-language description.

**Parameters:**
- `description` (string, required): What to build in Blender
- `target` (string, optional): Asset type hint (mesh, material, rig, scene, lighting, cleanup, uv). Default: "mesh"
- `model` (string, optional): Ollama text model. Default: "qwen3.5:4b"

**Example:**
```
mcp__ollama-tools__plan_blender_script --description "low-poly knight with metal armor" --target mesh
```

**Returns:** A JSON object with `script`, `instructions`, and `required_assets`. Execute the script with `blender_execute_blender_code` or in Blender's Text Editor.

## Notes
- Uses Ollama text model (qwen3.5:4b) with constrained JSON output
- Scripts use `bpy` only, metric units, and `Mesh.from_pydata` for geometry
- Nothing leaves the machine