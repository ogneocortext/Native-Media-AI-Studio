---
tags:
  - ollama
  - utilization
  - model-routing
  - vram
  - 8gb-vram
  - 2026
aliases:
  - Ollama Utilization 2026
  - Ollama Model Routing
  - Local LLM Utilization
cssclasses:
  - ollama
  - utilization
date: 2026-09-24
---

# 🧠 Ollama Model Utilization 2026 — Native Media AI Studio

> [!info] Purpose
> Canonical guide for getting maximum value out of the local Ollama installation
> within the Native Media AI Studio application context. Covers **current
> utilization**, **installed model inventory**, **task → model routing**,
> **VRAM-aware scheduling**, **integration points**, **gaps**, and **expansion
> recommendations** specific to this codebase and hardware baseline.
>
> **Hardware baseline:** GTX 1070 Ti (8 GB VRAM, sm_61) / Ryzen 5 5500 /
> 32 GB RAM / Windows 11. All recommendations assume this constraint unless
> marked otherwise.

> [!tip] How to Use
> - **AI agents:** Read §3 (Task → Model Routing) before invoking Ollama.
> - **Developers:** Read §4 (Integration Points) to understand where Ollama
>   is wired into the backend and frontend.
> - **Operators:** Read §5 (VRAM-Aware Scheduling) to prevent OOMs.

---



## 1. Current Utilization Snapshot

### 1.1 What's Already Wired

Ollama is the **central LLM layer** for Native Media AI Studio. It is used for:

| Use Case | Entry Point | Model(s) | Status |
|---|---|---|---|
| Storyboard generation | `POST /api/storyboard/generate` → `StoryboardGeneratorHandler` | `gemma4:e2b-it-qat` (default) | ✅ Active |
| Three.js scene generation (agent loop) | `packages/backend/app/adapters/ollama.py` built-in tools + MCP bridge | `qwen3.5:9b` (planner) | ✅ Active |
| Vision analysis (screenshots, UI audits) | `tools/vision/analyze.mjs` → `gemma4:e2b-it-qat` / `qwen3-vl:*` | Mode-dependent | ✅ Active |
| Audio analysis section labeling | `POST /api/audio/analysis/:filename` | `gemma4:e2b-it-qat` | ✅ Active |
| Embeddings | `POST /api/embed` | `nomic-embed-text:v1.5` | ✅ Active |
| Hardware benchmarks | `POST /api/hardware/benchmark` → `HardwareBenchmarkRunner` | First available model | ✅ Active |
| Music prompt generation | `POST /api/music-prompts/generate` | Configurable | ✅ Active |

### 1.2 What Is NOT Yet Utilized

| Capability | Evidence | Opportunity |
|---|---|---|
| **ollama-tools MCP server tools are not wired into backend** | `tools/mcp/ollama-tools-mcp.mjs` exists but FastAPI routes don't import or call it | Agents can't use `analyze_image`, `generate_3d_concept`, etc. via API |
| **`mcp_validator.py` is dead code** | 435-line validator, zero imports | Agent tool calls are not validated against JSON Schema |
| **Video generation via Ollama** | `generate_video` in MCP returns a stub message | No text-to-video path through Ollama |
| **Music prompt generator not in wizard** | `music_prompt_generator.py` is a standalone page, wizard step missing | Users context-switch instead of flowing |
| **Multi-model comparison** | Benchmark runner uses the first available model only | No A/B testing of models for the same task |
| **Streaming responses to frontend** | Backend `chat()` supports streaming, but SSE not exposed for all routes | Long generations block the HTTP request |

---



## 2. Installed Model Inventory

### 2.1 Live Ollama Registry (as of 2026-09-24)

