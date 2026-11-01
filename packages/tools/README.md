# Packages Tools

**This directory is a workspace package placeholder.** It is **not** the main tools directory.

## Where the tools are

The actual developer tools, MCP bridges, Go sidecars, checkers, and demos live at the repository root:

```
tools/              # Scripts, MCP bridges, Go sidecars, checkers, demos
scripts/            # PowerShell service management scripts
```

## What's here

`packages/tools/` exists as a pnpm workspace package (declared in the root `pnpm-workspace.yaml`) but contains no active source. Use it only if you are adding a new workspace-scoped tool package.

## Navigation

| Location | Purpose |
|----------|---------|
| `../tools/` | Repo-root tools: MCP bridges (`mcp/`), Go sidecars (`go-*`), music-gen, vision, blender, ollama, demos, checkers |
| `../tools/README.md` | Full tools directory reference |
| `../scripts/` | PowerShell service management: start/stop/status, port checks, Unity headless |
| `../scripts/README.md` | Script reference |

## Related

- `packages/README.md` — package-level layout (backend, frontend, shared)
- `../AGENTS.md` — project agent rules, shell rules
