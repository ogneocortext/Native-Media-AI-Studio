---
tags:
  - mcp
  - contracts
  - agents
  - orchestration
  - knowledge-gap
aliases:
  - MCP Tool Contracts
  - MCP Contract Standard
  - Agent Tool Contracts
cssclasses:
  - mcp
  - contracts
date: 2026-09-24
---

# 🤝 MCP Tool Contracts 2026

> [!info] Purpose
> Formal input/output contracts for every MCP tool exposed by the
> Native Media AI Studio agent stack. These schemas let agents validate
> arguments before calling a tool, and parse responses deterministically
> instead of guessing at field names.
>
> This document addresses the research gap
> **🔴 Agent MCP tool contracts** from
> [[app-research-gaps-2026#13-agent-orchestration|App Research Gaps 2026]].

> [!tip] How to Use
> - Each tool lists `input`, `output`, `errors`, and `example`.
> - Schemas are expressed as JSON Schema (Draft 2020-12) so they can be
>   consumed by code validators or agent pre-call guards.
> - External servers (Blender MCP, Remotion MCP, ComfyUI MCP) are
>   documented as **upstream maintained**; their contracts are pinned to
>   the installed version.

---

## 1. Contract Standard

Every tool in this document follows this shape:

| Section | What it documents |
|---------|------------------|
| `name` | Exact tool name used in `tools/call`. |
| `description` | Human-readable intent. Agents SHOULD re-read this before calling. |
| `input` | JSON Schema for `arguments`. `required` fields MUST be supplied. |
| `output` | JSON Schema for the successful return value. |
| `errors` | Known failure modes and their response shape. |
| `example` | Minimal valid call + response. |

### 1.1 MCP Response Envelope

All in-repo MCP servers return text results inside the standard MCP
`content` array:

```jsonc
{
  "content": [
    { "type": "text", "text": "<stringified JSON or plain text>" }
  ],
  "isError": false // present on some servers; not required by spec
}
```

Unless a tool explicitly documents a structured JSON response, assume the
`text` field is **parseable JSON** for machine consumers and **human
readable** for interactive use.

### 1.2 Timeouts & Retries

| Server | Default timeout | Notes |
|--------|----------------|-------|
| Unity MCP Bridge | 30s per HTTP call | `unityFetch` uses `AbortController` |
| Ollama Tools MCP | 30s fetch, 180s for Ollama chat | Retries 2× with 5s backoff on Ollama chat |
| Vision MCP | 300s for Node child process | Primary analyzer + Python fallback |
| HyperFrames MCP | 600s render, 120s init/preview | Long-running renders spawn `detached: true` for preview |

### 1.3 Rate Limits

There are no explicit rate limits. Agents SHOULD serialize calls to the
same MCP server when the tool is not idempotent (e.g. `generate_image`,
`capture_scene_view`).

---

## 2. Unity MCP Bridge

**Server**: `tools/mcp/unity-mcp-bridge.mjs`  
**Transport**: stdio  
**Version**: 1.1.0  
**Dependency**: Unity Editor + `unity-project-mcp` pipeline server

### 2.1 `unity_command`

Execute any Unity Editor command. Prefer specific tools when available.

- **input**:

```jsonc
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "Unity command name (e.g. create_gameobject, add_component, capture_scene_view)"
    },
    "parameters": {
      "type": "object",
      "description": "Command parameters as key-value pairs"
    }
  },
  "required": ["command"]
}
```

- **output**: `{ "<command_result>": ... }` or `{ "error": "..." }`
- **errors**: `Unity MCP server not running (no port file)`, `Unity API error: <status>`, timeout after 30s.
- **example**:

```json
{
  "command": "create_gameobject",
  "parameters": { "name": "RedCube", "primitive": "cube" }
}
```

### 2.2 `create_gameobject`

```jsonc
// input
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "primitive": {
      "type": "string",
      "enum": ["cube", "sphere", "capsule", "cylinder", "plane", "quad"]
    }
  }
}

// output
{
  "name": "RedCube",
  "primitive": "cube",
  "instanceId": 12345
}
```

### 2.3 `add_component`

```jsonc
// input
{
  "type": "object",
  "properties": {
    "target": { "type": "string", "description": "GameObject name" },
    "type": { "type": "string", "description": "Component class name" }
  },
  "required": ["target", "type"]
}

// output
{ "ok": true, "component": "MeshRenderer" }
```

### 2.4 `capture_scene_view`

```jsonc
// input
{
  "type": "object",
  "properties": {
    "save_path": { "type": "string" },
    "width": { "type": "number" },
    "height": { "type": "number" }
  },
  "required": ["save_path"]
}

// output
{ "path": "Assets/Textures/frame.png", "width": 1280, "height": 720 }
```

### 2.5 `editor_status`

```jsonc
// input: {}

// output
{ "status": "compiling|playing|idle|paused" }
```

### 2.6 `create_scene`

```jsonc
// input
{ "path": "Assets/Scenes/MyScene.unity" }

// output
{ "created": true, "path": "Assets/Scenes/MyScene.unity" }
```

### 2.7 `create_animation_clip`

```jsonc
// input
{
  "path": "Assets/Animations/beat.anim",
  "frameRate": { "type": "number", "default": 24 },
  "loop": { "type": "boolean", "default": false }
}

// output
{ "created": true, "path": "Assets/Animations/beat.anim", "frameRate": 24 }
```

### 2.8 `get_beat_data`

```jsonc
// input: {}

// output
{
  "tempo": 120,
  "beat_times": [0.5, 1.0, ...],
  "keyframes": [{"frame": 0, "time": 0}, ...]
}
```

- **errors**: `beat_data.json not found. Run: python tools/analyze_and_sync.py <audio_file>`

### 2.9 `create_beat_animation`

```jsonc
// input
{
  "object_name": "Speaker",
  "clip_path": "Assets/Animations/beat.anim",
  "pulse_scale": { "type": "number", "default": 1.5 },
  "frame_rate": { "type": "number", "default": 24 },
  "max_beats": { "type": "number" }
}

// output
{
  "instructions": "...",
  "tempo": 120,
  "keyframe_count": 48,
  "keyframes": [...]
}
```

### 2.10 `capture_frame_sequence`

```jsonc
// input
{
  "fps": { "type": "number", "default": 24 },
  "duration_seconds": { "type": "number", "default": 10 },
  "output_dir": { "type": "string" },
  "width": { "type": "number", "default": 1280 },
  "height": { "type": "number", "default": 720 }
}

// output
{
  "total_frames": 240,
  "fps": 24,
  "duration_seconds": 10,
  "output_dir": "Assets/Textures/auto_frame",
  "resolution": { "width": 1280, "height": 720 },
  "note": "Add AutoCapture.cs to a GameObject..."
}
```

### 2.11 `set_object_visibility`

```jsonc
// input
{
  "object_name": "Trex",
  "visible": true
}

// output
{ "ok": true, "object_name": "Trex", "visible": true }
```

### 2.12 `list_animations`

```jsonc
// input
{ "object_name": "Speaker" }

// output
{ "animations": [{"name": "beat_anim", "length": 10}, ...] }
```

### 2.13 `play_animation`

```jsonc
// input
{
  "object_name": "Speaker",
  "clip_name": "beat_anim",
  "speed": { "type": "number", "default": 1 },
  "wrap_mode": { "type": "string", "default": "once", "enum": ["once","loop","pingpong","clamp"] },
  "fade_time": { "type": "number" }
}
```

### 2.14 `stop_animation`

```jsonc
// input
{
  "object_name": "Speaker",
  "return_to_bind_pose": { "type": "boolean", "default": true }
}
```

### 2.15 `blend_animation`

```jsonc
// input
{
  "object_name": "Speaker",
  "from_clip": "idle",
  "to_clip": "beat_anim",
  "fade_time": { "type": "number", "default": 0.5 }
}
```

### 2.16 `list_pipeline_commands`

```jsonc
// input: {}

// output
["create_gameobject", "add_component", ...] // 100+ strings
```

### 2.17 `plan_unity_scene`

```jsonc
// input
{
  "description": "a neon-lit cyberpunk alley with a pulsing hologram",
  "target": { "type": "string", "enum": ["character", "environment", "lighting", "animation"] },
  "model": { "type": "string", "default": "llama3.2:3b" }
}

// output
{
  "summary": "Neon-lit cyberpunk alley scene",
  "commands": [
    { "command": "create_gameobject", "parameters": { "name": "Alley", "primitive": "cube" } }
  ],
  "notes": [],
  "unknown_commands": []
}
```

- **errors**: `Ollama did not return parseable JSON for Unity scene plan.`

---

## 3. Ollama Tools MCP

**Server**: `tools/mcp/ollama-tools-mcp.mjs`  
**Transport**: stdio  
**Version**: 1.0.0  
**Dependencies**: Ollama, ComfyUI, backend FastAPI

### 3.1 `analyze_image`

```jsonc
// input
{
  "type": "object",
  "properties": {
    "image_path": {
      "type": "string",
      "description": "Path or URL to the image"
    },
    "prompt": {
      "type": "string",
      "description": "Question to ask about the image",
      "default": "Describe this image in detail."
    },
    "model": {
      "type": "string",
      "description": "Ollama vision model (qwen3-vl:2b=fast, gemma4=e2b-it-qat=detailed)",
      "default": "qwen3-vl:4b"
    },
    "think": {
      "type": "boolean",
      "description": "Enable extended reasoning (Ollama 0.21.3+)",
      "default": false
    }
  },
  "required": ["image_path"]
}

// output
{ "response": "...", "model": "...", "created_at": "..." }
```

- **errors**: `Image not found: <path>`, `Image too large for Ollama: <size> MB (cap 20 MB)`, Ollama unreachable.

### 3.2 `analyze_audio`

```jsonc
// input
{ "filename": { "type": "string", "description": "Audio filename from the library" } }

// output
{
  "tempo_bpm": 120,
  "duration_seconds": 214,
  "beat_times": [0.5, 1.0, ...],
  "sections": [{"type": "intro", "start": 0, "end": 15, "energy": 0.2}, ...],
  "energy_curve": [0.2, 0.3, ...]
}
```

- **errors**: `Missing required arg: filename`, backend 404 if file missing.

### 3.3 `generate_image`

```jsonc
// input
{
  "prompt": { "type": "string" },
  "negative_prompt": { "type": "string", "default": "text, watermark, low quality, blurry" },
  "width": { "type": "number", "default": 1024 },
  "height": { "type": "number", "default": 1024 },
  "workflow": { "type": "string", "default": "txt2img" },
  "checkpoint": { "type": "string", "default": "sd_xl_base_1.0.safetensors" }
}

// output
"✅ Image generation queued: <prompt_id>\nPrompt: \"...\"\nSize: 1024x1024"
```

- **errors**: `⚠️ ComfyUI response: ...`, `❌ ComfyUI not available: ...`

### 3.4 `generate_video`

```jsonc
// input
{
  "prompt": { "type": "string" },
  "duration": { "type": "number", "default": 4 },
  "fps": { "type": "number", "default": 24 }
}

// output
"🎬 Video generation for \"<prompt>\" (<duration>s)\n\nTo generate videos locally..."
```

- **errors**: `❌ Error: <message>`
- **note**: This is a stub; direct video generation is delegated to ComfyUI MCP.

### 3.5 `list_audio_library`

```jsonc
// input: {}

// output
"Available tracks:\ntrack1.mp3\ntrack2.wav"
```

### 3.6 `create_music_video_plan`

```jsonc
// input
{
  "filename": { "type": "string" },
  "style": { "type": "string" }
}

// output
{
  "track": "song.mp3",
  "bpm": 120,
  "duration": 214,
  "energy": [0.2, 0.3, ...],
  "recommended_style": "high-energy",
  "scenes": [{"start": 0, "end": 15, "type": "intro", "energy": 0.2}, ...]
}
```

- **errors**: `Missing required arg: filename`

### 3.7 `suggest_3d_prompt`

```jsonc
// input
{
  "idea": { "type": "string" },
  "category": {
    "type": "string",
    "enum": ["character", "clothing", "skin_material", "environment"],
    "default": "character"
  },
  "style": { "type": "string" }
}

// output
{
  "category": "character",
  "positive": "a stylized 3D character concept, <idea>, ...",
  "negative": "text, watermark, low quality, ...",
  "context_used": true,
  "note": "Use this prompt to generate a concept image for 3D conversion."
}
```

### 3.8 `generate_3d_concept`

```jsonc
// input
{
  "description": { "type": "string" },
  "category": { "type": "string", "default": "3d-character" },
  "width": { "type": "number", "default": 1024 },
  "height": { "type": "number", "default": 1024 }
}

// output
"✅ Image generation queued: <prompt_id>\nPrompt: \"...\"\nSize: <width>x<height>"
```

- **errors**: Same as `generate_image`.

### 3.9 `plan_blender_script`

```jsonc
// input
{
  "description": { "type": "string" },
  "target": {
    "type": "string",
    "enum": ["mesh", "material", "rig", "scene", "lighting", "cleanup", "uv"],
    "default": "mesh"
  },
  "model": { "type": "string", "default": "qwen3.5:9b" }
}

// output
{
  "target": "mesh",
  "description": "...",
  "script": "import bpy\\n...",
  "instructions": "1. Open Blender...",
  "required_assets": [],
  "note": "Execute this script with blender_execute_blender_code..."
}
```

- **errors**: `Missing required arg: description`, `Ollama did not return parseable JSON for blender script.`, `Generated script does not appear to use bpy.`

### 3.10 `update_mcp_context`

```jsonc
// input
{
  "context": {
    "type": "object",
    "description": "Partial context to merge: { character?, scene?, audio?, visualization? }"
  }
}

// output
{ "ok": true, "context": { "updatedAt": 1234567890, ... } }
```

- **errors**: `Missing required arg: context (partial context object)`

---

## 4. Vision MCP

**Server**: `tools/mcp/vision-mcp.mjs`  
**Transport**: stdio  
**Version**: 2.0.0  
**Dependencies**: Ollama, Playwright (for screenshots), `tools/vision/analyze.mjs`

### 4.1 `vision_describe`

```jsonc
// input
{
  "type": "object",
  "properties": {
    "image_path": {
      "type": "string",
      "description": "Absolute or repo-relative path to image (png/jpg/webp)"
    },
    "prompt": { "type": "string" },
    "mode": {
      "type": "string",
      "enum": ["ui", "responsive", "regression", "compare", "music-video", "consistency", "ocr", "table", "chart", "multicomp"],
      "default": "ui"
    }
  },
  "required": ["image_path"]
}

// output
"<free-form analysis text from VLM>"
```

- **errors**: `Image not found: <path>`, `Unsupported image format: <ext>. Allowed: png, jpg, jpeg, webp, bmp, gif`, `Ollama is not reachable...`, `All vision backends failed...`

### 4.2 `vision_compare`

```jsonc
// input
{
  "image_a": { "type": "string" },
  "image_b": { "type": "string" },
  "prompt": { "type": "string" }
}

// output
"<free-form diff text from VLM>"
```

### 4.3 `vision_ui_audit`

```jsonc
// input
{
  "image_path": { "type": "string" },
  "viewport": { "type": "string", "example": "1280x800" },
  "label": { "type": "string", "example": "Generation3DPage" }
}

// output
{
  "label": "Generation3DPage",
  "viewport": "1280x800",
  "elements": [...],
  "visible_text": [...],
  "layout_issues": [...],
  "errors": [...]
}
```

### 4.4 `vision_ocr`

```jsonc
// input
{
  "image_path": { "type": "string" },
  "prompt": { "type": "string" }
}

// output
{ "image": "screenshot.png", "mode": "ocr", "transcription": "<text with [unclear] markers>" }
```

### 4.5 `vision_batch_analyze`

```jsonc
// input
{
  "image_paths": { "type": "array", "items": { "type": "string" } },
  "prompt": { "type": "string" },
  "mode": {
    "type": "string",
    "enum": ["ui", "responsive", "regression", "compare", "music-video", "consistency", "ocr", "table", "chart"],
    "default": "ui"
  }
}

// output
{ "count": 2, "results": [{"image": "a.png", "mode": "ui", "analysis": "..."}, {"image": "b.png", "error": "..."}] }
```

### 4.6 `read_source`

```jsonc
// input
{ "path": { "type": "string", "description": "Repo-relative path" } }

// output
{
  "path": "packages/frontend/src/features/generate3d/Generation3DPage.tsx",
  "absolute": "<full path>",
  "lines": 300,
  "preview": "<first 200 lines>"
}
```

### 4.7 `search_files`

```jsonc
// input
{
  "pattern": { "type": "string", "description": "Regex pattern to match filenames" },
  "path": { "type": "string", "description": "Directory to search from (default: project root)" }
}

// output
{ "pattern": ".*Generation3D.*\\.tsx$", "directory": "packages/frontend", "matches": ["src/features/..."] }
```

### 4.8 `get_file_info`

```jsonc
// input
{ "path": { "type": "string", "description": "Repo-relative path" } }

// output
{
  "path": "output/screenshot.png",
  "absolute": "<full path>",
  "size": 102400,
  "isDirectory": false,
  "modified": "2026-09-24T18:00:00.000Z"
}
```

### 4.9 `take_screenshot`

```jsonc
// input
{
  "url": { "type": "string", "description": "URL to capture (default: frontend dev server)" },
  "full_page": { "type": "boolean", "default": false }
}

// output
{ "screenshot": "output/vision-screenshot.png", "url": "http://127.0.0.1:5173" }
```

- **errors**: `playwright not available. Install it: pnpm add -D playwright`

### 4.10 `list_outputs`

```jsonc
// input
{ "limit": { "type": "number", "default": 20 } }

// output
{ "directory": "output", "files": ["screenshot.png", "video.mp4", ...] }
```

---

## 5. HyperFrames MCP

**Server**: `tools/mcp/hyperframes-mcp.mjs`  
**Transport**: stdio  
**Version**: 2.0.0 (bridge)  
**Dependencies**: `npx hyperframes`, `tools/hyperframes-test/` project

### 5.1 `hyperframes_init`

```jsonc
// input
{
  "name": { "type": "string", "description": "Project subdirectory under tools/hyperframes-test/" },
  "example": {
    "type": "string",
    "enum": ["blank", "warm-grain", "kinetic-type", "product-promo", "nyt-graph", "vignelli", "play-mode", "swiss-grid", "decision-tree"],
    "description": "Starter template name"
  }
}

// output
"Initialized HyperFrames project at: <path>\n\n<stdout>\n\n<stderr>"
```

### 5.2 `hyperframes_preview`

```jsonc
// input
{ "port": { "type": "number", "description": "Port for preview server (default: let HyperFrames choose)" } }

// output
"Preview server starting (PID <pid>).\nOpen: http://127.0.0.1:<port>\n..."
```

### 5.3 `hyperframes_render`

```jsonc
// input
{
  "output": { "type": "string", "description": "Output file path, relative to tools/hyperframes-test/ or absolute" },
  "format": { "type": "string", "enum": ["mp4", "mov", "webm", "gif", "png-sequence"], "default": "mp4" },
  "fps": { "type": "number", "description": "1-240 or rational like 30000/1001", "default": 30 },
  "quality": { "type": "string", "enum": ["draft", "standard", "high"], "default": "standard" },
  "workers": { "type": "string", "description": "1-24 or 'auto'", "default": "auto" },
  "gpu": { "type": "boolean", "default": false },
  "composition": { "type": "string", "description": "Path to composition HTML file" }
}

// output
"Render complete.\n\n<stdout>\n\n<stderr>"
```

### 5.4 `hyperframes_lint`

```jsonc
// input
{ "composition": { "type": "string", "description": "Path to composition HTML file" } }

// output
"Lint result:\n\n<stdout>\n\n<stderr>"
```

### 5.5 `hyperframes_list_examples`

```jsonc
// input: {}

// output
"Available templates:\n\n<stdout>\n\n<stderr>"
```

### 5.6 `hyperframes_read_composition`

```jsonc
// input
{ "path": { "type": "string", "description": "Relative path to composition HTML", "default": "index.html" } }

// output
"File: <path>\nLines: <n>\n\n<first 400 lines>"
```

### 5.7 `hyperframes_write_composition`

```jsonc
// input
{
  "path": { "type": "string", "description": "Relative path to composition HTML", "default": "index.html" },
  "content": { "type": "string", "description": "Full HTML content to write" }
}

// output
"Wrote composition to: <path>"
```

### 5.8 `hyperframes_read_assets`

```jsonc
// input
{ "subfolder": { "type": "string", "description": "Subfolder under assets/ to scan" } }

// output
"Assets in <path>:\n<file list>"
```

### 5.9 `hyperframes_status`

```jsonc
// input: {}

// output
"HyperFrames test project: <path>\nExists: <bool>\nVersion: <version>"
```

---

## 6. External MCP Servers (Upstream Maintained)

These servers are referenced in [[app-research-gaps-2026#13-agent-orchestration|agent orchestration]]
and `AGENTS.md`, but are **not** implemented in this repo.

| Server | Install | Contract Source |
|--------|---------|-----------------|
| **Blender MCP** | `uvx blender-mcp` | `bpy` RNA docs + `get_addon_status()` runtime check |
| **ComfyUI MCP** | `npx comfyui-mcp` | ComfyUI workflow JSON schema + custom node docs |
| **Remotion MCP** | `npx -y @remotion/mcp@latest` | Remotion CLI + `@remotion/*` package schemas |

### 6.1 Blender MCP (upstream)

Key tools used by agents:

| Tool | Description |
|------|-------------|
| `get_scene_info` | Scene overview |
| `get_addon_status` | Version + telemetry state |
| `blender_execute_blender_code` | Runs arbitrary Python in Blender |
| `blender_*` asset tools | Poly Haven, Sketchfab, Poly Pizza, Hyper3D Rodin, Hunyuan3D |

**Contract notes**:
- Node names are localized; always look up by `node.type` (e.g. `BSDF_PRINCIPLED`), never by display name.
- Enum identifiers change between Blender versions; query `bl_rna.properties[...].enum_items` before hardcoding.
- `scene.render.engine` is a dynamic enum; read current value before switching.

### 6.2 ComfyUI MCP (upstream)

Direct workflow control via ComfyUI `/api/prompt` and `/api/history`.
Contracts are the ComfyUI workflow JSON format plus custom node schemas.

### 6.3 Remotion MCP (upstream)

Exposes Remotion CLI operations (render, preview, still).
Contracts are the Remotion CLI flags + `@remotion/*` package APIs.

---

## 7. Validation Strategy

### 7.1 Pre-call Validation

Agents SHOULD validate arguments against the `input` schema before
calling `tools/call`. For Zod-based servers (Unity), invalid inputs are
rejected at the server. For JSON Schema servers (Ollama, Vision,
HyperFrames), invalid inputs may be silently coerced or rejected with a
generic error.

A lightweight validator is available in the backend:

```python
from app.services.mcp_validator import validate_tool_call, ValidationError

try:
    args = validate_tool_call("create_gameobject", {"name": "Cube"})
except ValidationError as exc:
    logger.error("Bad tool args: %s", exc)
```

The registry in `app/services/mcp_validator.py` covers all in-repo tools
documented in this file. Unknown tools are logged and passed through
unchanged so upstream servers (Blender MCP, Remotion MCP) still work.

### 7.2 Response Parsing

1. Check `isError` flag if present.
2. Parse `content[0].text` as JSON when the tool documents a structured
   output.
3. Fall back to plain text when JSON parse fails.

### 7.3 Error Handling Rules

| Error pattern | Agent action |
|---------------|--------------|
| `not running` / `no port file` | Start the service; do not retry. |
| `timeout` | Retry once with same args; if repeated, surface to user. |
| `Unknown tool` | Do not retry; this is a code/config bug. |
| `Image not found` / `File not found` | Check path resolution; retry with corrected path. |

---

## 8. Maintenance

> [!warning] Keep Updated
> Update this document when:
>
> - A new MCP tool is added or removed from `tools/mcp/*.mjs`.
> - An upstream server (Blender MCP, Remotion MCP, ComfyUI MCP) is upgraded.
> - A tool's input or output shape changes.

---

## See Also

- [[app-research-gaps-2026#13-agent-orchestration|App Research Gaps 2026 — Agent Orchestration]]
- [[ollama-prompting-2026|Ollama Prompting 2026]] — Vision grounding + structured outputs
- [[kilo-code-subagent-orchestration|Kilo Code Subagent Orchestration]]
- [[unity-integration-2026|Unity MCP Integration]]
- [[technical-reference|Technical Reference]] — System architecture

---

*Last updated: 2026-09-24*
