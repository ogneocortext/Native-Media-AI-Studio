---
name: context
description: Update the shared MCP context (character, scene, audio, visualization state) so other tools and servers can use it.
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

Update the shared MCP context so other tools and servers can read it.

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