| Model | Size | VRAM Est. | Quant | Capabilities | Notes |
|---|---|---|---|---|---|
| `gemma4:e2b-it-qat` | 4.04 GB | ~6 GB | Q4_0 | completion, **vision**, audio, **tools**, **thinking** | Default model; 8GB-safe; multimodal |
| `qwen3.5:9b` | 6.14 GB | ~9 GB | Q4_K_M | completion, **vision**, **tools**, **thinking** | Best tool caller; tight on 8GB |
| `qwen3.5:4b` | 3.16 GB | ~4.8 GB | Q4_K_M | completion, **vision**, **tools**, **thinking** | Best speed/quality balance |
| `qwen3-vl:4b` | 3.07 GB | ~4.6 GB | Q4_K_M | completion, **vision**, **tools**, **thinking** | Vision + tools; 8GB-safe |
| `qwen3-vl:2b` | 1.76 GB | ~2.6 GB | Q4_K_M | completion, **vision**, **tools**, **thinking** | Fastest vision; triage mode |
| `qwen3-vl-optimized:latest` | 3.07 GB | ~4.6 GB | Q4_K_M | completion, **vision**, **tools**, **thinking** | Optimized vision variant |
| `gemma4-vision-optimized:latest` | 4.04 GB | ~6 GB | Q4_0 | completion, **vision**, **tools**, **thinking** | Optimized vision variant |
| `minicpm-v:8b` | 5.1 GB | ~7.7 GB | Q4_0 | completion, **vision** | OCR specialist; RLAIF-V |
| `minicpm-v:latest` | 5.1 GB | ~7.7 GB | Q4_0 | completion, **vision** | Alias for `minicpm-v:8b` |
| `openbmb/minicpm-v4.6:q4_K_M` | 1.53 GB | ~2.3 GB | Q4_K_M | **tools**, **thinking**, completion, **vision** | New MiniCPM v4.6; tiny + capable |
| `deepseek-r1:7b` | 4.36 GB | ~6.5 GB | Q4_K_M | **tools**, **thinking**, completion | Reasoning specialist; no vision |
| `ornith-1.5:9b` | 6.1 GB | ~9 GB | Q4_K_M | **tools**, **thinking**, completion | Not practical on 8GB unquantized |
| `llama3.2:3b` | 1.88 GB | ~2.8 GB | Q4_K_M | completion, **tools** | Lightweight tool caller |
| `nomic-embed-text:v1.5` | 0.26 GB | ~0.4 GB | F16 | embedding | Embedding model; always resident |

### 2.2 VRAM Budget on 8 GB Card

Conservative estimate with KV cache + overhead:

| Model Class | Estimated VRAM | Safe? | Recommendation |
|---|---|---|---|
| 2B–3B | 2.5–3.5 GB | ✅ | Daily driver for simple tasks |
| 4B | 4.5–5.5 GB | ✅ | Good for most tasks with headroom |
| 4B VL (vision) | 5.0–6.0 GB | ✅ | Vision + tool calling |
| 7B | 6.5–7.5 GB | ⚠️ | Only one at a time; no concurrent GPU workload |
| 9B | 8.5–10 GB | ❌ | OOM unless CPU offload + swap |

**Rule of thumb:** Keep total VRAM allocation under 6.5 GB to leave headroom for
KV cache growth, ComfyUI/FFmpeg, and CUDA overhead.

---



## 3. Task → Model Routing

### 3.1 Routing Philosophy

The app follows **resident-model stickiness**: a cold load costs 30–100 s, so
we prefer the already-resident model unless the task explicitly requires
capabilities the resident lacks.

**Priority order:**
1. Explicit `--model` flag or config override
2. Task-mapped model if it is resident
3. Resident vision-capable model (for vision tasks)
4. Default model (`gemma4:e2b-it-qat`)

### 3.2 Task → Model Map

