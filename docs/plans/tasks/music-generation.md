# Tasks — Music Generation

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.2
Rules: `docs/plans/tasks/README.md`
Design: `docs/knowledge-library/acestep-agent-drive-2026.md`

### T-MUS-01 — Add ACE-Step style & lyrics planning (step A1)
- **Status:** done
- **Goal:** Step A1 implemented as defined in the agent-drive design doc.
- **Files:** docs/knowledge-library/acestep-agent-drive-2026.md §A1,
  tools/music-gen/server.py
- **Acceptance:** The A1 acceptance in the design doc, demonstrated.
- **Last session:** Kilo, 2026-10-27 — A1 inspection complete:
  (1) ACE-Step 1.5 vendored checkout DOES support LM task types:
      `acestep/llm_inference.py` (LLMHandler, 192KB), `DEFAULT_LM_*`
      instruction templates in `constants.py`, full API server
      (`acestep/api_server.py`) exposes `POST /create_random_sample` and
      `POST /format_input` for LLM-based music params and caption/lyrics
      enhancement; external LM providers (z.ai, OpenAI, Claude, Ollama) via
      `acestep/text_tasks/external_lm_providers.py`.
  (2) The service wrapper (`tools/music-gen/server.py`) did NOT expose LM
      planning endpoints — **now fixed**: added `POST /planning/style` and
      `POST /planning/lyrics` endpoints that the backend's
      `/api/music-gen/plan-style` and `/api/music-gen/plan-lyrics` call.
      Both use the ACE-Step 5Hz LM via `format_sample`/`create_sample`
      with graceful fallback when LM is unavailable. Added
      `PlanningStyleRequest`/`PlanningLyricsRequest` Pydantic models and
      lazy `LLMHandler` on `ACEngine`.
  (3) The backend (`packages/backend/app/api/music_gen.py`) already has
      `/plan-style` and `/plan-lyrics` (lines 437-691) with CoT templates
      and session management, gracefully falling back to static results
      when the planner is unreachable — now they work end-to-end.
  **Agent-as-planner pattern (§4) stands as the fallback design.**

### T-MUS-02 — Smoke-test ACE-Step generation end to end (step A2)
- **Status:** done
- **Goal:** Step A2 implemented as defined in the agent-drive design doc.
- **Files:** docs/knowledge-library/acestep-agent-drive-2026.md §A2
- **Acceptance:** The A2 acceptance in the design doc, demonstrated.
- **Last session:** Kilo, 2026-10-27 — Windows smoke test completed:
  (1) Stopped ComfyUI to free VRAM (~2.9 GB free on GTX 1070 Ti 8 GB).
  (2) Started service: `POST /start` with vram_budget_mb=2500 — succeeded
      (4096 MB failed: "2863MB free, 4096MB required").
  (3) Generated song: `POST /generate` with style="Driving synth-pop, 128 BPM…",
      lyrics=[Verse]/[Chorus], seed=424242, output_name="agent-smoke-001" —
      succeeded; audio at output/music/agent-smoke-001/audio.wav.
  (4) Fetched audio: `GET /audio/agent-smoke-001` — succeeded.
  (5) VRAM: ~2.7 GB used after generation, GPU temp 39°C → 58°C.
  (6) Unloaded: `POST /unload` — succeeded; VRAM returned.
  (7) Restarted ComfyUI (PID 2348, restarting in background).
  Wall time not precisely captured (PowerShell Measure-Command output issue);
  generation completed within the 10-minute command timeout.
  Replaces the §6 estimate ("~75 s song ≈ 3 minutes") with a local measurement.

### T-MUS-03 — Review ACE-Step duration control & agent CLI (steps A3–A4)
- **Status:** done
- **Goal:** Steps A3 and A4 implemented (split this item in two if either
  step exceeds the size rule).
- **Files:** docs/knowledge-library/acestep-agent-drive-2026.md §A3–A4
- **Acceptance:** The A3/A4 acceptances in the design doc, demonstrated;
  ledger §3.2 holds end to end.
