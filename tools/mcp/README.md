# MCP Server Bridges

This directory contains the project's local MCP server implementations.

## Servers

| Server | File | Transport | Description |
|--------|------|-----------|-------------|
| Unity MCP | `unity-mcp-bridge.mjs` | stdio (Node.js) | Wraps Unity Pipeline REST API for Kilo Code integration |
| Vision MCP | `vision-mcp.mjs` | stdio (Node.js) | Ollama VLM vision analysis (gemma4:e2b-it-qat / qwen3.5:4b) |
| Ollama Tools MCP | `ollama-tools-mcp.mjs` | stdio (Node.js) | Ollama tool-use integration |
| Blender MCP bridge | `blender-mcp-bridge.mjs` | stdio (Node.js) | Connects the Blender MCP addon to the local bridge |
| HyperFrames MCP | `hyperframes-mcp.mjs` | stdio (Node.js) | HyperFrames composition and rendering |

## Configuration

OpenCode project entries are maintained in `../../opencode.json`; other clients
use their own configuration files (see `../../AGENTS.md`).

## Dependencies

```powershell
pnpm.cmd install
```

Run the workspace install from the repository root; `../package.json`
declares the MCP SDK and schema dependencies.

## Notes

- `context-store.mjs` is **not** an MCP server — it is a library (`context-store.mjs` exports four functions with no transport). It is deliberately absent from every MCP client config (see `../../AGENTS.md`, “MCP clients: which config holds the servers”).
- These servers use MCP SDK v2; the workspace dependency is declared in
  `../package.json`.
- The Unity bridge auto-reads the bearer token from `Library/Pipeline/.unity-pipeline-port` — no manual token management needed.
