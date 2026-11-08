# ASGI Server Comparison & Best Practices Guide (November 2026)

> **Last Updated:** November 2026  
> **Status:** Verified against current releases  
> **Sources:** Official docs, GitHub releases, benchmarks, production deployments

---

## Executive Summary

| Server | Best For | Performance | Protocols | Windows | Maturity |
|--------|----------|-----------|-----------|---------|----------|
| **Granian** | Raw throughput, HTTP/2, WebSockets, RSGI | ⭐⭐⭐⭐⭐ Best | HTTP/1, HTTP/2, WS, RSGI | ✅ Native | Beta (2.8.7) |
| **Uvicorn** | General purpose, FastAPI/Starlette, Winloop on Windows | ⭐⭐⭐⭐ Excellent | HTTP/1, WS, HTTP/2* | ✅ Winloop | Stable |
| **Hypercorn** | HTTP/2, HTTP/3 (QUIC), Trio, WSGI | ⭐⭐⭐⭐ Great | HTTP/1, HTTP/2, HTTP/3, WS | ✅ Native | Stable (0.18.0) |
| **Daphne** | Django Channels, HTTP/2, SSE | ⭐⭐⭐ Good | HTTP/1, HTTP/2, WS | ✅ Native | Stable |

> **Key Insight:** No single server is "best" for all scenarios. Use the hybrid approach: Granian for performance-critical paths, Uvicorn for stability, Hypercorn for HTTP/2/3/QUIC, Daphne for Django Channels.

---

## 1. Granian — The Rust-Powered Speed Demon

### Overview
- **Language:** Rust (Hyper + Tokio)
- **Version:** 2.8.7 (Oct 2026)
- **License:** BSD-3-Clause
- **Python:** ≥3.10
- **Protocols:** ASGI/3, RSGI, WSGI, HTTP/1, HTTP/2, WebSockets, RSGI
- **License:** BSD-3-Clause

### Unique Features
| Feature | Description |
|---------|-------------|
| **RSGI** | Native Rust protocol — lower overhead than ASGI |
| **Rust Event Loops** | `--loop rloop` (Rust mio), `--loop winloop` (Windows) |
| **Embeddable** | Can embed in Python apps: `from granian.server.embed import Server` |
| **Static Files** | Built-in static file serving |
| **RSGI** | Lower overhead protocol — direct Rust-to-Rust mapping |

### Performance (Granian 2.8.1, AMD Ryzen 7 5700X, 16 cores)

| Benchmark | Granian | Gunicorn+Uvicorn | Speedup |
|-----------|---------|------------------|---------|
| ASGI GET 10KB (c128) | 1,255,606 RPS | 345,317 RPS | **3.6x** |
| ASGI Echo 10KB | 631,911 RPS | — | — |
| ASGI File Response | 480,486 RPS | 162,316 RPS | **3.0x** |
| WebSocket (8 clients) | 1,246,391 msg/s | 951,967 msg/s | **1.3x** |

### Threading Model
| Parameter | Description |
|-----------|-------------|
| `--workers` | Process count (each has own interpreter) |
| `--blocking-threads` | Threads/worker for Python interpreter interaction |
| `--runtime-threads` | Rust threads for network I/O |
| `--runtime-blocking-threads` | Threads for blocking I/O (files) |

### Windows Support
- ✅ Native Windows support since 2.8.0
- `--loop winloop` — Windows-native event loop (uvloop port)
- `--loop rloop` — Rust mio-based (Linux only)
- Windows kernel floor: 2.8.0+ requires modern kernel

### Installation
```bash
pip install granian                    # Basic
pip install granian[uvloop]            # With uvloop extra
pip install granian[winloop]           # Windows event loop
```

### Configuration
```bash
granian --interface asgi --host 0.0.0.0 --port 8004 \
        --workers 4 --blocking-threads 4 \
        --runtime-threads 2 --runtime-blocking-threads 2 \
        myapp:app
```

### When to Use Granian
✅ **Use when:**
- Maximum throughput needed
- HTTP/2 performance critical
- WebSocket-heavy applications
- RSGI protocol support needed
- Embedding in Python apps

❌ **Avoid when:**
- Pure Python required
- Trio/gevent compatibility needed
- Advanced debugging features needed
- Cutting-edge ASGI extensions needed

### Known Issues (2026)
- Memory spikes during VST/plugin scanning (observed in this project)
- `--workers > 1` on Windows can be unstable
- `--max-requests` not supported (use Gunicorn for recycling)

---

## 2. Uvicorn — The Reliable Workhorse

