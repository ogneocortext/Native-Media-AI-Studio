---
tags:
  - production
  - audio
aliases:
  - ACE-Step Agent Drive
  - Music Agent Handoff
cssclasses:
  - production-guide
date: 2026-10-22
type: concept
---

# Driving ACE-Step from an agent — the local "music agent" pattern

> [!info] Purpose
> Owner saw the "ACE-Step AI agent" coverage on YouTube (2026-10-22)
> and asked whether it can be implemented locally. Short answer: the
> engine half already runs here — ACE-Step 1.5 is the studio's wired
> music-generation service. This doc specifies how an agent drives it
> end-to-end, what the agent must supply itself, and the four checks
> (A1–A4, next-actions Step 6) that close the gap to the video's
> one-line-idea experience.

## 1. What the "agent" in the videos is — and what we already have

ACE-Step 1.5 is a hybrid: a small **language model plans** the song
(captions, lyrics, BPM, key, duration, structure) and a **Diffusion
Transformer renders** the audio from that plan. The "agent" framing
in the coverage is that LM planner plus a client that calls it.

Our stack already runs the renderer as an isolated GPU service:

- `tools/music-gen/server.py` — FastAPI wrapper around the vendored
  ACE-Step 1.5 checkout (`tools/music-gen/ACE-Step-1.5/`, gitignored),
  started with `python server.py --port 8201 --engine ace` or
  `tools/music-gen/start-service.ps1 -Engine ace -Background`
  (VramBudget default 6 GB on 8 GB hardware).
- `packages/backend/app/api/music_gen.py` — the backend router
  (prefix `/api/music-gen`, line 35) that manages the service
  lifecycle and VRAM coordination on the backend's behalf.
- `packages/backend/app/adapters/music_gen.py` — backend → service
  client; `DEFAULT_PORTS = {"ace": 8201}` (line 45), base URL
  `http://127.0.0.1:8201`.

**The gap:** neither API exposes the LM planner. Both `/generate`
surfaces require finished `style` + `lyrics` — there is no endpoint
that takes a one-line idea. In this stack the *driving agent plays
the planner role* (draft the style text and structured lyrics, call
generate, critique, iterate). That is a feature, not a workaround:
the driving agent is a stronger planner than the 0.6B local LM. A1
checks whether the vendored handler can also expose ACE-Step's own
LM for owners who want the fully-local variant.

## 2. The two drive surfaces

Prefer the **backend** surface: it owns start/stop and coordinates
VRAM with the rest of the studio. Drive the **service** directly
only for debugging — it bypasses VRAM coordination, so never run it
concurrently with ComfyUI/video workloads.

| Step | Backend (`/api/music-gen`) | Service (`127.0.0.1:8201`) |
|---|---|---|
| Liveness | `GET /status` | `GET /health` → `{status, engine, loaded, model}` |
| Start | `POST /start` `{engine, port?, vram_budget_mb?}` | start the process (see §1) |
| VRAM | `GET /vram` | `GET /vram` → `{total_mb, free_mb, used_mb, percent}` |
| Generate | `POST /generate` | `POST /generate` |
| Fetch audio | `GET /audio/{output_name}` | `GET /audio/{output_name}` (flac → wav → mp3) |
| Fetch score | `GET /score/{output_name}` (ABC notation) | — |
| Release VRAM | `POST /unload`, `POST /stop`, `POST /stop-all` | `POST /unload`, `POST /reload` |

`POST /generate` body (identical fields both surfaces; the backend
adds `engine`):

| Field | Rules | Notes |
|---|---|---|
| `style` | required, 1–2000 chars | Genre, instruments, mood, tempo, vocal type. **BPM/key live here** — there are no numeric tempo/key parameters. |
| `lyrics` | required, 1–10000 chars | Full text with `[Verse]` / `[Chorus]` / `[Bridge]` tags. |
| `seed` | optional int | Pass it explicitly for reproducible takes; the response echoes the seed actually used. |
| `cfg_scale` | 7.0 default, 0.5–20 | Classifier-free guidance. |
| `inference_steps` | 8 default, 1–200 | 8 is the turbo schedule the defaults ship with. |
| `output_name` | optional | `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`; defaults to `ace_<8 hex>`. Use a slug — it becomes the on-disk directory and the fetch key. |

Response: `{audio_path, seed, sample_rate, output_name, engine}`.
Audio lands at `<repo>/output/music/<output_name>/audio.wav`
(sample rate from the model, 48000 default). **There is no duration
parameter** — length is a property of the model config
(`acestep-v15-sft`, overridable via the `ACESTEP_MODEL_ID` env var);
see A3.

## 3. Tier 3 / Pascal contract (already implemented — do not regress)

From `tools/music-gen/server.py` and
`docs/knowledge-library/music-gen-hardware-fit-2026.md` (GTX 1070 Ti,
8 GB, sm_61 = Tier 3: 2B turbo DiT + 0.6B LM, `pt` backend):

- Engine init: `use_flash_attention=False` (SDPA fallback),
  `compile_model=False` (Triton needs sm_70+), `offload_to_cpu=True`,
  `offload_dit_to_cpu=True`, `quantization="int8_weight_only"`.
- Env hardening before torch import: `TORCH_CUDA_ARCH_LIST=6.1`,
  `PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:128`,
  `TORCHINDUCTOR_USE_TRITON=0`, `ACESTEP_DTYPE=float32`, plus a
  post-init dtype override to float32 — fp16 overflows on Pascal and
  produces NaN/Inf latents.
- Generation: `task_type="text2music"`, `use_tiled_decode=True`.
- One generation at a time on 8 GB. Batches fill VRAM; the backend's
  VRAM manager exists precisely to arbitrate this.