| Task | Primary Model | Fallback | Why |
|---|---|---|---|
| **Vision analysis (UI, responsive, regression)** | `gemma4:e2b-it-qat` | `qwen3-vl:2b` | Best detailed audits; 2b for speed |
| **OCR / table / chart** | `gemma4:e2b-it-qat` | `minicpm-v:8b` | Gemma detailed; MiniCPM RLAIF-V trustworthy |
| **Compare / multicomp images** | `qwen3-vl:2b` | `qwen3-vl:4b` | Fastest decode; 262K ctx for image sets |
| **Storyboard generation** | `qwen3.5:9b` | `qwen3.5:4b` | Best JSON adherence; 4b if VRAM tight |
| **Three.js scene planning** | `qwen3.5:9b` | `qwen3.5:4b` | Strong tool calling + reasoning |
| **Blender script planning** | `qwen3.5:9b` | `qwen3.5:4b` | Same as above |
| **Code generation / backend tasks** | `qwen3.5:4b` | `llama3.2:3b` | 4b best balance; 3b for quick edits |
| **Reasoning / complex analysis** | `deepseek-r1:7b` | `qwen3.5:9b` | DeepSeek best reasoning; 9b if 7b OOM |
| **Music prompt generation** | `qwen3.5:4b` | `gemma4:e2b-it-qat` | Fast multi-platform prompt generation |
| **Embedding / semantic search** | `nomic-embed-text:v1.5` | — | Always resident; lightweight |
| **Audio analysis (text tasks)** | `gemma4:e2b-it-qat` | `qwen3.5:4b` | Default; 4b if VRAM needed elsewhere |
| **System health / quick status** | `llama3.2:3b` | `qwen3.5:4b` | Lightest capable model |

### 3.3 Vision Mode Routing (Implemented in `tools/vision/analyze.mjs`)

| Mode | Model | Temperature | num_ctx | Max Dim | Notes |
|---|---|---|---|---|---|
| `ui` | `gemma4:e2b-it-qat` | 0.3 | 8192 | 1568 | Detailed UI audits |
| `responsive` | `gemma4:e2b-it-qat` | 0.3 | 8192 | 1568 | Layout issues |
| `regression` | `gemma4:e2b-it-qat` | 0.3 | 8192 | 1568 | What changed |
| `compare` | `qwen3-vl:2b` | 0.3 | 8192 | 1280 | Fast diff; 262K ctx |
| `multicomp` | `qwen3-vl:2b` | 0.3 | 8192 | 1280 | Multi-image sets |
| `ocr` | `gemma4:e2b-it-qat` | 0 | 8192 | 1568 | Deterministic transcription |
| `table` | `gemma4:e2b-it-qat` | 0 | 8192 | 1568 | Deterministic extraction |
| `chart` | `gemma4:e2b-it-qat` | 0 | 8192 | 1568 | Deterministic extraction |
| `music-video` | `gemma4:e2b-it-qat` | 0.3 | 8192 | 1568 | Frame analysis |

### 3.4 VRAM-Aware Fallback Ladder

When the primary model is too large for concurrent workloads:

```
Primary (9B/7B) → CPU offload → 4B fallback → 3B fallback → mock
```

**Implementation:**
- Backend `ollama.py` `chat()` already clamps `num_ctx` to 16384 for 8GB safety
- `generate_with_fallback()` in `base.py` raises on service unavailability (no silent mock)
- `vram_manager.py` offloads Ollama during GPU-heavy jobs (ComfyUI, 3D)

---



## 4. Integration Points in the Codebase

### 4.1 Backend Adapter (`packages/backend/app/adapters/ollama.py`)

The `OllamaAdapter` is the **single entry point** for all backend Ollama calls:

| Method | Purpose | Notes |
|---|---|---|
| `chat()` | Multi-turn with tools, streaming, structured output | VRAM-aware `num_ctx` clamp; `think` mode |
| `generate()` | Single-turn text generation | Legacy path; no tools |
| `generate_storyboard()` | Structured JSON storyboard | Uses `format=json` + `think=false` |
| `health_check()` | Refresh model cache | Called automatically on `/api/tags` |
| `list_models()` | Available models | Cached in `_available_models` |
| `execute_tool_call()` | Built-in scene tools | 14 tools for Three.js + storyboard |
| `get_tool_definitions()` | JSON Schema for tools | OpenAI-compatible format |
| `set_activity()` / `clear_activity()` | VRAM coordination | Used by `vram_manager.py` |

