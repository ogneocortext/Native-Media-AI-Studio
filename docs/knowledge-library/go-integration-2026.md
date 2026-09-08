# Go Integration in Native Media AI Studio (2026)

> **Scope:** Where Go adds measurable value to the studio stack, with concrete integration points and code examples.
> **Current stack:** TypeScript/JS (frontend, Remotion, MCP bridges), Python (FastAPI, Blender MCP, ComfyUI, audio analysis), C# (Unity), GLSL/HLSL.
> **Last updated:** 2026-09-08
> **Go version:** 1.27.0 (windows/amd64) — already on PATH.

---

## 1. Why Go for This Project

The 2026 production-AI pattern is a **split stack**:

- **Python** stays the model layer: training, inference, PyTorch, librosa, ComfyUI, Ollama.
- **Go** takes the infrastructure layer: gateways, SSE/WebSocket fanout, media pipelines, job workers, CLI tooling.

| Concern | Python today | Go opportunity |
|---------|--------------|----------------|
| Dashboard SSE server | Python + PS1 scripts | Single binary, lower memory, faster startup |
| Concurrent event streaming | `sse-starlette` + asyncio | Goroutines handle 500+ concurrent streams cheaply |
| Media post-processing | FFmpeg shell-outs | Typed in-process pipelines via `ffgo` / MovieGo |
| Port/health management | Python watchers | Tiny Go binaries, cross-compile to any platform |
| MCP bridge routing | Node.js + Express | Lower per-connection memory, predictable latency |

**Do NOT rewrite** the FastAPI backend, ComfyUI integration, or audio analysis in Go. The Python AI ecosystem (PyTorch, librosa, transformers) is not replaceable.

---

## 2. Integration Points (Ranked by Impact)

### 2.1 Dashboard / Utility Server — HIGH IMPACT, LOW RISK

**Replace** `scripts/utility/update_dashboard_server.ps1` + any Python SSE helpers with a single Go binary.

Benefits:
- Single static executable, no venv, no dependency resolution at deploy time.
- Goroutines make concurrent SSE connections trivial.
- Startup in milliseconds, memory footprint ~10–20 MB vs Python's 100–200 MB.

Suggested location: `tools/go-dashboard/`

Tech: `net/http` stdlib + `github.com/inoth/go-sse` or hand-rolled SSE.

---

### 2.2 Media Post-Processing Worker — MEDIUM IMPACT

**Replace** ad-hoc FFmpeg shell commands with a typed Go pipeline.