## 4. The agent loop

1. **Plan (agent = planner).** Draft `style` (≤2000 chars, state the
   BPM/key in text) and `lyrics` (≤10000 chars, section-tagged).
   Reuse what exists: keeper lyric sets in
   `packages/frontend/public/track-lyrics/`, and the Suno templates
   Preflight rules (no instruction text inside the lyrics field —
   it gets sung).
2. **Preflight.** `GET /status` (or `/health`); if the service is
   down, `POST /start` on the backend. `GET /vram` — do not start a
   generation that does not fit the budget.
3. **Generate.** `POST /generate` with an explicit `seed` and a slug
   `output_name`. Record the returned seed with the take.
4. **Fetch + critique.** `GET /audio/{output_name}`; `GET
   /score/{output_name}` where a score exists. Run the studio
   analyzer on the WAV before judging tempo: the 2026-10-22
   ground-truth pass proved prompt BPM is intent, not fact (a
   "locked 140 BPM" prompt rendered at a measured 103.4) — the
   measured grid wins, per
   [[storyboard-enrichment-from-track-practice-2026]] R1.
5. **Iterate or accept.** New seed / revised style, same loop.
   Draft → review → explicit build stays the studio rule: agent
   output is a draft until the owner accepts it as a track.
6. **Release.** `POST /unload` (or `/stop`) so the VRAM returns to
   the visualizer/video workloads.

## 5. Sample calls (PowerShell, owner's machine)

```powershell
# Preflight — backend liveness + VRAM
Invoke-RestMethod http://localhost:8000/api/music-gen/status
Invoke-RestMethod http://localhost:8000/api/music-gen/vram

# Start the engine if needed (backend manages the subprocess)
Invoke-RestMethod -Method Post http://localhost:8000/api/music-gen/start `
  -ContentType 'application/json' -Body '{"engine":"ace"}'

# Generate — direct to the service (same body works on the backend
# surface, which adds lifecycle + VRAM coordination)
$body = @{
  style  = "Driving synth-pop, 128 BPM, bouncy synth bass, bright plucky leads, crisp percussion, playful male vocal"
  lyrics = "[Verse]`nNeon on the dashboard, midnight on the run`nCoffee gone cold but the night is young`n`n[Chorus]`nKeep the headlights on, keep the rhythm tight`nWe ride the white lines through the desert night"
  seed   = 424242
  output_name = "agent-smoke-001"
} | ConvertTo-Json
Invoke-RestMethod -Method Post http://127.0.0.1:8201/generate `
  -ContentType 'application/json' -Body $body

# Fetch the audio, then release the VRAM
Invoke-WebRequest http://127.0.0.1:8201/audio/agent-smoke-001 -OutFile .\agent-smoke-001.wav
Invoke-RestMethod -Method Post http://127.0.0.1:8201/unload
```

(The backend's own port is whatever the studio is configured with —
`localhost:8000` above is the conventional default; the service's
8201 is fixed by `DEFAULT_PORTS`.)

## 6. Guardrails

- **Localhost only.** Both surfaces bind 127.0.0.1. Do not rebind to
  0.0.0.0 — the home LAN is shared, and an open generate endpoint is
  an open GPU bill.
- **Seeds are the take log.** An unseeded generation cannot be
  reproduced; the response's `seed` is the minimum provenance for
  any take the owner might keep.
- **Measured over stated.** Any tempo/key claim about a generated
  take comes from the analyzer, never from the prompt that requested
  it (2026-10-22 ground-truth pass).
- **Expect sketchpad quality.** Ecosystem coverage is consistent
  that ACE-Step output still sits below Suno's; on this hardware a
  ~75 s song takes on the order of 3 minutes (A2 replaces that
  estimate with a local measurement). The lane is local, private,
  unlimited iteration — not a Suno replacement.

## 7. Open checks for the implementing agent (next-actions Step 6)

- **A1 — LM planner exposure.** Inspect the vendored handler
  (`tools/music-gen/ACE-Step-1.5/`) for LM task types (caption /
  lyrics drafting upstream of `text2music`). If supported, propose a
  `/plan` endpoint design; if not, the agent-as-planner pattern in
  §4 stands as the design.
- **A2 — Windows smoke test.** Full loop on the owner's machine:
  start → generate (defaults) → fetch → unload, recording wall time
  and peak VRAM on the GTX 1070 Ti. Replaces the §6 estimate.
- **A3 — Duration control.** `/generate` has no duration parameter
  today. Document what governs output length under
  `acestep-v15-sft`, and propose the smallest change if the owner
  wants explicit durations (config, style-text convention, or a
  request field plumbed to the handler).
- **A4 — Thin agent CLI (optional).** A `generate / status / unload`
  wrapper against the backend API, mirroring the agent-first CLI
  pattern from the ecosystem — only if A2 shows the raw HTTP loop is
  friction in practice.

## Sources

- `tools/music-gen/server.py` (service surface, engine init, Pascal
  hardening) and `tools/music-gen/start-service.ps1` (VramBudget).
- `packages/backend/app/api/music_gen.py` (router prefix line 35,
  request models, score endpoint), `packages/backend/app/adapters/music_gen.py`
  (port map line 45, lifecycle).
- `docs/knowledge-library/music-gen-hardware-fit-2026.md` (Tier 3
  definition for this exact hardware).
- ACE-Step 1.5 overview (LM planner + DiT design):
  https://acestep.io/ace-step-15 — and the 8 GB local-generation
  guide: https://acuanticopower.com/en/local-ai-music-generation-8gb/