**Built-in tools exposed to agents:**
- Three.js scene: `scene_add_object`, `scene_add_light`, `scene_set_camera`,
  `scene_set_particles`, `scene_add_keyframe`, `scene_clear`,
  `scene_get_state`, `scene_set_bloom`, `scene_set_duration`
- Storyboard: `scene_add_storyboard_element`, `scene_set_camera_for_shot`,
  `scene_add_text`, `scene_add_environment`, `scene_link_to_storyboard`
- System: `get_project_structure`, `search_docs`, `get_system_health`,
  `list_jobs`, `get_job_status`, `generate_visualization`

### 4.2 MCP Bridge (`tools/mcp/ollama-tools-mcp.mjs`)

Exposes 10 MCP tools to agents:

| MCP Tool | Ollama Usage | Backend Call |
|---|---|---|
| `analyze_image` | `/api/chat` with vision model | Direct Ollama call |
| `analyze_audio` | — | `GET /api/audio/analysis/:file` |
| `generate_image` | — | `POST /comfyui/prompt` |
| `generate_video` | — | Stub (returns instructions) |
| `list_audio_library` | — | `GET /api/audio/files` |
| `create_music_video_plan` | — | `GET /api/audio/analysis/:file` |
| `suggest_3d_prompt` | — | Template expansion (no LLM) |
| `generate_3d_concept` | — | Calls `generate_image` |
| `plan_blender_script` | `qwen3.5:9b` via `/api/chat` | Direct Ollama call |
| `update_mcp_context` | — | Writes `output/mcp-context.json` |

**Gap:** `analyze_image` uses a hardcoded `qwen3-vl:4b` default instead of
the routing table from `tools/vision/analyze.mjs`.

### 4.3 Vision Script (`tools/vision/analyze.mjs`)

Sophisticated task → model router with resident-model stickiness:

```javascript
const MODEL_PROFILES = {
  'gemma4:e2b-it-qat':   { temp: 0.3, tempExtract: 0, numCtx: 8192,  maxDim: 1568 },
  'qwen3-vl:2b':         { temp: 0.3, tempExtract: 0, numCtx: 8192,  maxDim: 1280 },
  'minicpm-v:8b':        { temp: 0,   tempExtract: 0, numCtx: 8192,  maxDim: 1792 },
};
const MODE_MODEL = {
  ocr: 'gemma4:e2b-it-qat',
  table: 'gemma4:e2b-it-qat',
  chart: 'gemma4:e2b-it-qat',
  compare: 'qwen3-vl:2b',
  multicomp: 'qwen3-vl:2b',
};
```

**Key behaviors:**
- Text-extraction modes (OCR/table/chart) force `temperature: 0`
- All modes append `GROUNDING_SUFFIX` to prompts
- Images are resized to `maxDim` before sending
- `keep_alive: 10m` prevents cold loads
- Resident model stickiness: if a vision model is already loaded, reuse it

### 4.4 Core HTTP Helpers (`packages/backend/app/core/ollama_client.py`)

Shared `aiohttp` session for stateless routes:

| Function | Endpoint | Purpose |
|---|---|---|
| `list_models()` | `GET /api/tags` | Model catalog |
| `embed_text()` | `POST /api/embed` | Single-text embedding |
| `chat_content()` | `POST /api/chat` | Non-streaming chat |
| `generate_content()` | `POST /api/generate` | Non-streaming generate |

### 4.5 Queue Processor (`packages/backend/app/queue/processor.py`)

