---
name: blender
description: Generate executable Blender Python (bpy) scripts and 3D concept prompts from natural-language descriptions.
version: "1.0.0"
server: ollama-tools
tools:
  - plan_blender_script
  - suggest_3d_prompt
  - generate_3d_concept
tags:
  - blender
  - 3d
  - python
  - bpy
  - concept
example_inputs:
  - tool: plan_blender_script
    args: { description: "low-poly knight with metal armor", target: "mesh" }
  - tool: suggest_3d_prompt
    args: { idea: "futuristic armor", category: "clothing", style: "cyberpunk" }
  - tool: generate_3d_concept
    args: { description: "cyberpunk knight with glowing armor", category: "3d-character", width: 1024, height: 1024 }
example_outputs:
  - tool: plan_blender_script
    output: '{ "script": "import bpy...", "instructions": ["Open Blender", "Paste into Text Editor", "Press Run"], "required_assets": [] }'
  - tool: suggest_3d_prompt
    output: 'Optimized prompt: "futuristic cyberpunk armor with glowing circuits, detailed textures". Negative: "blurry, low quality"'
  - tool: generate_3d_concept
    output: "Concept image URL: http://127.0.0.1:8188/view?prompt_id=abc123"
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

### suggest_3d_prompt
Enhance a raw 3D idea into a detailed prompt with skin/texture/clothing/material guidance.

**Parameters:**
- `idea` (string, required): Raw character/object idea
- `category` (string, optional): One of: character, clothing, skin_material, environment. Default: "character"
- `style` (string, optional): Optional style hint (cyberpunk, fantasy, realistic, stylized)

**Example:**
```
mcp__ollama-tools__suggest_3d_prompt --idea "low-poly knight" --category character --style cyberpunk
```

**Returns:** An optimized 3D-ready prompt plus negative prompt.

### generate_3d_concept
Generate a concept image optimized for 3D conversion (Hunyuan3D-friendly). Uses prompt templates for characters, clothing, skin, or environments.

**Parameters:**
- `description` (string, required): Subject description
- `category` (string, optional): One of: 3d-character, 3d-character-texture, 3d-clothing, 3d-skin-material, 3d-environment. Default: "3d-character"
- `width` (number, optional): Width in pixels, default: 1024
- `height` (number, optional): Height in pixels, default: 1024

**Example:**
```
mcp__ollama-tools__generate_3d_concept --description "cyberpunk knight with glowing armor" --category 3d-character
```

**Returns:** A generated concept image URL via ComfyUI.