Libraries:
- [`ffgo`](https://github.com/obinnaokechukwu/ffgo) — pure Go FFmpeg bindings, no CGO, CUDA/VA-API hardware acceleration.
- [`MovieGo`](https://github.com/...) — fluent video editing graph; single ffmpeg invocation when possible.

Use cases:
- Thumbnail extraction
- Concatenation / crossfade assembly
- Audio muxing / normalization
- Frame-accurate segment cutting for Remotion inputs

Suggested location: `tools/go-media/`

---

### 2.3 Job Queue Worker — MEDIUM IMPACT

**Offload** non-AI, I/O-heavy queue stages from the FastAPI worker.

- File staging/moves
- JSON sidecar writes
- Health checks / port probing
- Notification dispatch

Suggested location: `tools/go-worker/`

Tech: `database/sql` for SQLite reads, HTTP client for callback to FastAPI.

---

### 2.4 MCP Bridge / Gateway — LOW-MEDIUM IMPACT

**Wrap** MCP bridge routing, auth, and rate-limiting in Go.

- Current bridges are Node.js (`tools/mcp/*.mjs`).
- A Go gateway can fan out to multiple bridges, enforce timeouts, and multiplex streams with minimal memory.

Suggested location: `tools/go-gateway/`

---

### 2.5 Port Manager / Service Supervisor — LOW IMPACT

**Replace** Python port watchers with Go binaries.

Benefits: cross-compile to Linux/macOS if the studio ever moves off Windows; tiny binary; no Python dependency.

Suggested location: `tools/go-ports/`

---

## 3. What NOT to Rewrite in Go

| Component | Keep in Python | Reason |
|-----------|----------------|--------|
| FastAPI backend (`packages/backend/`) | ✅ | All AI adapters, SSE routes, queue logic |
| Audio analysis (`librosa`, `madmom-infer`) | ✅ | Python DSP ecosystem is unmatched |
| ComfyUI integration | ✅ | Python-first API |
| Blender MCP bridge | ✅ | Already stable Python TCP bridge |
| Unity MCP bridge | ✅ | Node.js is fine here |
| Frontend (React/Vite) | ✅ | Not a backend language |

---

## 4. Hybrid Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Native Media AI Studio                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Frontend (Vite + React)                                    │
│  └── Port 5173                                              │
│                                                             │
│  Go Sidecars (new)                                          │
│  ├── go-dashboard   :3847  SSE + utility API                │
│  ├── go-media       :3848  FFmpeg pipeline worker           │
│  ├── go-worker      :3849  Queue I/O worker                 │
│  └── go-gateway     :3850  MCP bridge router                │
│                                                             │
│  Python Backend (FastAPI)                                   │
│  ├── Port 8000                                              │
│  ├── AI logic, ComfyUI, Blender, Queue                      │
│  └── Calls Go sidecars over HTTP for high-concurrency work  │
│                                                             │
│  ComfyUI :8188                                              │
│  Blender MCP :9876                                          │
│  Unity MCP :7800                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Communication: HTTP/JSON or gRPC. Keep contracts small.

---

## 5. Go Module Layout

```
tools/
├── go-dashboard/
│   ├── go.mod
│   ├── main.go          # SSE server + health endpoints
│   ├── handlers/
│   └── static/          # shell.html/css/js if needed
├── go-media/
│   ├── go.mod
│   ├── main.go
│   └── pipeline/        # ffgo / MovieGo wrappers
├── go-worker/
│   ├── go.mod
│   └── main.go
└── go-gateway/
    ├── go.mod
    └── main.go
```

Each module is independent. No shared Go module tree — they compile to separate binaries.

---

## 6. First Implementation: `go-dashboard`

This is the lowest-risk, highest-value first step.

### 6.1 `go-dashboard/go.mod`

```go
module github.com/yourname/nma-studio/go-dashboard

go 1.27

require github.com/inoth/go-sse v0.0.0
```

### 6.2 `go-dashboard/main.go` (minimal SSE server)

```go
package main

import (
    "encoding/json"
    "log"
    "net/http"
    "time"
)

func main() {
    http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "go-dashboard"})
    })

    http.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "text/event-stream")
        w.Header().Set("Cache-Control", "no-cache")
        w.Header().Set("Connection", "keep-alive")

        flusher, ok := w.(http.Flusher)
        if !ok {
            http.Error(w, "SSE not supported", http.StatusInternalServerError)
            return
        }

        for {
            data := map[string]interface{}{
                "timestamp": time.Now().Format(time.RFC3339),
                "cpu":       float64(42),
            }
            json.NewEncoder(w).Encode(data)
            flusher.Flush()
            time.Sleep(2 * time.Second)
        }
    })

    log.Println("go-dashboard listening on :3847")
    log.Fatal(http.ListenAndServe(":3847", nil))
}
```

Build: `go build -o ../../bin/go-dashboard.exe .`

Run from `scripts/start-services.ps1` alongside Python services.

---

## 7. PATH / Environment Notes

Go 1.27.0 is already on PATH (`go version` confirmed). No action needed.

If adding a new Go install location, prepend to `PATH` in PowerShell profile:

```powershell
$env:PATH = "C:\Go\bin;" + $env:PATH
```

Or use `go env GOROOT` to find the active install.

---

## 8. Implementation Status (2026-09-08)

| Component | Status | Notes |
|-----------|--------|-------|
| `go-dashboard` | ✅ Done | Binary at `bin/go-dashboard.exe`, registered in `start-services.ps1` and `manage-servers.ps1`. Health at `/api/health`, SSE at `/events`. |
| `go-media` | ✅ Done | Binary at `bin/go-media.exe`. Typed FFmpeg wrapper (thumbnail/normalize/concat). |
| `go-worker` | ✅ Done | Binary at `bin/go-worker.exe`. Queue I/O worker with job + sidecar endpoints. |
| `go-gateway` | ✅ Done | Binary at `bin/go-gateway.exe`. MCP bridge router with `/proxy/:bridge/*path` on `:3850`. **Fix applied:** response proxy now uses `io.Copy` instead of single `Read` call (was truncating responses). |
| `go-ports` | ✅ Done | Binary at `bin/go-ports.exe`. Port availability checker on `:3851` (`/api/health`, `/check/<port>`, `/scan?ports=...`). |
| Frontend integration | ✅ Done | `config/ports.json` includes `dashboard_port`/`dashboard_url`. `portConfig.ts` exposes `getDashboardUrl()`. `GoServicesCard` component added to HealthPage, polls all 5 Go sidecars every 5s. |
| Service lifecycle | ✅ Done | All Go sidecars start automatically with `scripts\start-services.ps1`. Managed via `scripts\manage-servers.ps1 -Action status` (supports `go-dashboard`, `go-media`, `go-worker`, `go-gateway`, `go-ports`). |
| Technical reference | ✅ Done | Service map updated in `docs/knowledge-library/technical-reference.md`. |

## 9. Decision Record

| Question | Answer |
|----------|--------|
| Do we need Go? | Yes, for high-concurrency infrastructure (dashboard SSE, media workers, gateway). |
| Do we rewrite Python in Go? | No. Keep FastAPI, audio analysis, and ComfyUI in Python. |
| First deliverable | `go-dashboard` — single-binary SSE server on :3847. |
| Success metric | Memory < 25 MB, startup < 100 ms, 500+ concurrent SSE connections without degradation. |
| Rollback | Keep Python server as fallback; run Go sidecar on alternate port until validated. |

---

## 10. Lessons Learned

1. **Proxy bodies fully.** The initial `go-gateway` proxy used `resp.Body.Read(buf)` once, which only reads one chunk. Use `io.Copy(c.Writer, resp.Body)` for full response transfer.
2. **CLI + server duality.** `go-media` started as CLI-only, but the backend needs programmatic access. Adding `--server` mode makes it callable from FastAPI without shell-outs.
3. **Port probing from Go.** `go-ports` replaces ad-hoc PowerShell port checks with a tiny cross-platform binary. Frontend can poll it directly.
4. **Frontend polling pattern.** `GoServicesCard` uses `AbortSignal.timeout(2000)` + 5s interval. This is more reliable than `useHealth` for non-FastAPI services.

## 11. Related Documents

- [[stack-extensions-2026]] — broader language/tooling ROI analysis
- [[technical-reference]] — system architecture, service map
- [[backend-debugging-guide]] — FastAPI debugging patterns
- [[python-environment-management]] — venv decoupling rules

---

_Last updated: 2026-09-08_
