---
name: context
description: Updates the shared MCP context with character, scene, audio, and visualization state. Use when cross-tool state needs to be persisted and read by other skills or servers.
version: "1.0.0"
server: ollama-tools
tools:
  - update_mcp_context
tags:
  - context
  - state
  - shared
example_inputs:
  - tool: update_mcp_context
    args: { context: { audio: { energy: 0.8, bpm: 128 } } }
example_outputs:
  - tool: update_mcp_context
    output: '{ "audio": { "energy": 0.8, "bpm": 128 }, "updatedAt": "2026-11-05T19:00:00Z" }'
---

# Context Skill

Updates the shared MCP context with character, scene, audio, and visualization state so other tools and servers can read it.

## When to Use This Skill

- Cross-tool state (character, scene, audio, visualization) needs to persist between calls
- Audio analysis results (energy, BPM) need to drive visualization parameters
- Scene state (location, time of day, weather) needs tracking across the pipeline
- Character state (name, outfit, mood, position) needs to be shared between skills

## Critical Rules

- Persisted to `output/mcp-context.json`
- Other skills and servers can read this context
- Context is cumulative: new values merge with existing ones
- Context updates do not grant tool access or permissions; they only store state

## Quick Start / Workflow

1. Call `update_mcp_context` with a partial context object
2. Keys supported: `character`, `scene`, `audio`, `visualization`
3. Other skills read the merged context from `output/mcp-context.json`

**Example:**
```
mcp__ollama-tools__update_mcp_context --context '{"audio":{"energy":0.8,"bpm":128}}'
```

## Reference Navigation

- See [references/GUIDE.md](references/GUIDE.md) for detailed examples and parameter reference

## Anti-patterns

- Do not store secrets or private data in context; it is stored in plain JSON
- Do not expect context to enforce permissions; it is informational only
- Do not store large payloads; context is meant for lightweight state

## Tools

### update_mcp_context

Update the shared MCP context (character, scene, audio, visualization state).

**Parameters:**
- `context` (object, required): Partial context to merge. Keys: character?, scene?, audio?, visualization?

**Example:**
```
mcp__ollama-tools__update_mcp_context --context '{"audio":{"energy":0.8,"bpm":128}}'
```

**Returns:** The merged context object with an `updatedAt` timestamp.

## Notes
- Persisted to `output/mcp-context.json`
- Other skills and servers can read this context

## Cross-Skill References

- **vision**: Store scene/visualization state from image analysis — see `vision` skill
- **audio**: Store audio state (energy, BPM) for other tools — see `audio` skill
- **comfyui**: Store generation parameters for reproducibility — see `comfyui` skill
- **blender**: Store 3D scene state and asset references — see `blender` skill
- **remix**: Store remix state and job references — see `remix` skill