Registers `STORYBOARD_GENERATION` handler that calls `OllamaAdapter` via
`StoryboardGeneratorHandler`. Serial processing ensures only one Ollama job
runs at a time, preventing VRAM contention.

### 4.6 VRAM Manager (`packages/backend/app/services/vram_manager.py`)

Coordinates with Ollama via `adapter.set_activity()` / `clear_activity()` to:
- Track which model is resident
- Offload Ollama before GPU-heavy jobs (ComfyUI, 3D generation)
- Reload after GPU job completes

### 4.7 Hardware Benchmark (`packages/backend/app/services/hardware_benchmark.py`)

Runs repeatable Ollama benchmarks:
- Uses `num_ctx=4096` and `num_predict=900` (from `hardware-profile.json`)
- Disables thinking (`think=False`) for consistent timing
- Persists results to SQLite
- Enforces `max_concurrent_benchmarks=1` via semaphore

---



## 5. VRAM-Aware Scheduling Patterns

### 5.1 The 8 GB Reality

On a GTX 1070 Ti with 8 GB VRAM, the safe operating envelope is:

| Workload | VRAM Budget | Notes |
|---|---|---|
| Ollama resident model (4B class) | 4.5–5.5 GB | Includes KV cache |
| Ollama resident model (7B class) | 6.5–7.5 GB | No concurrent GPU workload |
| ComfyUI SD 1.5 | 3.5–4.5 GB | Depends on resolution/steps |
| Three.js / WebGL | 0.5–1.5 GB | Browser-side; not CUDA |
| FFmpeg NVENC | 0.2–0.5 GB | Hardware encode |
| CUDA overhead | 0.3–0.5 GB | Driver, blas, cublas |

**Safe concurrent pairings:**
- 4B Ollama + ComfyUI SD 1.5 @ 768×768 ✅
- 4B Ollama + Three.js ✅
- 7B Ollama alone ✅ (no ComfyUI simultaneously)
- 9B Ollama → **never** (OOM guaranteed under load)

### 5.2 Scheduling Rules

1. **One Ollama model resident at a time** — multiple models churn VRAM
   (unload + cold load = 30–100 s penalty).
2. **Offload before GPU jobs** — `vram_manager.py` calls `ollama_adapter`
   activity methods to free VRAM before ComfyUI/3D starts.
3. **Cap `num_ctx` at 16384** — 32K context on 9B models needs ~6 GB KV cache
   alone; clamp to 16K when free VRAM < 6 GB.
4. **Use `keep_alive` for sticky models** — `keep_alive: 10m` prevents cold
   loads between sequential calls.
5. **Disable thinking for structured output** — `think: false` on `gemma4`
   prevents silent constraint drops when using `format: json`.

### 5.3 Implementation: Context Capping in `OllamaAdapter.chat()`

```python
if "num_ctx" in options:
    requested = int(options["num_ctx"])
    if requested > 32768:
        options["num_ctx"] = 32768
    elif requested > 16384:
        logger.warning("num_ctx %d capped to 16384 for 8GB VRAM", requested)
        options["num_ctx"] = 16384
```

---



## 6. Utilization Gaps & Opportunities

### 6.1 Gap: MCP Bridge Model Routing Is Hardcoded

**Current:** `tools/mcp/ollama-tools-mcp.mjs` line 303–305:
```javascript
const body = {
    model: args.model || "qwen3-vl:4b",
    ...
};
```

**Problem:** Always sends `qwen3-vl:4b` regardless of task mode or resident model.
The sophisticated router in `tools/vision/analyze.mjs` is not reused.

**Fix:** Import the `MODEL_PROFILES` / `MODE_MODEL` routing table and
`residentVisionModels()` stickiness logic from `analyze.mjs` into the MCP bridge,
or expose the routing as a shared module.

### 6.2 Gap: Backend Has No MCP Tool Registry Consumer

**Current:** `mcp_validator.py` defines 38 JSON Schema validators but is never
imported. `packages/backend/app/adapters/ollama.py` has 14 built-in tools, but
no schema validation is enforced at runtime.

