# MCP Server Bridges

This directory contains the project's local MCP server implementations.

## Servers

| Server | File | Transport | Description |
|--------|------|-----------|-------------|
| Unity MCP | `unity-mcp-bridge.mjs` | stdio (Node.js) | Wraps Unity Pipeline REST API for Kilo Code integration |
| Vision MCP | `vision-mcp.mjs` | stdio (Node.js) | Ollama VLM vision analysis (gemma4:e2b-it-qat / qwen3.5:4b) |
| Ollama Tools MCP | `ollama-tools-mcp.mjs` | stdio (Node.js) | Ollama tool-use integration |
| HyperFrames MCP | `hyperframes-mcp.mjs` | stdio (Node.js) | HyperFrames composition and rendering |

## Configuration

All MCP servers are registered in `opencode.json` at the repo root.

## Dependencies

```bash
cd tools
npm install @modelcontextprotocol/server zod
```

## Notes

- `context-store.mjs` is **not** an MCP server — it is a library (`context-store.mjs` exports four functions with no transport). It is deliberately absent from every MCP client config (see AGENTS.md "MCP clients: which config holds the servers").
- These servers run on **@modelcontextprotocol/server v2.0.0** (ESM-first).
- The Unity bridge auto-reads the bearer token from `Library/Pipeline/.unity-pipeline-port` — no manual token management needed.
