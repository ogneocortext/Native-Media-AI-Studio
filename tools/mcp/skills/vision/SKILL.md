---
name: vision
description: Analyzes images using Ollama vision models. Use when an image needs description, object identification, color analysis, or mood assessment. Falls back to a secondary vision model if the primary is unavailable on 8 GB VRAM cards.
version: "1.0.0"
server: ollama-tools
tools:
  - analyze_image
tags:
  - vision
  - image
  - ollama
  - multimodal
example_inputs:
  - tool: analyze_image
    args: { image_path: "./output/render/frame_001.png", prompt: "What is happening in this frame?" }
example_outputs:
  - tool: analyze_image
    output: "The frame shows a neon-lit cyberpunk cityscape with flying vehicles. Dominant colors are purple and blue. Mood is futuristic and energetic."
---

# Vision Skill

Analyzes images using Ollama vision models on the local machine.

## When to Use This Skill

- An image file or URL needs description, object identification, color analysis, or mood assessment
- Rendered video frames need content analysis for scene understanding
- Generated images need quality verification against their intended prompt

## Critical Rules

- Runs locally via Ollama; nothing leaves the machine
- Falls back to a secondary vision model if the primary is unavailable
- On 8 GB VRAM cards, the fallback model unloads after 2 minutes to free VRAM
- Image must be accessible as a local file path or a public HTTP URL

## Quick Start / Workflow

1. Call `analyze_image` with `image_path` set to the local path or URL
2. Optionally set `prompt` to ask a specific question (default: "Describe this image in detail.")
3. Optionally set `model` to a specific Ollama vision model (default: gemma4:e2b-it-qat)
4. Optionally set `think` to true for extended reasoning (Ollama 0.21.3+)

## Reference Navigation

- See [references/GUIDE.md](references/GUIDE.md) for detailed examples and parameter reference

## Anti-patterns

- Do not pass local filesystem paths that the Ollama server cannot access
- Do not expect raw pixel data; the skill returns a text description only
- Do not use for real-time video analysis; call per-frame instead

## Tools

### analyze_image

Analyze an image using Ollama vision model. Returns description, objects, colors, mood.

**Parameters:**
- `image_path` (string, required): Path or URL to the image
- `prompt` (string, optional): Question to ask about the image. Default: "Describe this image in detail."
- `model` (string, optional): Ollama vision model. Defaults to a resident vision model when one is warm; otherwise gemma4:e2b-it-qat.
- `think` (boolean, optional): Enable extended reasoning (Ollama 0.21.3+). Default: false

**Example:**
```
mcp__ollama-tools__analyze_image --image_path ./output/render/frame_001.png --prompt "What is happening in this frame?"
```

**Returns:** A text description of the image content.