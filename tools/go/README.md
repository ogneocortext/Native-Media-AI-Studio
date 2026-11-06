# Go Utilities

> **Status:** Experimental - infrastructure-only, split-stack additions.
> **Go version:** 1.27.0+ required.

These are standalone Go binaries that complement the Python/FastAPI backend.
They are not imported as Go modules by Python; they communicate over HTTP/JSON.

## Binaries

| Binary | Port | Purpose | Who actually uses it |
|--------|------|---------|----------------------|
| `go-dashboard` | `:3847` | SSE fan-out mirror — backend POSTs every SSE message to `/publish`, service republishes on `/events` | **Write-only mirror.** The frontend reads the backend's canonical `/api/events` (`sseService.ts` deliberately ignores this). Only useful for external subscribers; safe to omit. |
| `go-media` | `:3848` | FFmpeg job runner — `--server` mode exposes `POST /process` (thumbnail / normalize / concat / extract_audio) with job tracking + SSE progress; also usable as a CLI | **Effectively unused.** `services/go_media_client.py` exists but has zero callers — FFmpeg work runs in-process via `ffmpeg_tools.py`. Server endpoints are reserved capacity; the CLI works today. |
| `go-worker` | `:3849` | Job registry + JSON sidecar writer for `output/` | **Live, narrow.** `write_sidecar` is called by `comfyui_workflow_handler`, `export_matrix`, `image_generator`, `storyboard_generator`. The `/jobs` registry has no backend callers. |
| `go-gateway` | `:3850` | Pass-through proxy + health aggregation for MCP bridges (Unity/Blender/ComfyUI/Ollama) | **Live, narrow.** Only the `unity` bridge is proxied today (`unity_control.py`, `native_open.py`, which forward the Pipeline auth header). Other bridge entries are configured capacity. |
| `go-ports` | `:3851` | TCP port-in-use checker (`/check/<port>`, `/scan?ports=`) | **Live, optional.** `core/port_manager` uses it as a fast path and falls back to its own socket probe when down — an accelerator, not a dependency. |

Every service exposes `GET /api/health` or `/health` plus `GET /version`,
which is what `GoServicesCard` on `/system/health` polls. Each `main.go`
opens with a package doc comment covering purpose, consumers, endpoints,
and env vars — read that first.

## Adding a New Go Module

1. Create a new directory under `tools/`, e.g. `tools/go-worker/`.
2. Add a `go.mod` with a unique module path.
3. Build: `go build -o ..\..\bin\<name>.exe .`
4. Register in `scripts/start-services.ps1` if it needs to run in the background.

## PATH

Go 1.27.0+ is already on PATH system-wide. If not, prepend your Go install `bin` dir to `PATH` in the PowerShell profile.

## Related

- [[../docs/knowledge-library/go-integration-2026|go-integration-2026]]
- [[../docs/knowledge-library/stack-extensions-2026|stack-extensions-2026]]
