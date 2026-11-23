# Local model inventory and management rules

Moved out of `AGENTS.md` on 2026-11-21. This table changes whenever a model is
pulled or pruned, so it is checked against `ollama list` by
`tools/check-doc-facts.py` and kept here rather than in the file every agent
loads. Trust tiers - which model may be given which work - live separately in
`tools/model-reliability/roster.md`.

**Last verified: 2026-11-08** — Run `ollama list` before any model operation.

### Currently Installed Local Models (Ollama)

| Model | Size | Purpose | Status | Verified |
|-------|------|---------|--------|----------|
| `gemma4:e2b-it-qat` | 4.3 GB | Vision (primary) | ✅ Installed | 2026-11-08 |
| `qwen3-vl:4b-instruct` | 3.3 GB | Vision (heavyweight QA) | ✅ Installed | 2026-11-23 |
| `moondream:latest` | 1.7 GB | Vision (lightweight) | ✅ Installed | 2026-11-08 |
| `nomic-embed-text:v1.5` | 274 MB | Embedding (primary) | ✅ Installed | 2026-11-08 |
| `nomic-embed-text:latest` | 274 MB | Embedding (latest) | ✅ Installed | 2026-11-08 |
| `embeddinggemma-2:270m` | 303 MB | Embedding (fallback) | ✅ Installed | 2026-11-08 |
| `llama3.1:8b` | 4.9 GB | Chat/Reasoning | ✅ Installed | 2026-11-08 |
| `qwen3.5:4b` | 3.4 GB | Chat/Reasoning | ✅ Installed | 2026-11-08 |
| `llama3.2:3b` | 2.0 GB | Chat (lightweight) | ✅ Installed | 2026-11-08 |
| `ibm/granite4.2:3b` | 2.2 GB | Chat/Reasoning | ✅ Installed | 2026-11-08 |
| `hf.co/lmstudio-community/Bonsai-27B-GGUF:Q1_0` | 4.7 GB | Chat/Reasoning (27B at Q1_0, extreme-quant GGUF; ~7.6 GB resident at 8K ctx) | ✅ Installed | 2026-11-21 |

**Cloud/Atomic Chat Models (not local):**
- `glm-5.3:cloud`, `muse-spark-open:cloud`, `minimax-m3.1-flash:cloud`, `beam:cloud`, `deepseek-v4.1-flash:cloud` — Atomic Chat cloud (remote, no local VRAM)
- `unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M` — Atomic Chat local GGUF (port 1337)

### ⛔ MANDATORY: Check Before Download Rules

**NEVER download a model without verifying first.** This is non-negotiable.

1. **Run `ollama list`** — Confirm the model isn't already installed
2. **Check `config/settings.json`** — Verify `embedding_model` and other configured models
3. **Check `tools/model-reliability/roster.md`** — Verify tier and route compatibility
4. **Check `tools/model-reliability/observed.jsonl`** — Recent evidence for the model/route
5. **Only if absent** — Proceed with download using verified URLs from this doc

**Violations observed:** Multiple agents downloaded `gemma4:e2b-it-qat`, `nomic-embed-text`, `dexed`, `surge-xt` despite being pre-installed. This wastes bandwidth, corrupts configs, and wastes tokens.

### Model Selection Criteria (Task-Based)

| Task Category | Primary Model | Fallback | Route | VRAM Budget |
|---------------|---------------|----------|-------|-------------|
| **Vision (primary)** | `gemma4:e2b-it-qat` (4.3 GB) | `qwen3.5:4b` (3.4 GB) | Local/Ollama | ~4.5 GB |
| **Vision (lightweight/opt-in)** | `moondream:latest` (1.7 GB) | — | Local/Ollama | ~2 GB |
| **Embedding (primary)** | `nomic-embed-text:v1.5` (274 MB) | `embeddinggemma-2:270m` | Local/Ollama | ~0.5 GB |
| **Chat/Reasoning (heavy)** | `llama3.1:8b` (4.9 GB) | `qwen3.5:4b` (3.4 GB) | Local/Ollama | ~5 GB |
| **Chat/Reasoning (light)** | `qwen3.5:4b` (3.4 GB) | `llama3.2:3b` (2.0 GB) | Local/Ollama | ~3.5 GB |
| **Embedding (fallback)** | `embeddinggemma-2:270m` (303 MB) | `nomic-embed-text:latest` | Local/Ollama | ~0.5 GB |
| **Vision (lightweight/alt)** | `moondream:latest` (1.7 GB) — opt-in only, never auto-routed | — | Local/Ollama | ~2 GB |
| **Chat (Atomic Chat)** | `unsloth/Qwen3_5-4B-GGUF` | — | Atomic Chat (port 1337) | CPU/GPU |

**Route Selection Rules:**
- **Local/Ollama** — Default for all local models (ports 11434)
- **Atomic Chat (port 1337)** — Only for `unsloth/Qwen3_5-4B-GGUF` GGUF
- **Cloud routes** — Only for cloud models explicitly listed (`glm-5.3:cloud`, etc.)

### Resource Management Rules (Critical for 8GB VRAM / System RAM)

