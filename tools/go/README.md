# Go Utilities

> **Status:** Experimental — infrastructure-only, split-stack additions.
> **Go version:** 1.27.0+ required.

These are standalone Go binaries that complement the Python/FastAPI backend.
They are not imported as Go modules by Python; they communicate over HTTP/JSON.

## Binaries

| Binary | Purpose | Port |
|--------|---------|------|
| `bin/go-dashboard.exe` | SSE + health server for the dashboard | `:3847` |
| `bin/go-media.exe` | Typed FFmpeg wrapper (thumbnail / normalize / concat). Use `--server` to run HTTP server on `:3848`. | `:3848` (server) |
| `bin/go-worker.exe` | Queue I/O worker (jobs + sidecar writes) | `:3849` |
| `bin/go-gateway.exe` | MCP bridge router (Unity / Blender / ComfyUI / Ollama). Fixed response proxy (full body copy). | `:3850` |
| `bin/go-ports.exe` | Port availability checker (`/check/<port>`, `/scan?ports=...`) | `:3851` |

## Adding a New Go Module

1. Create a new directory under `tools/`, e.g. `tools/go-worker/`.
2. Add a `go.mod` with a unique module path.
3. Build: `go build -o ..\..\bin\<name>.exe .`
4. Register in `scripts/start-services.ps1` if it needs to run in the background.

## PATH

Go 1.27.0 is already on PATH system-wide. If not, prepend your Go install `bin` dir to `PATH` in the PowerShell profile.

## Related

- [[../docs/knowledge-library/go-integration-2026|go-integration-2026]]
- [[../docs/knowledge-library/stack-extensions-2026|stack-extensions-2026]]