### Overview
- **Language:** Python (Cython + Rust extensions)
- **Version:** 0.52.2+ (Aug 2026)
- **License:** BSD-3-Clause
- **Protocols:** HTTP/1, HTTP/2*, WebSockets
- **Python:** ≥3.8
- **License:** BSD-3-Clause

### Event Loop Options (2026)
| Loop | Platform | Performance | Notes |
|------|----------|-------------|-------|
| `uvloop` | Linux/macOS | ⭐⭐⭐⭐⭐ Best | Default if installed |
| `winloop` | Windows | ⭐⭐⭐⭐ Great | uvloop port for Windows |
| `zuvloop` | All (3.14+) | ⭐⭐⭐⭐⭐ Best | Zig + libuv |
| `rloop` | Unix only | ⭐⭐⭐⭐ Experimental | Rust mio |
| `asyncio` | All | ⭐⭐ Baseline | Fallback |

### Windows Event Loops (2026)
```bash
# Winloop — uvloop port for Windows
pip install winloop
uvicorn main:app --loop winloop:new_event_loop

# Standard asyncio (fallback)
uvicorn main:app --loop asyncio
```

### Windows Multiprocessing
- **Single worker:** `ProactorEventLoop` (default)
- **Multiple workers/--reload:** `SelectorEventLoop` (avoids Proactor issues)
- `--workers 4` uses `spawn` (not fork) — works on Windows

### HTTP/2 Support
- **Experimental** — requires `--http h2` + TLS
- Behind Nginx reverse proxy recommended
- Not as mature as Hypercorn's HTTP/2

### Recent Improvements (2026)
- `zttp` integration for HTTP/1.1 performance
- `--timeout-graceful-shutdown` parameter
- `SIGBREAK` handling on Windows
- `--reset-contextvars` for context isolation
- `zttp` 0.0.24+ for HTTP/1.1 parsing

### Performance (uvloop, Linux)
| Benchmark | Uvicorn | Granian | Ratio |
|-----------|---------|---------|-------|
| Plaintext | 55.3k req/s | 125k req/s | 0.44x |
| 10KB body | 52.6k req/s | 129k req/s | 0.41x |
| Echo 10KB | 68.7k req/s | 129k req/s | 0.53x |

### When to Use Uvicorn
✅ **Use when:**
- FastAPI/Starlette applications
- General-purpose ASGI serving
- Windows development/production
- Team familiarity (largest community)
- Quick prototyping

❌ **Avoid when:**
- HTTP/2/3 at origin needed
- Maximum throughput required
- Trio runtime needed

---

## 3. Hypercorn — The Protocol Swiss Army Knife

### Overview
- **Author:** Philip Jones (Quart author)
- **Version:** 0.18.0 (Nov 2025)
- **License:** MIT
- **Protocols:** HTTP/1, HTTP/2, HTTP/3 (QUIC), WebSockets
- **Worker Types:** asyncio, uvloop, trio
- **Python:** ≥3.10

### Unique Superpowers
| Feature | Description |
|---------|-------------|
| **HTTP/3 (QUIC)** | Native via `aioquic` — `pip install hypercorn[h3]` |
| **HTTP/2 Native** | No reverse proxy needed |
| **HTTP/2 Server Push** | Native support |
| **Trio Worker** | `hypercorn --worker-class trio` |
| **WSGI Support** | Native WSGI + ASGI |
| **TLS/ALPN** | Native TLS, ALPN negotiation |

### HTTP/3 (QUIC) Setup
```bash
pip install hypercorn[h3]
hypercorn --quic-bind localhost:4433 \
          --certfile cert.pem --keyfile key.pem \
          myapp:app
```

### Worker Types
| Worker | Use Case |
|--------|----------|
| `asyncio` | Default, general purpose |
| `uvloop` | High performance (Linux/macOS) |
| `trio` | Structured concurrency, cancellation |

### HTTP/2 Features
- Multiplexing, flow control, server push, prioritization
- ALPN: `h2`, `http/1.1`
- h2c (cleartext HTTP/2 upgrade) supported

### Performance (vs Uvicorn)
| Metric | Hypercorn | Uvicorn | Notes |
|--------|-----------|---------|-------|
| HTTP/1 throughput | Close | Baseline | ~5-10% slower |
| HTTP/2 latency | Low | Via proxy | Native |
| WebSocket | Good | Good | Comparable |
| HTTP/3 | Native | Proxy only | Unique |

### When to Use Hypercorn
✅ **Use when:**
- HTTP/2/3 at origin required
- HTTP/2 Server Push needed
- Trio async runtime preferred
- WSGI + ASGI hybrid deployment
- Native TLS/QUIC termination

