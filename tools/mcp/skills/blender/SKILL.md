---
name: blender
description: Generates executable Blender Python (bpy) scripts and 3D concept prompts from natural-language descriptions. Use when a 3D object, character, or scene needs a Blender script, or when a raw 3D idea needs refinement into a detailed prompt.
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

Generates executable Blender Python (bpy) scripts and 3D concept prompts from natural-language descriptions.

## When to Use This Skill

- A 3D object, character, or scene needs a Blender Python script from a description
- A raw 3D idea needs refinement into a detailed prompt with material/texture guidance
- A concept image optimized for 3D conversion (Hunyuan3D-friendly) needs generation

## Critical Rules

- Uses Ollama text model (qwen3.5:4b) with constrained JSON output
- Scripts use `bpy` only, metric units, and `Mesh.from_pydata` for geometry
- generate_3d_concept requires ComfyUI running at http://127.0.0.1:8188
- Nothing leaves the machine

## Quick Start / Workflow

1. Call `suggest_3d_prompt` to refine a raw idea into a detailed 3D-ready prompt
2. Call `plan_blender_script` to generate an executable Blender Python script from the prompt
3. Call `generate_3d_concept` to create a concept image for 3D conversion reference
4. Execute the script in Blender's Text Editor or via `blender_execute_blender_code`

## Reference Navigation

- See [references/GUIDE.md](references/GUIDE.md) for detailed examples and parameter reference

## Anti-patterns

- Do not expect scripts to use external Blender addons; `bpy` only
- Do not use imperial units; scripts must use metric units
- Do not call generate_3d_concept without ComfyUI running

## Cross-Skill References

- **comfyui**: Generate concept images via generate_3d_concept — see `comfyui` skill
- **context**: Store 3D scene state and asset references — see `context` skill

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

### suggest_3d_prompt

Enhance a raw 3D idea into a detailed prompt with skin/texture/clothing/material guidance.

**Parameters:**
- `idea` (string, required): Raw character/object idea
- `category` (string, optional): One of: character, clothing, skin_material, environment. Default: "character"
- `style` (string, optional): Optional style hint (cyberpunk, fantasy, realistic, stylized)

**Example:**
```
mcp__ollama-tools__suggest_3d_prompt --idea "futuristic armor" --category clothing --style cyberpunk
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

## Notes
- Uses Ollama text model (qwen3.5:4b) with constrained JSON output
- Scripts use `bpy` only, metric units, and `Mesh.from_pydata` for geometry
- Nothing leaves the machine