**Fix:** Wire `mcp_validator.py` into:
- `ollama-tools-mcp.mjs` `tools/call` handler
- `OllamaAdapter.execute_tool_call()`
- Backend API routes that accept tool definitions

### 6.3 Gap: Video Generation Stub

**Current:** `generate_video` MCP tool returns a markdown instruction string.
No actual text-to-video path through Ollama exists.

**Opportunity:** Ollama does not generate video natively. The gap is best filled
by:
1. ComfyUI Wan/LTX workflow (already exists)
2. Or a future Ollama plugin if released

### 6.4 Gap: Music Prompt Generator Isolated from Wizard

**Current:** `music_prompt_generator.py` (833 lines, 4 platforms) runs as a
standalone page at `/music-prompts`. The 5-step wizard (`/music-video-wizard`)
has no prompt-generation step.

**Impact:** Users manually context-switch. The wizard's "Style" step has a
textarea but no "Generate with AI" button.

**Fix:** Add a prompt-generation step to the wizard that calls
`music_prompt_generator.py` with the track's genre, mood, and analysis data.

### 6.5 Gap: No Multi-Model A/B Testing

**Current:** `HardwareBenchmarkRunner` runs one model per benchmark. No
comparison of `qwen3.5:9b` vs `qwen3.5:4b` for the same storyboard prompt.

**Opportunity:** Add a `model_candidates` field to `BenchmarkRequest` that runs
the same prompt against N models and returns a ranked comparison.

---



## 7. Best Practices for This App Context

### 7.1 Prompt Engineering

- **Use `/api/chat`, not `/api/generate`** — `/api/generate` does not support
  tools, system prompts reliably, or multimodal input.
- **Always include `think: false` for structured output** — prevents silent
  constraint drops on `gemma4` when using `format: json`.
- **Keep schemas FLAT** — deeply nested JSON degrades output quality for 4B–9B
  models (arXiv 2609.23742).
- **Temperature 0 for extraction** — OCR, table, chart modes need deterministic
  output, not creative variation.
- **Temperature 0.2–0.3 for generation** — storyboards, scene planning benefit
  from slight variation without losing coherence.
- **One negative example > paragraph of rules** — for small models (3B–4B),
  "do not do X" is more effective than "always do Y".

### 7.2 Tool Calling

- **Narrow the tool list per call** — send only the 5–10 tools relevant to the
  current step, not all 38. (Unity planner already does this: 14 commands.)
- **Flat arguments** — deeply nested tool arguments cause parser failures on
  `gemma4` and `qwen3`.
- **Enable thinking for tool parsing** — `think: true` or `think: "medium"`
  improves tool-call accuracy on small models.
- **Validate semantically after generation** — constrained decoding guarantees
  *valid* JSON, not *correct* values. Always parse and check required fields.

### 7.3 Vision

- **Resize before sending** — screenshots > 1280 px waste tokens and may exceed
  context. Use `sharp` or equivalent to fit within `maxDim`.
- **Use mode-specific prompts** — `ui` mode asks for "list elements + issues";
  `ocr` mode asks for verbatim transcription. Don't use generic "describe this".
- **Append grounding suffix** — the 4-line `GROUNDING_SUFFIX` in `analyze.mjs`
  converts silent hallucinations into routable uncertainty.
- **Enumerate before counting** — "count each item, then state the total"
  prevents confident wrong counts.

### 7.4 Performance

- **`keep_alive: 10m` on resident models** — prevents 30–100 s cold loads.
- **`num_predict` cap at 4096** — short answers stop at EOS; 4096 costs nothing
  extra and avoids truncated generations.
- **Retry same model on `done_reason == "length"` only** — model swaps churn
  VRAM (unload + cold load = 30–100 s).
- **Stream for UX** — use `stream: true` for long generations; accumulate
  `thinking`, `content`, and `tool_calls` separately.