❌ **Avoid when:**
- Maximum raw throughput needed
- Simple FastAPI/Starlette app
- Team unfamiliar with QUIC/TLS config

---

## 4. Daphne — The Django Channels Specialist

### Overview
- **Maintainer:** Django Channels team
- **Version:** 4.2.3+ (2026)
- **License:** BSD-3-Clause
- **Protocols:** HTTP/1, HTTP/2, WebSocket, SSE
- **Python:** ≥3.10

### Unique Role
- **Reference implementation** for Django Channels
- Built on Twisted (not asyncio)
- Auto-negotiates HTTP/WebSocket
- HTTP/2 support (no Server Push)

### When to Use Daphne
✅ **Use when:**
- Django Channels applications
- Django WebSocket consumers
- HTTP/2 + Django required
- SSE (Server-Sent Events) needed
- Django ecosystem integration critical

❌ **Avoid when:**
- Pure FastAPI/Starlette (use Uvicorn)
- Maximum WebSocket throughput needed
- Non-Django ASGI frameworks
- Maximum raw performance needed

### Performance
| Metric | Daphne | Uvicorn |
|--------|--------|---------|
| WebSocket throughput | Baseline | ~2x faster |
| HTTP/2 | Supported | Via proxy |
| Concurrency | Lower | Higher |
| Memory/connection | Higher | Lower |

### Deployment
```bash
# Development
daphne -p 8001 myproject.asgi:application

# Production (Unix socket)
daphne -u /run/daphne.sock myproject.asgi:application

# With SSL
daphne -e ssl:443:privateKey=key.pem:certKey=crt.pem myproject.asgi:application
```

---

## Decision Matrix

### By Use Case

| Scenario | Recommended | Fallback |
|----------|-------------|----------|
| FastAPI/Starlette API | **Uvicorn** | Granian |
| Maximum throughput | **Granian** | Uvicorn |
| HTTP/2 at origin | **Hypercorn** | Granian |
| HTTP/3 (QUIC) | **Hypercorn** | — |
| HTTP/2 Server Push | **Hypercorn** | — |
| HTTP/3 (QUIC) | **Hypercorn** | — |
| Django Channels | **Daphne** | Uvicorn |
| Django + HTTP/2 | **Daphne** | Hypercorn |
| WebSocket-heavy | **Granian/Uvicorn** | Hypercorn |
| Trio runtime | **Hypercorn** | — |
| Windows + WebSockets | **Uvicorn (winloop)** | Granian (winloop) |
| Maximum throughput | **Granian** | Uvicorn |
| HTTP/2 Server Push | **Hypercorn** | — |
| Trio async runtime | **Hypercorn** | — |

### By Protocol Requirements

| Protocol | Granian | Uvicorn | Hypercorn | Daphne |
|----------|---------|---------|-----------|--------|
| HTTP/1.1 | ✅ | ✅ | ✅ | ✅ |
| HTTP/2 | ✅ Native | Via proxy | ✅ Native | ✅ Native |
| HTTP/3 (QUIC) | ❌ | ❌ | ✅ Native | ❌ |
| WebSockets | ✅ Excellent | ✅ Excellent | ✅ Good | ✅ Excellent |
| HTTP/2 Server Push | ❌ | ❌ | ✅ | ❌ |
| HTTP/2 Server Push | ❌ | ❌ | ✅ | ❌ |
| SSE | ❌ | ❌ | ✅ | ✅ |
| WSGI | ✅ | ❌ | ✅ | ❌ |
| RSGI | ✅ Native | ❌ | ❌ | ❌ |

---

## Windows-Specific Recommendations (2026)

### Event Loop Selection
```bash
# Granian (Windows)
granian --loop winloop --interface asgi app:app

# Uvicorn (recommended Windows)
uvicorn main:app --loop winloop --workers 1

# Hypercorn
hypercorn --worker-class asyncio app:app

# Daphne
daphne -b 0.0.0.0 -p 8000 app:application
```

### Windows Multiprocessing
| Server | Workers | Method | Notes |
|--------|---------|--------|-------|
| Uvicorn | 1-4 | `spawn` | Stable |
| Granian | 1 | Native | Unstable >1 |
| Hypercorn | 1-4 | Native | Stable |
| Daphne | 1-4 | Twisted | Stable |

### Memory Management (8GB VRAM / System)
```bash
# Uvicorn - single worker, no access log
uvicorn main:app --workers 1 --no-access-log --loop winloop

# Granian - single worker, internal threading
granian --interface asgi --workers 1 --blocking-threads 4

# Hypercorn
hypercorn --workers 1 --worker-class asyncio

# Memory monitoring
export OLLAMA_KEEP_ALIVE=5m
export OLLAMA_MAX_LOADED_MODELS=1
```

