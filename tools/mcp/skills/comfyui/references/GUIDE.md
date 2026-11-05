# ComfyUI Skill Guide

## generate_image

### Basic usage
```
mcp__ollama-tools__generate_image --prompt "A cinematic portrait of a musician"
```

### With custom dimensions
```
mcp__ollama-tools__generate_image --prompt "Cyberpunk cityscape at night" --width 1920 --height 1080
```

### With negative prompt
```
mcp__ollama-tools__generate_image --prompt "beautiful landscape" --negative_prompt "blurry, low quality, distorted, watermark"
```

### Returns
A ComfyUI prompt_id for the queued generation job.

## generate_video

### Basic usage
```
mcp__ollama-tools__generate_video --prompt "A cinematic music video frame with neon lights"
```

### With custom duration and FPS
```
mcp__ollama-tools__generate_video --prompt "Abstract fluid motion" --duration 8 --fps 30
```

### Returns
A ComfyUI prompt_id for the queued video generation job.

### Common patterns
- **Frame generation**: Generate keyframes for music video scenes
- **Storyboard**: Generate multiple frames at different timestamps
- **Style testing**: Test different visual styles before full render

### Parameters reference
| Tool | Parameter | Type | Required | Default | Description |
|------|-----------|------|----------|---------|-------------|
| generate_image | prompt | string | Yes | — | Image prompt |
| generate_image | negative_prompt | string | No | "" | Negative prompt |
| generate_image | width | number | No | 1024 | Width in pixels |
| generate_image | height | number | No | 1024 | Height in pixels |
| generate_image | workflow | string | No | "txt2img" | ComfyUI workflow name |
| generate_video | prompt | string | Yes | — | Video prompt |
| generate_video | negative_prompt | string | No | "" | Negative prompt |
| generate_video | width | number | No | 1024 | Width in pixels |
| generate_video | height | number | No | 768 | Height in pixels |
| generate_video | duration | number | No | 4 | Duration in seconds |
| generate_video | fps | number | No | 24 | Frames per second |

### Notes
- Requires ComfyUI running at http://127.0.0.1:8188
- Video generation requires Wan2.1 model and ComfyUI-VideoHelperSuite custom node
- Images use SDXL checkpoint by default