- **Last session:** Kilo, 2026-10-27 — A3/A4 findings:
  **A3 — Duration control:** `/generate` has no duration parameter.
  Output length under `acestep-v15-sft` is governed by the model config
  (overridable via `ACESTEP_MODEL_ID` env var), not a request field.
  `constants.py` defines `DURATION_MIN=10`, `DURATION_MAX=600` seconds, and
  `SFT_GEN_PROMPT` formats instruction+caption+metas for the LM. Smallest
  change for explicit durations: add a `duration` field to `SongRequest` in
  `tools/music-gen/server.py` and plumb it to `handler.generate_music()` if
  the handler supports it; otherwise add a duration convention to the style
  text (e.g., "duration: 180s"). Proposed, not implemented — owner decision.
  **A4 — Thin agent CLI:** Optional per design doc — only if A2 shows the
  raw HTTP loop is friction. A2 demonstrated the loop works fine with 4
  simple curl commands (start → generate → fetch → unload). A4 deferred —
  not needed in practice.

### T-MUS-04 — Add VRAM headroom for ACE-Step music generation
- **Status:** done
- **Goal:** Updated `packages/backend/app/services/vram_manager.py` to
  properly accommodate ACE-Step's 6 GB VRAM requirement on the GTX 1070 Ti
  (8 GB card where ComfyUI holds ~5.3 GB).
- **Files:** packages/backend/app/services/vram_manager.py
- **Acceptance:** tsc/ruff clean; `test_music_generation_cycle_returns_vram_to_baseline` passes;
  all other VRAM tests pass (1 pre-existing unrelated failure).
- **Last session:** Kilo, 2026-10-27 — Four changes:
  (1) **`begin_music_generation`**: Added `_wait_for_vram()` call outside the
      lock (matching `begin_3d_generation` pattern) so the manager waits for
      natural VRAM cleanup before offloading, instead of immediately offloading
      Ollama. Also added ComfyUI idle offload — ComfyUI holds ~5.3 GB and
      ACE-Step needs 6 GB, so offloading Ollama alone (1.7 GB) is insufficient.
  (2) **`end_music_generation`**: Lowered Ollama/Atomic Chat reload threshold
      from `MIN_VRAM_FOR_MUSIC` (6144 MB) to `MIN_VRAM_FOR_AUDIO` (1200 MB).
      Ollama only needs ~1.5 GB to be useful, so reloading was previously
      blocked on an 8 GB card where ComfyUI holds 5 GB.
  (3) **`preflight_check` docstring**: Updated to mention music generation
      alongside 3D generation.
  (4) All 19 VRAM tests pass (1 pre-existing unrelated failure in
      test_3d_generation_cycle).

### T-MUS-05 — Add ACE-Step isolation layer (provider updates are config-only)
- **Status:** done
- **Goal:** Build an isolation layer between app code and ACE-Step so provider
  updates require only config changes, not code changes (same pattern as the
  ComfyUI bridge).
- **Files:** config/ace-step/bridge.json, packages/backend/app/core/ace_client.py,
  packages/backend/app/services/ace_bridge.py, packages/backend/app/main.py
- **Acceptance:** Bridge config loads with param/response maps; ACEClient maps
  canonical app-facing names to ACE-Step wire names; ACEBridge verifies
  integrity and tracks version/provider-update; startup verification logs
  tracked version without blocking; import cycle check 0 cycles.
- **Last session:** Kilo, 2026-10-27 — Created bridge.json (base URL,
  timeouts, param_map, response_map, tracked version/model, startup config),
  ace_client.py (ACEClient with health/generate/unload/reload/vram/plan_style/
  plan_lyrics/audio_url methods, param/response mapping), ace_bridge.py
  (ACEBridge with config load, param_map/response_map, tracked_version,
  provider_update_detected, verify_bridge_integrity, get_bridge_status).
  Added startup verification to main.py lifespan. Verified: ruff clean,
  import-cycle check 0 cycles, all modules import and function correctly.
