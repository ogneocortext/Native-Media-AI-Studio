# Hardware Profile and Benchmark Harness

> **Last Updated:** 2026-09-23  
> **Status:** Implemented for the local workstation  
> **Hardware baseline:** GTX 1070 Ti 8 GB VRAM / Ryzen 5 5500 / 32 GB RAM / Windows 11

## Purpose

The backend now has a reusable hardware profile and a bounded benchmark runner for
Ollama and ComfyUI. The profile records the workstation identity, live resource
telemetry, and conservative execution limits. Benchmark results include latency,
token/output metrics, GPU snapshots, request parameters, and errors, and are stored
in SQLite for history and comparison.

## Configuration

The checked-in configuration is `config/hardware-profile.json`.

- `manual_overrides` records stable hardware facts that should not change between
  driver refreshes.
- Live memory availability, storage free space, GPU utilization, temperature, and
  driver telemetry are detected on each refresh.
- `limits` is a safety envelope. Request options may lower a limit but may not
  silently exceed it.
- `max_concurrent_benchmarks` is `1` by default to protect the 8 GB GPU.

A cached profile is kept at `config/hardware-profile.cached.json`. Loading the
cache still reapplies configuration overrides, so changing the config does not
require deleting the cache.

## API

The router is mounted at `/api/hardware`.

### Get the profile

```http
GET /api/hardware/profile
GET /api/hardware/profile?refresh=true
```

The response contains CPU, memory, storage, GPU, recommendations, warnings, and
effective limits.

### Run a benchmark

```http
POST /api/hardware/benchmark
Content-Type: application/json

{
  "engine": "ollama",
  "model": "qwen3-vl:2b",
  "prompt": "Explain the difference between a benchmark and a smoke test.",
  "iterations": 3,
  "timeout_seconds": 120,
  "options": {
    "temperature": 0.2
  },
  "persist": true
}
```

Supported engines are `ollama` and `comfyui`. If an Ollama model is omitted, the
first model reported by Ollama is selected. ComfyUI uses the configured 768x768,
20-step, CFG 7 baseline unless the request lowers those values.

The endpoint waits for the bounded run and returns a result with:

- `run_id`, engine, model, status, and timing
- `successful_iterations` and aggregate latency
- Ollama prompt/evaluation token counts when reported
- ComfyUI output size and prompt/seed metadata
- GPU snapshots before and after the run
- request parameters and a concise error message

Failed adapter calls are returned as a structured failed result rather than
crashing the API request.

### Query history

```http
GET /api/hardware/benchmarks?engine=ollama&limit=20
GET /api/hardware/benchmarks/{run_id}
DELETE /api/hardware/benchmarks?older_than_days=30
```

History is stored in the `hardware_benchmarks` table. The database migration
advances the schema from version 15 to version 16.

## CLI

From `packages/backend`:

```powershell
python -m app.services.hardware_benchmark `
  --engine ollama `
  --model qwen3-vl:2b `
  --iterations 3 `
  --timeout-seconds 120 `
  --json
```

Use `--profile PATH` to test another hardware profile and `--no-persist` for a
temporary run. The CLI uses the same runner and safety limits as the API.

## Safety and interpretation

Benchmarks are intentionally sequential by default. They are suitable for
comparing models or configuration changes on this workstation, not for establishing
vendor-wide performance claims. A result should be compared with the profile ID,
GPU snapshot, model name, prompt, context/output limits, and iteration count. A
driver update, model quantization change, or different free-VRAM state can change
the result.

The runner records ComfyUI metadata but excludes the generated base64 image from
the persisted result to keep benchmark history small.