- **Batch embeddings** — use `/api/embed` with an array of inputs when possible
  (Ollama 0.33+ supports batching).

---



## 8. Recommended Expansion

### 8.1 Immediate (P0)

| Action | Why | Effort |
|---|---|---|
| Convert `qwen3.5:9b` and `ornith-1.5:9b` to GGUF Q4_K_M | 9B models currently fp16 (~6.6 GB); GGUF Q4_K_M would halve VRAM to ~3.5–4.5 GB | 2–4h |
| Wire `mcp_validator.py` into MCP bridges | Agents still invent invalid commands | 2–4h |
| Add prompt-generation step to wizard | Music prompt generator is an island | 2h |

### 8.2 Short-term (P1)

| Action | Why | Effort |
|---|---|---|
| Share vision routing between MCP bridge and `analyze.mjs` | MCP always sends `qwen3-vl:4b`; wastes 4B/9B model capability | 2h |
| Expose streaming SSE for Ollama chat endpoints | Long generations block HTTP; streaming improves UX | 4–6h |
| Add multi-model benchmark comparison | No A/B testing for storyboard/scene quality | 4h |
| Wire `generate_video` MCP tool to ComfyUI | Stub returns instructions, not a job | 2h |

### 8.3 Medium-term (P2)

| Action | Why | Effort |
|---|---|---|
| Add `ollama-model` selector to frontend settings | Currently hardcoded in `config/settings.json` | 4h |
| Build benchmark dashboard | Benchmark data stored but never aggregated in UI | 4–8h |
| Evaluate `openbmb/minicpm-v4.6:q4_K_M` for tool calling | 752M params, 1.53 GB — smallest capable model | 2h |
| Test `qwen3.5:9b` GGUF Q4_K_M conversion | Would make 9B quality 8GB-safe | 4h |

---



## 9. Cross-References

- [[ollama-prompting-2026]] — Vision prompts, structured output, latency policy
- [[ollama-benchmarks]] — Three.js scene generation benchmark
- [[integration-ollama]] — API endpoints, tool calling, agent loop patterns
- [[hardware-verified-models]] — 8GB VRAM model matrix, AnimateDiff LoRAs
- [[pascal-gpu-optimization-2026]] — GTX 1070 Ti constraints
- [[mcp-contracts-2026]] — 38-tool schema registry (not yet enforced)
- [[app-research-gaps-2026]] — Research priorities including model sweep
- [[feature-utilization-audit-2026]] — Dead code and orphaned capabilities

---



## 10. Quick Reference Card

### One-liner for Common Tasks

```bash
# List installed models
ollama list

# Pull a new model
ollama pull qwen3.5:4b

# Run with structured JSON output
ollama chat gemma4:e2b-it-qat --format json

# Run with thinking
ollama chat qwen3.5:9b --think high

# Check VRAM usage
nvidia-smi

# Check resident models
ollama ps
```

### Backend Code Patterns

```python
# Chat with VRAM-safe defaults
response = await adapter.chat(
    messages=[{"role": "user", "content": prompt}],
    model="qwen3.5:4b",
    think=False,
    num_ctx=8192,
    keep_alive="10m",
)

# Structured output (Ollama 0.33+)
response = await adapter.chat(
    messages=messages,
    model="gemma4:e2b-it-qat",
    format="json",
    think=False,
)

# Tool calling
response = await adapter.chat(
    messages=messages,
    model="qwen3.5:9b",
    tools=tool_definitions,
    think="medium",
)
```

### Frontend Code Patterns

```typescript
// Vision analysis (reuse analyze.mjs routing)
const model = await resolveModel({ mode: 'ui' }, forcedModel);
const response = await fetch(`${OLLAMA_URL}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt, images: [imageData] }],
    stream: false,
    keep_alive: '10m',
    think: false,
  }),
});
```

---



*Last updated: 2026-09-24*
