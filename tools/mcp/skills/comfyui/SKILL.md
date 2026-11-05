---
name: comfyui
description: Generates images and video clips via ComfyUI workflows. Use when a still image or short video clip needs generation from a text prompt. Video generation requires the Wan2.1 model and ComfyUI-VideoHelperSuite custom node.
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
example_inputs:
  - tool: generate_image
    args: { prompt: "A cinematic portrait of a musician", width: 1024, height: 1024 }
  - tool: generate_video
    args: { prompt: "A cinematic music video frame with neon lights", duration: 4, fps: 24 }
example_outputs:
  - tool: generate_image
    output: "prompt_id: abc123def456"
  - tool: generate_video
    output: "prompt_id: xyz789uvw012"
---

# ComfyUI Skill

Generate images and video clips via local ComfyUI workflows.

## When to Use This Skill

- A still image needs generation from a text prompt via ComfyUI
- A short video clip (4-8 seconds) needs generation via Wan2.1
- Keyframes or storyboard frames need generation for music video scenes

## Critical Rules

- Requires ComfyUI running at http://127.0.0.1:8188
- Video generation requires Wan2.1 model and ComfyUI-VideoHelperSuite custom node
- Images use SDXL checkpoint by default
- Each call queues a job; use the returned prompt_id to track status

## Quick Start / Workflow

1. Call `generate_image` with `prompt` for still image generation
2. Call `generate_video` with `prompt` and optional `duration`/`fps` for video
3. Use the returned `prompt_id` to check job status via ComfyUI directly

## Reference Navigation

- See [references/GUIDE.md](references/GUIDE.md) for detailed examples and parameter reference

## Anti-patterns

- Do not expect immediate results; generation is asynchronous via ComfyUI queue
- Do not use for real-time video; generation takes seconds to minutes per clip
- Do not pass prompts requiring models not installed in ComfyUI

## Tools

### generate_image

Generate an image via ComfyUI workflow (SDXL).

**Parameters:**
- `prompt` (string, required): Image prompt
- `negative_prompt` (string, optional): Negative prompt. Default: ""
- `width` (number, optional): Width in pixels. Default: 1024
- `height` (number, optional): Height in pixels. Default: 1024
- `workflow` (string, optional): ComfyUI workflow name. Default: "txt2img"

**Example:**
```
mcp__ollama-tools__generate_image --prompt "A cinematic portrait of a musician"
```

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