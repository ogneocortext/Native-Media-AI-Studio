# Context Skill Guide

## update_mcp_context

### Basic usage
```
mcp__ollama-tools__update_mcp_context --context '{"audio":{"energy":0.8,"bpm":128}}'
```

### With scene context
```
mcp__ollama-tools__update_mcp_context --context '{"scene":{"location":"neon_city","time":"night"}}'
```

### With character context
```
mcp__ollama-tools__update_mcp_context --context '{"character":{"name":"kira","outfit":"cyberpunk_jacket"}}'
```

### Returns
The merged context object with an `updatedAt` timestamp.

### Common patterns
- **Audio-driven visuals**: Update audio context (energy, BPM) to drive visualization parameters
- **Scene state**: Track current scene location, time of day, weather
- **Character state**: Track character name, outfit, mood, position
- **Cross-tool coordination**: Context set by one tool can be read by others

### Parameters reference
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| context | object | Yes | — | Partial context to merge. Keys: character?, scene?, audio?, visualization? |

### Returns
The merged context object with an `updatedAt` timestamp.

### Notes
- Persisted to `output/mcp-context.json`
- Other skills and servers can read this context
- Context is cumulative: new values merge with existing ones

## Cross-Skill References

- **vision**: Store scene/visualization state from image analysis — see `vision` skill
- **audio**: Store audio state (energy, BPM) for other tools — see `audio` skill
- **comfyui**: Store generation parameters for reproducibility — see `comfyui` skill
- **blender**: Store 3D scene state and asset references — see `blender` skill
- **remix**: Store remix state and job references — see `remix` skill