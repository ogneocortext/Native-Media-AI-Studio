---
name: vision
description: Analyze images using Ollama vision models (gemma4:e2b-it-qat). Supports local files and remote URLs with automatic fallback to secondary vision models on an 8 GB VRAM card.
version: "1.0.0"
server: ollama-tools
tools:
  - analyze_image
tags:
  - vision
  - image
  - ollama
  - multimodal
---

# Vision Skill

Analyze images using Ollama vision models on the local machine.

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

## Notes
- Runs locally via Ollama; nothing leaves the machine
- Falls back to secondary vision model if the primary is unavailable
- On 8 GB VRAM cards, fallback model is unloaded after 2 minutes to free VRAM