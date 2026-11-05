---
name: comfyui
description: Generate images and video clips via ComfyUI workflows (Wan2.1 model for video).
version: "1.0.0"
server: ollama-tools
tools:
  - generate_image
  - generate_video
tags:
  - comfyui
  - image
  - video
  - generation
---

# ComfyUI Skill

Generate images and video clips via local ComfyUI workflows.

## Tools

### generate_image
Generate an image via ComfyUI workflow (SDXL).

**Parameters:**
- `prompt` (string, required): Image prompt
- `negative_prompt` (string, optional): Negative prompt. Default: ""
- `width` (number, optional): Width in pixels. Default: 1024
- `height` (number, optional): Height in pixels. Default: 1024
- `workflow` (string, optional): ComfyUI workflow name. Default: "txt2img"

### generate_video
Generate a video clip via ComfyUI (Wan2.1 model).

**Parameters:**
- `prompt` (string, required): Video prompt
- `negative_prompt` (string, optional): Negative prompt. Default: ""
- `width` (number, optional): Width in pixels. Default: 1024
- `height` (number, optional): Height in pixels. Default: 768
- `duration` (number, optional): Duration in seconds. Default: 4
- `fps` (number, optional): Frames per second. Default: 24

**Example:**
```
mcp__ollama-tools__generate_video --prompt "A cinematic music video frame with neon lights" --duration 4
```

**Returns:** A ComfyUI prompt_id for the queued job.

## Notes
- Requires ComfyUI running at http://127.0.0.1:8188
- Video generation requires Wan2.1 model and ComfyUI-VideoHelperSuite custom node
- Images use SDXL checkpoint by default