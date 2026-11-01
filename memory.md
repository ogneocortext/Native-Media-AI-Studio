# Native Media AI Studio — Agent Memory for Qwen3.5-4B (Atomic Chat)

> **Purpose:** This file is the long-term memory store for the NMA agent running
> Qwen3.5-4B via Atomic Chat (`http://127.0.0.1:1337/v1`). It is read by the
> agent's System 1 (retrieval-augmented response) and updated by System 2
> (reflection + credit assignment) after every completed episode.
>
> **Token budget:** Keep this file under ~4,000 tokens. If it grows beyond
> that, summarize older entries into the "Condensed Learnings" section and
> archive the full history to `output/agent-memory/archive/`.

---

## 1. API Spec Reference (read-only)

Base URL: `http://127.0.0.1:8000`  
Auth: none (local)

### Endpoints the agent can call

| Method | Path | Purpose | Key params |
|--------|------|---------|------------|
| GET | `/api/health` | Backend + adapter health | — |
| POST | `/api/audio/upload` | Upload audio file | `file` (multipart) |
| POST | `/api/audio/analysis` | Analyze audio (BPM, beats, sections, energy) | `filename` |
| GET | `/api/outputs` | List all media outputs | `file_type`, `search`, `limit`, `offset` |
| GET | `/api/music-gen/status` | ACE-Step service status | — |
| POST | `/api/music-gen/start` | Start ACE-Step service | `engine`, `vram_budget_mb` |
| POST | `/api/music-gen/generate` | Generate music from style + lyrics | `style`, `lyrics`, `seed`, `cfg_scale`, `inference_steps`, `output_name` |
| GET | `/api/audio/file/{name}` | Get playable audio URL | `name` |
| GET | `/api/audio/remix/` | List remixes | — |
| POST | `/api/audio/remix/preview` | Preview mashup recipe | `recipe` |
| POST | `/api/audio/remix/build` | Build remix from stems | `recipe` |
| POST | `/api/audio/remix/{name}/enhance` | Master a remix | `name` |
| GET | `/api/ollama/chat` | LLM chat with tools | `message`, `tools`, `model`, `system`, `history`, `max_tool_calls`, `think` |

### Common response shapes

**Generate:** `{"audio_path": "...", "output_name": "...", "sample_rate": 48000, "duration": 180.5}`  
**Analysis:** `{"bpm": 128.5, "beats": [...], "sections": [...], "energy": 0.72}`  
**Outputs:** `{"outputs": [...], "total": N, "audio_count": N}`

---

## 2. Successful Patterns (what works)

### Audio analysis → music generation pipeline
1. `POST /api/audio/upload` → get filename
2. `POST /api/audio/analysis` → extract BPM, sections, energy
3. Use BPM to set `inference_steps` and `cfg_scale` for generation
4. `POST /api/music-gen/generate` with style derived from analysis energy
5. Result includes `audio_path` → frontend can play via `GET /api/audio/file/{name}`

### VRAM management (GTX 1070 Ti, 8 GB)
- ACE-Step needs ~6 GB VRAM
- ComfyUI holds ~5.3 GB when loaded
- Ollama/Atomic Chat ~1.7 GB
- Before music gen: `begin_music_generation()` offloads Ollama + idle ComfyUI
- After music gen: `end_music_generation()` reloads Ollama when free VRAM > 1200 MB
- Never exceed 6144 MB budget for music generation

### Tool-calling with Qwen (XML format)
Qwen3.5-4B via Atomic Chat uses the OpenAI-compatible `/v1/chat/completions` endpoint.
Tool calls use the standard OpenAI `tool_calls` format (not XML tags directly).
System prompt should instruct: "Call ONE tool at a time, wait for result, then decide next step."

---

## 3. Failed Patterns (what does NOT work)

| Pattern | Why it fails | Fix |
|---------|-------------|-----|
| Calling multiple tools in parallel | Qwen 4B struggles with parallel tool execution; results get mixed up | One tool per turn, sequential |
| Thinking mode for tool turns | Thinking content confuses tool parser; increases latency | Use `enable_thinking: false` or non-thinking mode for tool calls |
| High temperature on tool turns | Non-deterministic JSON causes parser failures | temperature 0.0 for tool selection |
| Exceeding 6 GB VRAM budget | OOM crash, generation fails | Offload ComfyUI/Ollama first via `begin_music_generation()` |
| Starting generation without analysis | Style guesses are poor; BPM mismatch | Always analyze audio first |

---

## 4. Condensed Learnings (self-improvement loop)

> Updated by System 2 after each completed episode. Entries here are the
> agent's accumulated wisdom about what works in this specific environment.

### Episode learnings

- **2026-10-27:** Atomic Chat wins cold first-token (5,815ms vs 12,081ms for Ollama). Use Atomic Chat as default LLM driver for synchronous agent calls.
- **2026-10-27:** ACE-Step agent-drive A2 smoke test succeeded: generate → fetch → unload in ~3 min, ~2.7 GB VRAM peak.
- **2026-10-27:** Canvas2DVisualizer.tsx fully decomposed into shockwaves.ts, idleParticles.ts, particles.ts, canvas2dModes.ts (12 modes), services/frameAccurateCanvas2d.ts.
- **2026-10-27:** Media library search now matches tag names; tag filter pill added to FilterBar.

### Environment constants

- Backend: `http://127.0.0.1:8000`
- Atomic Chat: `http://127.0.0.1:1337/v1`
- Ollama: `http://127.0.0.1:11434`
- Default model: Qwen3.5-4B (Q4_K_M GGUF)
- VRAM budget for music: 6144 MB
- VRAM threshold to reload Ollama: 1200 MB

---

## 5. Database Schema Notes (for SQL access)

Tables the agent can query directly via SQLite:

- `audio_files` — uploaded audio with filename, duration, bpm, key, genre
- `prompts` — music generation prompts with style, lyrics, output_path
- `generation_sessions` — track generation progress and output paths
- `media_favorites` / `media_tags` / `media_collections` — library organization
- `tracks` — music library tracks with stem availability
- `ollama_analysis_responses` — cached audio analysis results

Database location: `output/nma.db` (SQLite, WAL mode)

---

## 6. System Prompt for Qwen (copy into agent system message)

```
You are the Native Media AI Studio agent. You drive the music video creation
pipeline through the backend REST API at http://127.0.0.1:8000.

You have access to the following tools (call ONE at a time, wait for result):
- health: check backend health
- audio_upload: upload a local audio file
- audio_analyze: extract BPM, beats, sections, energy from audio
- audio_list: list all audio outputs
- music_gen_status: check ACE-Step service status
- music_gen_start: start ACE-Step generation service
- music_gen_generate: generate music from style + lyrics
- remix_list / remix_preview / remix_build / remix_enhance: remix operations
- media_list: list media files in outputs

Workflow principles:
1. Always analyze audio before generating music (use BPM to inform generation params)
2. One tool call per turn — never parallel tool calls
3. Check VRAM before music generation (begin_music_generation handles offloading)
4. After a successful generation, the result includes relative_path for the frontend
5. Store learnings in memory.md so future episodes don't repeat mistakes

Be concise. Tool turns: temperature 0.0, max 128 tokens. Final answers: crisp.
```

---

## 7. Memory Maintenance

- **After every completed episode:** System 2 writes a new entry to section 4
- **When section 4 exceeds ~20 entries:** Summarize into "Condensed Learnings" and archive
- **When the API changes:** Update section 1 immediately
- **When a pattern fails:** Add to section 3 with the fix
