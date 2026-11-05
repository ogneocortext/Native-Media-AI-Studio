# Vision Skill Guide

## analyze_image

### Basic usage
```
mcp__ollama-tools__analyze_image --image_path ./output/render/frame_001.png
```

### With custom prompt
```
mcp__ollama-tools__analyze_image --image_path ./output/render/frame_001.png --prompt "What lighting setup is used in this frame?"
```

### With remote URL
```
mcp__ollama-tools__analyze_image --image_path https://example.com/image.jpg --prompt "Describe the composition."
```

### With specific model and reasoning
```
mcp__ollama-tools__analyze_image --image_path ./output/render/frame_001.png --model gemma4:e2b-it-qat --think true --prompt "Analyze the color palette and suggest improvements."
```

### Common patterns
- **Frame analysis**: Analyze rendered frames from video output to understand scene content
- **Quality check**: Verify generated images match the intended prompt
- **Content tagging**: Extract objects, colors, mood for metadata

### Parameters reference
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| image_path | string | Yes | — | Path or URL to the image file |
| prompt | string | No | "Describe this image in detail." | Question to ask about the image |
| model | string | No | gemma4:e2b-it-qat | Ollama vision model name |
| think | boolean | No | false | Enable extended reasoning |

### Returns
A text description of the image content, including objects, colors, mood, and composition details.

### Notes
- Runs locally via Ollama; nothing leaves the machine
- Falls back to secondary vision model if primary is unavailable
- On 8 GB VRAM cards, fallback model is unloaded after 2 minutes to free VRAM

## Cross-Skill References

- **audio**: Analyze audio tracks for BPM/energy before video generation — see `audio` skill
- **context**: Store scene/visualization state from image analysis — see `context` skill
- **comfyui**: Generate images first, then analyze them — see `comfyui` skill