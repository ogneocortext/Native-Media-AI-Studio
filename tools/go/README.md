# Go Utilities

> **Status:** Experimental - infrastructure-only, split-stack additions.
> **Go version:** 1.27.0+ required.

These are standalone Go binaries that complement the Python/FastAPI backend.
They are not imported as Go modules by Python; they communicate over HTTP/JSON.

## Binaries

**`go-studio` (canonical, D70)** — one binary in `tools/go-studio/` hosting
all five listeners below on their original ports. `manage-servers.ps1` /
`start-services.ps1` launch `bin/go-studio.exe`. The per-service sources in
`tools/go-*/` are kept as reference; their contracts live on inside
go-studio (same ports, routes, health payloads, env vars).

| Listener (port) | Legacy binary | Purpose | Who actually uses it |
|-----------------|---------------|---------|----------------------|
| dashboard `:3847` | `go-dashboard` | SSE fan-out mirror — backend POSTs every SSE message to `/publish`, service republishes on `/events` | **Write-only mirror.** The frontend reads the backend's canonical `/api/events` (`sseService.ts` deliberately ignores this). Only useful for external subscribers; safe to omit. |
| media `:3848` | `go-media` | FFmpeg job runner — `POST /process` (thumbnail / normalize / concat / extract_audio) with job tracking + SSE progress | **Effectively unused.** `services/go_media_client.py` exists but has zero callers — FFmpeg work runs in-process via `ffmpeg_tools.py`. Reserved capacity. |
| worker `:3849` | `go-worker` | Job registry + JSON sidecar writer for `output/` | **Live, narrow.** `write_sidecar` is called by `comfyui_workflow_handler`, `export_matrix`, `image_generator`, `storyboard_generator`. The `/jobs` registry has no backend callers. |
| gateway `:3850` | `go-gateway` | Pass-through proxy + health aggregation for MCP bridges (Unity/Blender/ComfyUI/Ollama) | **Live, narrow.** Only the `unity` bridge is proxied today (`unity_control.py`, `native_open.py`, which forward the Pipeline auth header). Other bridge entries are configured capacity. |
| ports `:3851` | `go-ports` | TCP port-in-use checker (`/check/<port>`, `/scan?ports=`) | **Live, optional.** `core/port_manager` uses it as a fast path and falls back to its own socket probe when down — an accelerator, not a dependency. |

Every service exposes `GET /api/health` or `/health` plus `GET /version`,
which is what `GoServicesCard` on `/system/health` polls. Each `main.go`
opens with a package doc comment covering purpose, consumers, endpoints,
and env vars — read that first.

## Adding a Listener to go-studio

1. Add a `<role>.go` file in `tools/go-studio/` with a `<role>Mux()` returning a `*http.ServeMux`.
2. Register it in `listeners()` in `main.go` with its port env var and optional heartbeat.
3. Build: `go build -o ..\..\bin\go-studio.exe .` from `tools/go-studio/`.
4. Keep the port contract additive — do not change existing routes; callers depend on them.

## PATH

Go 1.27.0+ is already on PATH system-wide. If not, prepend your Go install `bin` dir to `PATH` in the PowerShell profile.

## Related

- [[../docs/knowledge-library/go-integration-2026|go-integration-2026]]
- [[../docs/knowledge-library/stack-extensions-2026|stack-extensions-2026]]