---

## Production Deployment Patterns

### Pattern 1: Maximum Performance (Granian Primary)
```nginx
# Nginx -> Granian (port 8004) -> fallback Uvicorn (8005)
upstream granian {
    server 127.0.0.1:8004;
    server 127.0.0.1:8005 backup;  # uvicorn backup
}
```

### Pattern 2: Protocol-Specific (Hypercorn for HTTP/2/3)
```nginx
# HTTP/1.1, WS -> Uvicorn
# HTTP/2, HTTP/3, QUIC -> Hypercorn
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

upstream http1_ws {
    server 127.0.0.1:8004;  # uvicorn
}
upstream http2_h3 {
    server 127.0.0.1:8005;  # hypercorn
}
```

### Pattern 3: Django Channels + FastAPI (Daphne + Uvicorn)
```nginx
# WebSocket/Django -> Daphne (port 8001)
# FastAPI/REST -> Uvicorn (port 8004)

upstream daphne {
    server unix:/run/daphne.sock;
}
upstream uvicorn {
    server 127.0.0.1:8004;
}
```

---

## Memory Management for 8GB VRAM / System RAM

### Monitoring Script
```python
import psutil
import os

def check_memory():
    mem = psutil.virtual_memory()
    if mem.percent >= 85:
        print(f"⚠️ CRITICAL: {mem.percent}% RAM used")
        return True
    return False

# Run before loading models
if check_memory():
    import subprocess
    subprocess.run(["ollama", "stop", "gemma4:e2b-it-qat"])
```

### Ollama Config
```bash
export OLLAMA_KEEP_ALIVE=5m
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_FLASH_ATTENTION=1
```

---

## Quick Reference Card

```bash
# === GRANIAN (Performance) ===
granian --interface asgi --host 0.0.0.0 --port 8004 \
        --workers 1 --blocking-threads 4 \
        --runtime-threads 2 --runtime-blocking-threads 2 \
        --loop winloop app:app

# === UVICORN (Stable, Windows) ===
uvicorn main:app --host 127.0.0.1 --port 8004 \
      --loop winloop --workers 1 --no-access-log

# === HYPERCORN (HTTP/2, HTTP/3, Trio) ===
hypercorn --bind 127.0.0.1:8004 --workers 1 \
          --worker-class asyncio app:app

# With HTTP/3
hypercorn --quic-bind 127.0.0.1:4433 \
          --certfile cert.pem --keyfile key.pem \
          --worker-class asyncio app:app

# === DAPHNE (Django Channels) ===
daphne -b 0.0.0.0 -p 8001 myproject.asgi:application
# Unix socket
daphne -u /run/daphne.sock myproject.asgi:application
```

---

## Health Check Endpoints

```python
# Add to all servers
@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "server": "uvicorn|granian|hypercorn|daphne",
        "version": "x.y.z"
    }

@app.get("/api/vst/scan")
async def scan():
    # Returns plugin list
    ...

@app.get("/api/vst/plugins")
async def list_plugins():
    # Returns cached plugins
    ...
```

---

## Troubleshooting Quick Reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| Granian 500 on scan | Memory spike | Pre-load plugins, increase threshold |
| Uvicorn workers crash | ProactorEventLoop | Use `--workers 1` or `winloop` |
| Hypercorn HTTP/3 fails | Missing aioquic/certs | `pip install hypercorn[h3]`, valid certs |
| Daphne HTTP/2 fails | No TLS | Requires TLS for HTTP/2 |
| Memory > 85% | Model loading | `ollama stop <model>`, reduce batch |

---

## Version Compatibility (Nov 2026)

| Component | Version | Python | Notes |
|-----------|---------|--------|-------|
| Granian | 2.8.7 | ≥3.10 | winloop extra for Windows |
| Uvicorn | 0.52.2+ | ≥3.8 | winloop extra for Windows |
| Hypercorn | 0.18.0 | ≥3.10 | trio extra for Trio |
| Daphne | 4.2.3+ | ≥3.10 | Django Channels |
| Python | 3.11.9/3.12/3.13 | | 3.14 for zuvloop |

---

## Resources

- **Granian:** https://github.com/emmett-framework/granian
- **Uvicorn:** https://uvicorn.dev/
- **Hypercorn:** https://hypercorn.readthedocs.io/
- **Daphne:** https://github.com/django/daphne
- **ASGI Spec:** https://asgi.readthedocs.io/
- **Benchmarks:** https://m0serve.dev/docs/benchmarks
- **Winloop:** https://github.com/joerick/winloop
- **zuvloop:** https://github.com/marcelotryle/zuvloop