**Hardware Constraints:**
- **GPU:** GTX 1070 Ti (8 GB VRAM, Pascal sm_61)
- **System RAM:** Monitor closely — **98% = crash threshold**
- **CPU:** 80% sustained = thermal throttle risk

**Process Management Rules:**
1. **One heavy model at a time** — Unload before loading another >2 GB model
2. **Ollama keep-alive** — Set `OLLAMA_KEEP_ALIVE=5m` to avoid repeated loads
3. **Monitor before load** — Run `nvidia-smi` and check system RAM before loading >2 GB models
4. **Unload explicitly** — `ollama stop <model>` when done with heavy models
5. **Sequential processing** — Never run multiple heavy models simultaneously

**VRAM Budget per Operation:**
| Operation | Max VRAM | Action if Exceeded |
|-----------|----------|-------------------|
| Vision (gemma4:e2b) | ~4.5 GB | Stop, unload others |
| Chat 8B (llama3.1:8b) | ~5 GB | Use qwen3.5:4b instead |
| Embedding | <1 GB | Safe to run with others |
| Embedding + Vision | ~5.5 GB | Sequential only |

**Process Loading/Unloading Protocol:**
```powershell
# Before loading heavy model
nvidia-smi  # Check VRAM
ollama stop <other_heavy_model>  # Free VRAM
ollama run gemma4:e2b-it-qat  # Load

# After done
ollama stop gemma4:e2b-it-qat  # Explicit unload
```

**Ollama Config for Stability:**
```yaml
# In Ollama config or env vars
OLLAMA_KEEP_ALIVE=5m
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_FLASH_ATTENTION=1
```

### Model Tier Enforcement (from tools/model-reliability/roster.md)

| Tier | Models | Usage Rule |
|------|--------|------------|
| **A — Delegate** | Nemotron 3.5 Super VL (kilo), StepFun Step 5, Ling 3.1 Flash, Devin | Real work, structural changes, refactors |
| **B — Scoped** | DeepSeek V4.1 Flash, Sonnet 4.5/4.6, MiMo V2.6, Kilo Auto | Task-file items with explicit acceptance check |
| **C — Supervised** | Beam 1.0, Flint, GPT-6 Luna | Boilerplate/docs only, every diff reviewed |
| **Avoid** | Nemotron 3 Ultra/Nano/Super, Nemotron 3.5 Lightning, Kilo free listings | Do not use |

**Route-specific trust** (from roster): Same model on different routes = different tier. Kilo-routed Nemotron 3.5 Super VL = Tier A; free listings = Avoid.

### First-Contact Rule (from roster.md)

**Every new model's first job = smallest open task file item with known acceptance check.**
- Pass → Log outcome, provisional Tier B
- Fail (capability) → Tier C
- Fail (availability) → Tier Avoid

### Agent Onboarding Protocol (for model rotation)

When a new agent/model joins:
1. **Run `ollama list`** — Verify local inventory
2. **Check roster.md** — Confirm tier for assigned route
3. **Run first-contact task** — Smallest open task file item
4. **Log outcome** in `tools/model-reliability/observed.jsonl`
5. **Update roster.md** if tier changes

### Quick Reference: Which Model for What

| Need | Command |
|------|---------|
| Vision analysis (primary) | `ollama run gemma4:e2b-it-qat` |
| Quick vision (low VRAM) | `ollama run moondream:latest` |
| Embeddings (primary) | `ollama run nomic-embed-text:v1.5` |
| Chat/Reasoning (complex) | `ollama run llama3.1:8b` |
| Chat/Reasoning (fast) | `ollama run qwen3.5:4b` |
| Embeddings (fallback) | `ollama run embeddinggemma-2:270m` |
| Quick chat (low VRAM) | `ollama run llama3.2:3b` |
| Atomic Chat | `atomic-chat` (port 1337) |

### Services

- Start: `scripts\start-services.ps1` (backend + frontend, dynamic ports → `config/ports.json`).
- Status: `scripts\manage-servers.ps1 -Action status`
- Interactive: `scripts\start-studio.ps1`
- Ports: `scripts\check-ports.ps1`

Atomic Chat starts automatically with `start-services -Services all` (it's in the default service list). It runs on port 1337 (`atomic_chat_url` in `config/ports.json`) and serves your unsloth Qwen GGUF model (`unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M`). Ollama runs separately on port 11434. The backend chat endpoint routes through Atomic Chat when `atomic_chat_enabled` is true, falling back to Ollama on error.

### Critical Notes

- **Never commit/hand-edit** compiled `vite.config.js` / `vite.config.d.ts` in `packages/frontend/` — it shadows `vite.config.ts`.

- **Installation policy:** AI models must only install applications the user has explicitly requested. Before any download or install, first check what is already installed on this machine (e.g. Atomic Chat, Ollama, Unity, ComfyUI, Blender, Remotion). Do not re-download, re-install, or suggest alternatives to software the user maintains themselves. Atomic Chat is already installed and self-maintained — do not download `Atomic.Chat_2.1.2_x64-setup.exe` or any other installer without an explicit user request.
